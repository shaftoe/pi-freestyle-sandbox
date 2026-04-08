import type { FreestyleClient } from "../freestyle"
import type { FreestyleSubagentDetails } from "../types"

export interface ExecuteDeps {
  client: FreestyleClient
  snapshotFlag: string | undefined
}

export interface ExecuteParams {
  task: string
  gitUrl?: string
  branch?: string
  model?: string
  tools?: string
  systemPrompt?: string
  timeout?: number
}

export interface ExecuteContext {
  model?: { provider: string; id: string }
  cwd: string
  ui: { notify: (msg: string, level?: "info" | "warning" | "error") => void }
}

export type OnUpdate =
  | ((update: { content: Array<{ type: "text"; text: string }>; details: undefined }) => void)
  | undefined

export interface FailureResult {
  ok: false
  content: string
  exitCode: number | null
}

export interface ExecuteReturn {
  content: Array<{ type: "text"; text: string }>
  details: FreestyleSubagentDetails
}

export interface RunConfig {
  task: string
  model: string | undefined
  systemPrompt: string | undefined
  tools: string[] | undefined
  timeoutMs: number | undefined
}
