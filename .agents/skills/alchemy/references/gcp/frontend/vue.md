<!-- source: https://alchemy.run/gcp/frontend/vue
     upstream: website/src/content/docs/gcp/frontend/vue.mdx
     alchemy 2.0.0-beta.86 @ 21c6012 -->

# Vue

> Deploy a Vue single-page app to Cloud Run with GCP.Website.Vite — scaffold with create-vue, deep links answered by index.html.

A Vue app is a Vite app, so it deploys with
[`GCP.Website.Vite`](/gcp/frontend/vite). Vue Router's history mode
works out of the box: unknown paths answer with `index.html`.

## Install

<PackageManagers dev={devDeps} />

Docker has to be running when you deploy.

## Scaffold the app

```sh
bun create vite@latest web -- --template vue-ts\ncd web && bun install && cd ..
```

Keep the generated `vite.config.ts` as it is.

## Deploy the site

```typescript
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as GCP from "@alchemy.run/gcp";
import * as Effect from "effect/Effect";

export const Website = GCP.Website.Vite("Website", { rootDir: "./web" });

export default Alchemy.Stack(
  "MyVueApp",
  { providers: GCP.providers(), state: GCP.state() },
  Effect.gen(function* () {
    const site = yield* Website;
    return { url: site.url };
  }),
);
```

<PackageManagers run="alchemy deploy" />

When you add [Vue Router](https://router.vuejs.org) in history mode,
deep links work as they are: the server answers unknown paths with
`index.html`.

## Local development

`alchemy dev` runs Vite's dev server with hot reload.

## Where next

- [Vite](/gcp/frontend/vite) — env values, base paths, and 404 pages.
- [Nuxt](/gcp/frontend/nuxt) — when you need server rendering.
