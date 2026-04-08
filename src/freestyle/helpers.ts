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

/**
 * Collect environment variables to forward from the host to the VM.
 *
 * Two sources are merged (explicit overrides prefix):
 * 1. `FREESTYLE_ENV_*` prefix convention — e.g. FREESTYLE_ENV_GITHUB_TOKEN
 *    becomes GITHUB_TOKEN in the VM.
 * 2. Explicit `GITHUB_TOKEN` on the host (kept for backwards compatibility).
 *
 * Freestyle-internal vars (FREESTYLE_API_KEY, FREESTYLE_API_URL) are excluded.
 */
export function collectForwardedEnv(): Record<string, string> {
  const env: Record<string, string> = {}

  // Prefix convention: FREESTYLE_ENV_<NAME> → <NAME>
  const PREFIX = "FREESTYLE_ENV_"
  const EXCLUDE = new Set(["FREESTYLE_API_KEY", "FREESTYLE_API_URL"])

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(PREFIX) && value) {
      const varName = key.slice(PREFIX.length)
      if (varName && !EXCLUDE.has(varName)) {
        env[varName] = value
      }
    }
  }

  // Backwards-compatible: host GITHUB_TOKEN if not already set via prefix
  const ghToken = process.env.GITHUB_TOKEN
  if (ghToken && !env.GITHUB_TOKEN) {
    env.GITHUB_TOKEN = ghToken
  }

  return env
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
