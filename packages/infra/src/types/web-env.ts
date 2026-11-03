import type * as Cloudflare from "@alchemy.run/cloudflare"
import type { WebResource } from "../web"

export type WebEnv = Cloudflare.InferEnv<WebResource>
