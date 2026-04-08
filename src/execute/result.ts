import type { DiffResult, PiRunResult } from "../freestyle/types"
import { getFinalOutput } from "../utils"
import type { ExecuteReturn } from "./types"
import { textContent } from "./utils"

export function formatSuccessResult(
  vmId: string,
  result: PiRunResult,
  diff: DiffResult | null,
): ExecuteReturn {
  const finalOutput = getFinalOutput(result.messages)
  const outputText = finalOutput || (result.stderr ? ` stderr:\n${result.stderr}` : "(no output)")
  return {
    content: [textContent(outputText)],
    details: {
      vmId,
      exitCode: result.exitCode,
      usage: result.usage,
      diff: diff?.diff ?? "",
      changedFiles: diff?.changedFiles ?? [],
      stderr: result.stderr,
    },
  }
}

export function formatCancelledResult(vmId: string): ExecuteReturn {
  return {
    content: [textContent("⚠ Operation cancelled by user")],
    details: {
      vmId,
      exitCode: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
      diff: "",
      changedFiles: [],
      stderr: "",
      cancelled: true,
    },
  }
}
