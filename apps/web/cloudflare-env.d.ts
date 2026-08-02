declare namespace Cloudflare {
  type WebEnv = import("infra/types/web-env").WebEnv
  interface Env extends WebEnv {}
}

interface CloudflareEnv extends Cloudflare.Env {}

declare module "cloudflare:workers" {
  export const env: CloudflareEnv
}
