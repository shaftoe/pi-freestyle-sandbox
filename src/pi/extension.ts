import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { executeSubagent } from "../execute"
import { FreestyleClient } from "../freestyle"
import { renderCall, renderResult } from "./render"
import { toolDefinition } from "./tool"

export default function (pi: ExtensionAPI) {
  const client = new FreestyleClient()

  pi.registerFlag("freestyle-snapshot", {
    description: "Freestyle VM snapshot ID (must have pi pre-installed)",
    type: "string",
  })

  pi.registerTool({
    ...toolDefinition,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeSubagent(
        { client, snapshotFlag: pi.getFlag("--freestyle-snapshot") as string | undefined },
        _toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      )
    },
    renderCall(args, theme, _context) {
      return renderCall(args, theme)
    },
    renderResult(result, state, theme, _context) {
      return renderResult(result, state, theme)
    },
  })

  // Cleanup on session shutdown
  pi.on("session_shutdown", async () => {
    await client.cleanupAll()
  })

  // Management command
  pi.registerCommand("freestyle", {
    description: "Manage Freestyle VMs: list, cleanup",
    handler: async (args, ctx) => {
      if (args === "list") {
        const { vms } = await client.listTrackedVMs()
        if (vms.length === 0) {
          ctx.ui.notify("No active Freestyle VMs", "info")
          return
        }
        const lines = vms.map((v) => `${v.id}  ${v.state}`).join("\n")
        ctx.ui.notify(lines, "info")
      } else if (args === "cleanup") {
        await client.cleanupAll()
        ctx.ui.notify("All tracked VMs cleaned up", "info")
      } else {
        ctx.ui.notify("Usage: /freestyle list | cleanup", "info")
      }
    },
  })
}
