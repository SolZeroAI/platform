import {
  createDynamicWorkflowEntrypoint,
  DynamicWorkflowBinding,
} from "@cloudflare/dynamic-workflows"
import type { Env } from "../types"
import { loadDynamicWorkflowRunner } from "./runner"

export { DynamicWorkflowBinding }

export const DynamicUserWorkflow = createDynamicWorkflowEntrypoint(({ env, metadata, ctx }) =>
  loadDynamicWorkflowRunner({
    env: env as Env,
    metadata: metadata as Record<string, unknown>,
    ctx,
  }),
)
