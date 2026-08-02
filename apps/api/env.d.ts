import type { ApiEnv } from "infra/types/env"

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env extends ApiEnv {}
  }
}
