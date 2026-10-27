<!-- source: https://alchemy.run/fly/tutorial/part-2
     upstream: website/src/content/docs/fly/tutorial/part-2.mdx
     alchemy 2.0.0-beta.79 @ e354a45 -->

# Part 2: Configure the Service

> Pin the Service's region and port, add a health route, and ship a code change.

In [Part 1](/fly/tutorial/part-1) you deployed a Service on its own
`fly.dev` hostname. Now you will pin where it runs and which port it
listens on, add a health route, and ship a change.

## Pin a region

Fly Machines live in a [region](/fly/compute/regions). The default
is `iad` (Ashburn). Set it explicitly so the Volume you add in
Part 3 can match:

```diff lang="typescript"
export default class Api extends Fly.Service<Api>()(
  "Api",
-  { main: import.meta.url },
+  { main: import.meta.url, region: "iad" },
```

:::caution[Changing `region` moves the Machine]
A new Machine is created in the new region and the old one is
deleted; the hostname stays the same. [Regions](/fly/compute/regions)
lists the codes.
:::

## Set the port

Give the Service an explicit port so the Fly proxy knows where to
forward:

```diff lang="typescript"
export default class Api extends Fly.Service<Api>()(
  "Api",
-  { main: import.meta.url, region: "iad" },
+  { main: import.meta.url, region: "iad", port: 3000 },
```

The port is written to the process environment as `PORT` and used as
the Machine's `internal_port`. By default Alchemy publishes HTTP 80
and HTTPS 443 on the Fly proxy in front of it.

## Add a health route

Add `/health` so you (and later, Fly checks) can probe the process:

```diff lang="typescript"
// src/api.ts
+import { HttpServerRequest } from "effect/http/HttpServerRequest";
// ...
    return {
-      fetch: Effect.succeed(HttpServerResponse.text("Hello from Fly!")),
+      fetch: Effect.gen(function* () {
+        const request = yield* HttpServerRequest;
+        const url = new URL(request.url, "http://service");
+        if (url.pathname === "/health") {
+          return HttpServerResponse.json({ ok: true });
+        }
+        return HttpServerResponse.text("Hello from Fly!");
+      }),
    };
```

## Deploy

```sh
bun alchemy deploy
```

```text
Plan: 1 to update

~ Api (Fly.Service)

Proceed?
◉ Yes ○ No
✓ Api (Fly.Service) updated
{
  appName: "myapp-api-dev-a1b2c3d4",
  url: "https://myapp-api-dev-a1b2c3d4.fly.dev",
}
```

`iad` and port `3000` match the defaults from Part 1, so the Machine
stays where it is. The new route changes the bundle hash, so Alchemy
builds a new image and updates the Machine in place. The App and its
URL stay the same.

## Try it out

```sh
curl https://myapp-api-dev-a1b2c3d4.fly.dev/health
# → {"ok":true}
```

## Ship a change

Edit the greeting in `src/api.ts` and deploy again:

```text
Plan: 1 to update

~ Api (Fly.Service)

Proceed?
◉ Yes ○ No
✓ Api (Fly.Service) updated
```

Alchemy hashes the bundle: if your code didn't change, the Service
is a no-op; if it did, a new image is built, pushed, and the Machine
updated in place.

## Recap

You now have:

- An HTTP Service running as a Fly Machine in `iad` on port 3000
- A `/health` route on its public `https://{appName}.fly.dev` URL
- A code-hash-based update loop — edit, deploy, new image

In [Part 3](/fly/tutorial/part-3), you'll attach a Volume and
persist data across deploys.
