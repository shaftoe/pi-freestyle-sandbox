import type { Vm } from "freestyle-sandboxes"
import type { FreestyleClient } from "../freestyle"
import type { EnvMapping } from "../freestyle/types"
import type { OnUpdate } from "./types"
import { textContent } from "./utils"

export async function setupEnvironment(
  client: FreestyleClient,
  vm: Vm,
  env: EnvMapping,
  onUpdate: OnUpdate,
): Promise<void> {
  onUpdate?.({
    content: [textContent("Setting up environment...")],
    details: undefined,
  })
  // 1. Write the env-wrapper (FIRST — all subsequent commands use it)
  await client.syncEnvironment(vm, env)
  // 2. Pi auth (LLM provider keys)
  await client.syncPiAuth(vm)
}
