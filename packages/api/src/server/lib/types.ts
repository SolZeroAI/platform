import type { ApiEnv } from "infra/types/env"

export type Env = ApiEnv

export interface AppContext {
  env: ApiEnv
  executionCtx: ExecutionContext
}
