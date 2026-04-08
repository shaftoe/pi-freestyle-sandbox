import { collectForwardedEnv } from "../freestyle"
import { resolveModel } from "./config"
import { setupEnvironment } from "./environment"
import { formatCancelledResult, formatSuccessResult } from "./result"
import { runAndCapture } from "./run"
import { resolveSnapshot } from "./snapshot"
import type { ExecuteContext, ExecuteDeps, ExecuteParams, ExecuteReturn, OnUpdate } from "./types"
import { isAbortError, textContent } from "./utils"
import { cleanupVM, createVM } from "./vm"
import { prepareWorkspace } from "./workspace"

export async function executeSubagent(
  deps: ExecuteDeps,
  _toolCallId: string,
  params: ExecuteParams,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdate,
  ctx: ExecuteContext,
): Promise<ExecuteReturn> {
  const { client, snapshotFlag } = deps

  // 1. Ensure snapshot
  const snapshotId = await resolveSnapshot(client, snapshotFlag, onUpdate)

  // 2. Create VM
  const { vmId, vm } = await createVM(client, snapshotId, onUpdate)

  try {
    // 3. Collect forwarded env vars and set up environment FIRST
    //    (writes wrapper, syncs pi auth, configures git)
    const env = collectForwardedEnv()
    await setupEnvironment(client, vm, env, onUpdate)

    // 4. Prepare workspace (clone or mkdir)
    const workspaceResult = await prepareWorkspace(client, vm, params, onUpdate)
    if (!workspaceResult.ok) {
      return {
        content: [textContent(workspaceResult.content)],
        details: {
          vmId,
          exitCode: workspaceResult.exitCode,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
          diff: "",
          changedFiles: [],
          stderr: "",
        },
      }
    }

    // 5. Resolve config (model + system prompt)
    const config = resolveModel(params, ctx)

    // 6. Run pi and capture diff
    const { result, diff } = await runAndCapture(client, vm, config, signal, onUpdate)

    // 7. Return success result
    return formatSuccessResult(vmId, result, diff)
  } catch (error) {
    // Handle abort — return immediately so the user regains the TUI prompt.
    // Cleanup runs in background via the finally block.
    if (isAbortError(error, signal)) {
      return formatCancelledResult(vmId)
    }
    throw error
  } finally {
    // Cleanup. When aborted, fire-and-forget so the cancellation result
    // returns instantly. Ephemeral VMs auto-delete on idle timeout anyway.
    cleanupVM(client, vmId, signal, ctx)
  }
}
