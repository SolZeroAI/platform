import type { RunSessionPayload } from "@solzero/api"
import { runSessionHttp } from "../../../../application/session-run"

export type { RunSessionPayload }

export function run({ payload }: { payload: RunSessionPayload }) {
  return runSessionHttp(payload)
}
