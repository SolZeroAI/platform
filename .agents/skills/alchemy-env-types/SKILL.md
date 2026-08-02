---
name: alchemy-env-types
description: Derive Cloudflare worker env types from Alchemy resource Env types instead of hand-writing env shapes. Use when editing worker bindings, adding or removing env vars in packages/infra, touching cloudflare-env.d.ts or env.d.ts files, importing from cloudflare:workers, or fixing env typing in API or web apps.
---
# Alchemy Env Types

Use Alchemy's generated worker `Env` type as the single source of truth for Cloudflare env bindings in this repo.

- Do not hand-write env shapes like `Record<string, string | undefined>`.
- Do not redeclare individual env vars in app typing files when the Alchemy resource type already contains them.
- Do not locally cast `env` in app code if the declaration file can carry the correct type.

## Pattern

1. Export the worker resource type from infra:

```ts
export type WebResource = Awaited<ReturnType<typeof createWeb>>
```

2. Derive an env alias from that resource in `packages/infra/src/types/`:

```ts
import type { WebResource } from "../web"

export type WebEnv = WebResource["Env"]
```

3. In the app declaration file, extend `Cloudflare.Env` from that alias:

```ts
declare namespace Cloudflare {
  type WebEnv = import("infra/types/web-env").WebEnv
  interface Env extends WebEnv {}
}
```

4. If the app imports `env` from `cloudflare:workers`, make sure the module is declared and exports that merged env type:

```ts
interface CloudflareEnv extends Cloudflare.Env {}

declare module "cloudflare:workers" {
  export const env: CloudflareEnv
}
```

## Repo Notes

- `apps/api/env.d.ts` is the reference API pattern.
- `apps/web/cloudflare-env.d.ts` is the reference web pattern.
- `packages/infra/src/types/env.ts` contains API env aliases.
- `packages/infra/src/types/web-env.ts` contains the web env alias.
- In this repo, the web app needs the `declare module "cloudflare:workers"` block so TypeScript can resolve that module. Keep that block minimal and sourced from `Cloudflare.Env`.

## When Changing Bindings

When adding, removing, or renaming a binding in infra:

1. Update the Alchemy resource definition in `packages/infra/src/web.ts` or the corresponding worker factory.
2. Make sure the worker resource type is exported.
3. Make sure the app declaration file extends the env alias derived from that worker resource.
4. Remove any manual env var redefinitions or local casts that duplicate the generated type.

## Bad

```ts
const env = cloudflareEnv as {
  VITE_STAGE?: string
}
```

```ts
declare module "cloudflare:workers" {
  export const env: {
    VITE_STAGE: string
    INTERNAL_CALLBACK_SECRET: string
  }
}
```

## Good

```ts
import { env } from "cloudflare:workers"

const stage = env.VITE_STAGE
```

Keep the declaration layer thin. The env var list should come from Alchemy, not be copied by hand into app code.
