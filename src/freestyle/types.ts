import type { UsageStats } from "../types"

// ── Exec guard ────────────────────────────────────────────────────────

export class VmExecError extends Error {
  readonly exitCode: number | null
  readonly stderr: string
  readonly command: string

  constructor(
    result: { stdout?: string | null; stderr?: string | null; statusCode?: number | null },
    command: string,
  ) {
    super(
      `Command failed (exit ${result.statusCode ?? "unknown"}): ${command}\n${result.stderr ?? ""}`,
    )
    this.name = "VmExecError"
    this.exitCode = result.statusCode ?? null
    this.stderr = result.stderr ?? ""
    this.command = command
  }
}

// ── Types ──────────────────────────────────────────────────────────────

export interface VmHandle {
  vmId: string
  vm: import("freestyle-sandboxes").Vm
}

export interface CloneOptions {
  gitUrl: string
  branch?: string
  targetDir: string
  /** Optional token to embed in the clone URL for private repos. */
  gitToken?: string
}

/** Environment variable mapping forwarded from host to VM. */
export type EnvMapping = Record<string, string>

export interface PiRunOptions {
  task: string
  cwd: string
  systemPrompt?: string
  /** Model in "provider/id" format (e.g. "google/gemini-2.5-pro") */
  model?: string
  /** Comma-separated tool list override */
  tools?: string[]
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Execution timeout in milliseconds */
  timeoutMs?: number
}

export interface PiRunResult {
  exitCode: number | null
  messages: import("../types").PiMessage[]
  stderr: string
  usage: UsageStats
}

export interface DiffResult {
  changedFiles: string[]
  diff: string
}
