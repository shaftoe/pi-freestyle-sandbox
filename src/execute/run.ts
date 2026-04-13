import type { Vm } from "freestyle"
import type { FreestyleClient } from "../freestyle"
import type { DiffResult } from "../types"
import { WORKSPACE } from "./constants"
import type { OnUpdate, RunConfig } from "./types"
import { textContent } from "./utils"

export async function runAndCapture(
  client: FreestyleClient,
  vm: Vm,
  config: RunConfig,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdate,
) {
  const modelLabel = config.model ?? "default"
  onUpdate?.({
    content: [textContent(`Running pi (${modelLabel}) in Freestyle VM...`)],
    details: undefined,
  })
  const result = await client.runPi(vm, {
    task: config.task,
    cwd: WORKSPACE,
    systemPrompt: config.systemPrompt,
    model: config.model,
    tools: config.tools,
    signal,
    timeoutMs: config.timeoutMs,
  })

  // Capture diff (skip if aborted)
  let diff: DiffResult | null = null
  if (!signal?.aborted) {
    onUpdate?.({
      content: [textContent("Capturing changes...")],
      details: undefined,
    })
    diff = await client.captureDiff(vm, WORKSPACE, signal)
  }

  return { result, diff }
}
