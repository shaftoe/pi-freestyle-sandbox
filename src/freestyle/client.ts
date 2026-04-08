import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Freestyle, type FreestyleOptions, type Vm } from "freestyle-sandboxes"
import { Temporal } from "temporal-polyfill"
import {
  buildCloneCommand,
  buildPiArgs,
  buildWrapperScript,
  parseGitStatus,
  WRAPPER_PATH,
} from "./commands"
import { escapeShellArg, parseJsonlOutput, raceWithAbort } from "./helpers"
import type {
  CloneOptions,
  DiffResult,
  EnvMapping,
  PiRunOptions,
  PiRunResult,
  VmHandle,
} from "./types"
import { VmExecError } from "./types"

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_SNAPSHOT_NAME = "pi-agent-base"
const DEFAULT_EXEC_TIMEOUT = 300_000 // 5 min
const DEFAULT_IDLE_TIMEOUT = 300 // 5 min auto-cleanup
const DEFAULT_CLONE_TIMEOUT = 60_000 // 1 min
const DEFAULT_DIFF_TIMEOUT = 10_000 // 10s

/** Path inside the VM where pi's agent dir lives (root user). */
const VM_AGENT_DIR = "/root/.pi/agent"

// ── Client ─────────────────────────────────────────────────────────────

export class FreestyleClient {
  private readonly sdk: Freestyle
  private readonly activeVMs = new Map<string, Temporal.Instant>() // vmId → createdAt
  private cachedSnapshotId?: string

  constructor(options?: FreestyleOptions) {
    this.sdk = new Freestyle(options)
  }

  // ── Exec guard ────────────────────────────────────────────────────────

  /**
   * Execute a command in the VM and throw VmExecError on non-zero exit.
   * By default the wrapper script is prepended so env vars are available.
   * Use `raw: true` for bootstrap commands that run before the wrapper exists.
   */
  private async vmExec(vm: Vm, options: { command: string; timeoutMs?: number; raw?: boolean }) {
    const command = options.raw ? options.command : `${WRAPPER_PATH} ${options.command}`
    const result = await vm.exec({ ...options, command })
    if (result.statusCode !== 0) {
      throw new VmExecError(result, options.command)
    }
    return result
  }

  /**
   * Execute a command in the VM via the wrapper WITHOUT throwing on non-zero exit.
   * Use for probes where failure is an expected branch (e.g. "is this a git repo?").
   */
  private async vmExecGraceful(vm: Vm, options: { command: string; timeoutMs?: number }) {
    return vm.exec({ ...options, command: `${WRAPPER_PATH} ${options.command}` })
  }

  // ── Snapshot management ─────────────────────────────────────────────

  /**
   * Ensure a snapshot with pi + node pre-installed exists.
   * If an explicit snapshotId is provided, return it unchanged.
   * Otherwise, look for an existing snapshot by name. If none is found,
   * create one via Dockerfile. The resolved ID is cached in-memory so
   * subsequent calls are free.
   */
  async ensureSnapshot(snapshotId?: string): Promise<string> {
    if (snapshotId) {
      const exists = await this.findSnapshotById(snapshotId)
      if (!exists) {
        throw new Error(`Snapshot '${snapshotId}' does not exist`)
      }
      return snapshotId
    }
    if (this.cachedSnapshotId) return this.cachedSnapshotId

    // Try to find an existing snapshot by name first
    const existing = await this.findSnapshotByName(DEFAULT_SNAPSHOT_NAME)
    if (existing) {
      this.cachedSnapshotId = existing
      return existing
    }

    // None found — create a new one
    const { snapshotId: id } = await this.sdk.vms.snapshots.ensure({
      name: DEFAULT_SNAPSHOT_NAME,
      template: {
        baseImage: {
          dockerfileContent: `
            FROM node:trixie
            RUN apt-get update && \
              apt-get install -y gh git ca-certificates curl
            RUN npm install -g @mariozechner/pi-coding-agent
          `,
        },
      },
    })
    this.cachedSnapshotId = id
    return id
  }

  /** Fetch the full list of snapshots from the API. */
  private async listSnapshots(): Promise<{ snapshotId: string; name?: string | null }[]> {
    const baseUrl = process.env.FREESTYLE_API_URL ?? "https://api.freestyle.sh"
    const res = await this.sdk.fetch(`${baseUrl}/v1/vms/snapshots`)
    if (!res.ok) return []
    const data = (await res.json()) as {
      snapshots: { snapshotId: string; name?: string | null }[]
    }
    return data.snapshots
  }

  /** Look up a snapshot by name via the Freestyle REST API. */
  private async findSnapshotByName(name: string): Promise<string | undefined> {
    const snapshots = await this.listSnapshots()
    return snapshots.find((s) => s.name === name)?.snapshotId
  }

  /** Check whether a snapshot with the given ID exists via the Freestyle REST API. */
  private async findSnapshotById(id: string): Promise<boolean> {
    const snapshots = await this.listSnapshots()
    return snapshots.some((s) => s.snapshotId === id)
  }

  // ── VM lifecycle ────────────────────────────────────────────────────

  /**
   * Create an ephemeral VM from a snapshot.
   * The VM is tracked internally and will be cleaned up on destroyVM() or cleanupAll().
   * Auto-deletes after idle timeout even if cleanup fails.
   */
  async createVM(snapshotId: string): Promise<VmHandle> {
    const { vmId, vm } = await this.sdk.vms.create({
      snapshotId,
      recreate: true,
      persistence: { type: "ephemeral" },
      idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT,
    })
    this.activeVMs.set(vmId, Temporal.Now.instant())
    return { vmId, vm }
  }

  /**
   * Destroy a VM by ID. Best-effort — ephemeral VMs auto-delete on idle timeout.
   * Removes the VM from the tracked set.
   */
  async destroyVM(vmId: string): Promise<void> {
    this.activeVMs.delete(vmId)
    try {
      await this.sdk.vms.delete({ vmId })
    } catch {
      // best effort — ephemeral VMs auto-delete on idle timeout
    }
  }

  /**
   * List all VMs from the Freestyle API.
   */
  async listVMs(): Promise<{ vms: { id: string; state: string }[] }> {
    return this.sdk.vms.list()
  }

  /**
   * List only VMs that were created by this client instance (tracked in-memory).
   * Fetches current state from the API but filters to tracked VM IDs only.
   */
  async listTrackedVMs(): Promise<{
    vms: { id: string; state: string; createdAt?: string | null }[]
  }> {
    const tracked = this.trackedVmIds
    if (tracked.length === 0) return { vms: [] }
    const { vms } = await this.listVMs()
    const trackedSet = new Set(tracked)
    return { vms: vms.filter((v) => trackedSet.has(v.id)) }
  }

  /**
   * Destroy all VMs tracked by this client instance.
   */
  async cleanupAll(): Promise<void> {
    const ids = [...this.activeVMs.keys()]
    await Promise.allSettled(ids.map((id) => this.destroyVM(id)))
    this.activeVMs.clear()
  }

  /** IDs of VMs currently tracked by this client. */
  get trackedVmIds(): string[] {
    return [...this.activeVMs.keys()]
  }

  // ── VM operations ─────────────────────────────────────────────────────

  /**
   * Write the env-wrapper script into the VM and make it executable.
   * Must be called before any other business-logic command so that
   * ${WRAPPER_PATH} is available for all subsequent exec calls.
   */
  async syncEnvironment(vm: Vm, env: EnvMapping): Promise<void> {
    await vm.fs.writeTextFile(WRAPPER_PATH, buildWrapperScript(env))
    await this.vmExec(vm, { command: `chmod +x ${WRAPPER_PATH}`, raw: true })
  }

  /**
   * Copy the host's pi auth.json and models.json into the VM so pi inside
   * can authenticate with the same providers the parent session uses.
   * Throws if auth.json is missing (required for the subagent to work).
   */
  async syncPiAuth(vm: Vm): Promise<void> {
    const agentDir = join(homedir(), ".pi", "agent")
    const authPath = join(agentDir, "auth.json")

    // auth.json is required — fail early with a clear message
    let authContent: string
    try {
      authContent = readFileSync(authPath, "utf-8")
    } catch {
      throw new Error(
        `Cannot read ${authPath}. Ensure you are logged in (run 'pi' interactively first).`,
      )
    }

    // Create agent dir in VM
    await this.vmExec(vm, { command: `mkdir -p ${VM_AGENT_DIR}`, raw: true })
    await vm.fs.writeTextFile(`${VM_AGENT_DIR}/auth.json`, authContent)

    // models.json is optional
    const modelsPath = join(agentDir, "models.json")
    try {
      const modelsContent = readFileSync(modelsPath, "utf-8")
      await vm.fs.writeTextFile(`${VM_AGENT_DIR}/models.json`, modelsContent)
    } catch {
      // models.json is optional — skip silently
    }
  }

  /**
   * Authenticate the gh CLI inside the VM using the provided token.
   * Also configures gh as git credential helper for seamless private repo access.
   */
  async setupGhAuth(vm: Vm, token: string): Promise<void> {
    // gh refuses to store credentials when GITHUB_TOKEN is set, so we
    // run a shell that unsets it before calling gh. Raw command (no wrapper).
    await this.vmExec(vm, {
      command: `bash -c 'unset GITHUB_TOKEN; echo ${escapeShellArg(token)} | gh auth login --with-token'`,
      raw: true,
    })

    // Configure gh as git credential helper for seamless push/pull
    await this.vmExec(vm, { command: "gh auth setup-git" })
  }

  /**
   * Clone a git repo into a VM.
   * If `options.gitToken` is set and the URL is a GitHub HTTPS URL,
   * the token is embedded for private repo access.
   * Returns a typed result — check `.ok` to determine success.
   */
  async cloneRepo(
    vm: Vm,
    options: CloneOptions,
  ): Promise<{ ok: true } | { ok: false; exitCode: number | null; stderr: string }> {
    try {
      await this.vmExec(vm, {
        command: buildCloneCommand(options),
        timeoutMs: DEFAULT_CLONE_TIMEOUT,
        raw: true,
      })
      return { ok: true }
    } catch (error) {
      if (error instanceof VmExecError) {
        return {
          ok: false,
          exitCode: error.exitCode,
          stderr: error.stderr,
        }
      }
      throw error
    }
  }

  /**
   * Run `pi --mode json` inside a VM and parse the JSONL output.
   * Blocking — returns only after pi finishes inside the VM.
   * Supports cancellation via AbortSignal.
   *
   * Note: pi may exit non-zero (e.g. syntax error in task). We capture
   * the raw result and let the caller interpret it via parseJsonlOutput.
   */
  async runPi(vm: Vm, options: PiRunOptions): Promise<PiRunResult> {
    // 1. Write task to file in VM
    await vm.fs.writeTextFile("/tmp/pi-task.md", options.task)

    // 2. Build pi invocation
    if (options.systemPrompt) {
      await vm.fs.writeTextFile("/tmp/pi-system.md", options.systemPrompt)
    }
    const args = buildPiArgs(options)

    // 3. Execute (blocking — waits for completion, supports cancellation)
    const execPromise = this.vmExec(vm, {
      command: `bash -c 'cd ${options.cwd} && ${args.join(" ")}'`,
      timeoutMs: options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT,
    })

    const result = options.signal
      ? await raceWithAbort(execPromise, options.signal)
      : await execPromise

    // 4. Parse JSONL from stdout
    return parseJsonlOutput(result.stdout ?? "", result.stderr ?? "", result.statusCode)
  }

  /**
   * Capture git diff from a VM workspace.
   * Returns null if the workspace is clean (no changes) or not a git repository.
   * Supports cancellation via AbortSignal.
   */
  async captureDiff(vm: Vm, cwd: string, signal?: AbortSignal): Promise<DiffResult | null> {
    // First check if we're inside a git repository. If not, return null.
    // Graceful exec — non-zero exit is an expected branch.
    const checkRepoExec = this.vmExecGraceful(vm, {
      command: `bash -c 'cd ${cwd} && git rev-parse --is-inside-work-tree'`,
      timeoutMs: DEFAULT_DIFF_TIMEOUT,
    })

    const checkRepo = signal ? await raceWithAbort(checkRepoExec, signal) : await checkRepoExec

    if (checkRepo.statusCode !== 0 || checkRepo.stdout?.trim() !== "true") {
      return null
    }

    const statusExec = this.vmExecGraceful(vm, {
      command: `bash -c 'cd ${cwd} && git status --porcelain'`,
      timeoutMs: DEFAULT_DIFF_TIMEOUT,
    })

    const status = signal ? await raceWithAbort(statusExec, signal) : await statusExec

    // If git status fails (e.g. due to permission issues), return null
    if (status.statusCode !== 0) {
      return null
    }

    if (!status.stdout?.trim()) return null

    const diffExec = this.vmExec(vm, {
      command: `bash -c 'cd ${cwd} && git diff && git diff --cached'`,
      timeoutMs: DEFAULT_DIFF_TIMEOUT,
    })

    const diff = signal ? await raceWithAbort(diffExec, signal) : await diffExec

    const changedFiles = parseGitStatus(status.stdout)
    return { changedFiles, diff: diff.stdout ?? "" }
  }
}
