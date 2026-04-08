export interface UsageStats {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  turns: number
}

export interface MessageContent {
  type: string
  text?: string
  [key: string]: unknown
}

export interface PiMessage {
  role: string
  content?: MessageContent[]
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: { total: number }
  }
  [key: string]: unknown
}

// ── Shared across execute & freestyle ─────────────────────────────────

/** Environment variable mapping forwarded from host to VM. */
export type EnvMapping = Record<string, string>

export interface DiffResult {
  changedFiles: string[]
  diff: string
}

export interface FreestyleSubagentDetails {
  vmId: string
  exitCode: number | null
  usage: UsageStats
  diff?: string
  changedFiles?: string[]
  stderr: string
  cancelled?: boolean
}

export interface PiRunResult {
  exitCode: number | null
  messages: PiMessage[]
  stderr: string
  usage: UsageStats
}
