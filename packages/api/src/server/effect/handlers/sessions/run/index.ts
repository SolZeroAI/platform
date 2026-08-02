import type { RunSessionPayload } from "@c0/api"
import { runSessionHttp } from "../../../../application/session-run"

export type { RunSessionPayload }

export function run({ payload }: { payload: RunSessionPayload }) {
  return runSessionHttp(payload)
}
