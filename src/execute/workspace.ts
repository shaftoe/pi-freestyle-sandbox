import type { Vm } from "freestyle"
import type { FreestyleClient } from "../freestyle"
import { WORKSPACE } from "./constants"
import type { ExecuteParams, FailureResult, OnUpdate } from "./types"
import { textContent } from "./utils"

export async function prepareWorkspace(
  client: FreestyleClient,
  vm: Vm,
  params: ExecuteParams,
  onUpdate: OnUpdate,
): Promise<{ ok: true } | FailureResult> {
  if (params.gitUrl) {
    onUpdate?.({
      content: [textContent(`Cloning ${params.gitUrl}...`)],
      details: undefined,
    })
    const clone = await client.cloneRepo(vm, {
      gitUrl: params.gitUrl,
      branch: params.branch,
      targetDir: WORKSPACE,
    })
    if (!clone.ok) {
      return {
        ok: false,
        content: `Failed to clone: ${clone.stderr || "unknown error"}`,
        exitCode: clone.exitCode,
      }
    }
    return { ok: true }
  }

  // Create workspace directory
  const mkdirResult = await vm.exec({ command: `mkdir -p ${WORKSPACE}` })
  if (mkdirResult.statusCode !== 0) {
    return {
      ok: false,
      content: `Failed to create workspace: ${mkdirResult.stderr || "unknown error"}`,
      exitCode: mkdirResult.statusCode ?? null,
    }
  }
  return { ok: true }
}
