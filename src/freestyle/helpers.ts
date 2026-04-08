import type { PiRunResult } from "./types"

/** Parse JSONL output produced by `pi --mode json`. Pure function — no side effects. */
export function parseJsonlOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null | undefined,
): PiRunResult {
  const result: PiRunResult = {
    exitCode: exitCode ?? null,
    messages: [],
    stderr,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 0,
    },
  }

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === "message_end" && event.message) {
        result.messages.push(event.message)
        if (event.message.role === "assistant") {
          result.usage.turns++
          const usage = event.message.usage
          if (usage) {
            result.usage.input += usage.input || 0
            result.usage.output += usage.output || 0
            result.usage.cacheRead += usage.cacheRead || 0
            result.usage.cacheWrite += usage.cacheWrite || 0
            result.usage.cost += usage.cost?.total || 0
          }
        }
      }
      if (event.type === "tool_result_end" && event.message) {
        result.messages.push(event.message)
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return result
}

/** Shell-escape a value using single-quotes (safe for env VAR='value' assignments). */
export function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** Race a promise against an AbortSignal, rejecting with AbortError if cancelled. */
export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (err) => {
        signal.removeEventListener("abort", onAbort)
        reject(err)
      },
    )
  })
}
