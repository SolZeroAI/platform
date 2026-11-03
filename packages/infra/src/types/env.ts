import type * as Cloudflare from "@alchemy.run/cloudflare"
import type { ApiWorkerBindingResources } from "../../../../apps/api/infra"

export type ApiEnv = Cloudflare.InferEnv<ApiWorkerBindingResources>
