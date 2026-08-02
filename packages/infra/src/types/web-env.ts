import type * as Cloudflare from "alchemy/Cloudflare"
import type { WebResource } from "../web"

export type WebEnv = Cloudflare.InferEnv<WebResource>
