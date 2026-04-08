import type { FreestyleClient } from "../freestyle"
import { withTimeout } from "../utils"
import { CLEANUP_TIMEOUT_MS } from "./constants"
import type { ExecuteContext, OnUpdate } from "./types"
import { textContent } from "./utils"

export async function createVM(client: FreestyleClient, snapshotId: string, onUpdate: OnUpdate) {
  onUpdate?.({
    content: [textContent(`Creating VM from snapshot ${snapshotId.slice(0, 8)}...`)],
    details: undefined,
  })
  return client.createVM(snapshotId)
}

export function cleanupVM(
  client: FreestyleClient,
  vmId: string,
  signal: AbortSignal | undefined,
  ctx: ExecuteContext,
): void {
  if (signal?.aborted) {
    client
      .destroyVM(vmId)
      .then(() => ctx.ui.notify(`VM ${vmId.slice(0, 8)}… cleaned up`, "info"))
      .catch(() =>
        ctx.ui.notify(
          `VM ${vmId.slice(0, 8)}… cleanup failed (will auto-delete on idle)`,
          "warning",
        ),
      )
  } else {
    void withTimeout(client.destroyVM(vmId), CLEANUP_TIMEOUT_MS, "VM cleanup")
  }
}
