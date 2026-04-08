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

export interface FreestyleSubagentDetails {
  vmId: string
  exitCode: number | null
  usage: UsageStats
  diff?: string
  changedFiles?: string[]
  stderr: string
  cancelled?: boolean
}
