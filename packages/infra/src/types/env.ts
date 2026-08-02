import type * as Cloudflare from "alchemy/Cloudflare"
import type { ApiWorkerBindingResources } from "../../../../apps/api/infra"

export type ApiEnv = Cloudflare.InferEnv<ApiWorkerBindingResources>
