import { Text } from "@mariozechner/pi-tui"
import type { FreestyleSubagentDetails } from "../types"

interface Theme {
  fg(name: string, text: string): string
  bold(text: string): string
}

export function renderCall(args: Record<string, unknown>, theme: Theme): Text {
  let text = theme.fg("toolTitle", theme.bold("freestyle_sandbox "))
  if (args.gitUrl) {
    const short = String(args.gitUrl).replace(/.*github.com\//, "")
    text += theme.fg("accent", short)
    if (args.branch) text += theme.fg("dim", `@${args.branch}`)
  }
  const task = String(args.task ?? "")
  const preview = task.length > 80 ? `${task.slice(0, 80)}...` : task
  text += `\n  ${theme.fg("dim", preview)}`
  return new Text(text, 0, 0)
}

export function renderResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  state: { expanded: boolean },
  theme: Theme,
): Text {
  const details = result.details as FreestyleSubagentDetails | undefined

  // Cancelled state — show a clear indicator
  if (details?.cancelled) {
    const vmLabel = details.vmId ? ` ${details.vmId.slice(0, 8)}…` : ""
    return new Text(
      theme.fg("warning", "⚠ Cancelled") + theme.fg("dim", ` — VM${vmLabel} cleanup in background`),
      0,
      0,
    )
  }

  const text = result.content[0]
  const output = text?.type === "text" ? (text.text ?? "(no output)") : "(no output)"
  if (!state.expanded) {
    const lines = output.split("\n").slice(0, 5).join("\n")
    return new Text(
      theme.fg("success", "✓ ") +
        theme.fg("dim", lines) +
        "\n" +
        theme.fg("muted", "(Ctrl+O to expand)"),
      0,
      0,
    )
  }
  return new Text(theme.fg("toolOutput", output), 0, 0)
}
