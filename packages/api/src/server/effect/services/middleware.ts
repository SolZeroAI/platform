import type { ApiEnv } from "infra/types/env"
import { D1Drizzle } from "../db/d1-drizzle"
import { CloudflareContext } from "./cloudflare"

export interface CloudflareBindings {
  env: ApiEnv
  ctx: ExecutionContext
}

export const getCloudflareBindings = CloudflareContext

export const getD1Drizzle = D1Drizzle
