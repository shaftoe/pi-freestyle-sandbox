import type { PiMessage } from "./types"

/** Resolve a promise with a timeout fallback. Never rejects — logs on timeout. */
export async function withTimeout(
  promise: Promise<unknown>,
  ms: number,
  _label: string,
): Promise<void> {
  try {
    await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
    ])
  } catch {
    // best-effort
  }
}

/** Extract the final text output from parsed pi messages. */
export function getFinalOutput(messages: PiMessage[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant) return ""
  return (
    lastAssistant.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n") ?? ""
  )
}
