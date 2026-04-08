import type { FreestyleClient } from "../freestyle"
import type { OnUpdate } from "./types"
import { textContent } from "./utils"

export async function resolveSnapshot(
  client: FreestyleClient,
  snapshotFlag: string | undefined,
  onUpdate: OnUpdate,
): Promise<string> {
  onUpdate?.({
    content: [
      textContent(
        "Ensuring Freestyle VM snapshot, if no cached image exists this will take a while, hang on...",
      ),
    ],
    details: undefined,
  })
  return client.ensureSnapshot(snapshotFlag)
}
