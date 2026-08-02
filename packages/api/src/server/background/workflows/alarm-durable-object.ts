import { DurableObject } from "cloudflare:workers"
import type { Env } from "../types"
import { handleWorkflowAlarm, handleWorkflowAlarmFetch } from "./alarm"

export class WorkflowAlarmDO extends DurableObject<Env> {
  fetch = (request: Request): Promise<Response> => {
    return handleWorkflowAlarmFetch({ request, storage: this.ctx.storage })
  }

  alarm = (): Promise<void> => {
    return handleWorkflowAlarm({ env: this.env, storage: this.ctx.storage })
  }
}
