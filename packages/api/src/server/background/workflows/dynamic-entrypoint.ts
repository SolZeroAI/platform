import {
  createDynamicWorkflowEntrypoint,
  DynamicWorkflowBinding,
} from "@cloudflare/dynamic-workflows"
import type { Env } from "../types"
import { loadDynamicWorkflowRunner } from "./runner"

export { DynamicWorkflowBinding }

export const DynamicUserWorkflow = createDynamicWorkflowEntrypoint(({ env, metadata, ctx }) =>
  loadDynamicWorkflowRunner({
    env: /* SAFETY: env has the Env shape established by the check or writer around this read. */ env as Env,
    metadata:
      /* SAFETY: metadata was checked to be a non-array object before it is read as Record<string, unknown>. */ metadata as Record<
        string,
        unknown
      >,
    ctx,
  }),
)
