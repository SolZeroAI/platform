<!-- source: https://alchemy.run/railway/tutorial/part-1
     upstream: website/src/content/docs/railway/tutorial/part-1.mdx
     alchemy 2.0.0-beta.79 @ e354a45 -->

# Part 1: Your First Project

> Install Alchemy, create a Stack with a Railway Project, and deploy it.

Install Alchemy and Effect, create a Stack with a Railway Project, and
deploy it. A Project is the parent for Services, Environments,
Variables, and disks.

## Prerequisites

- [Bun](https://bun.sh) or Node.js 22+
- A Railway workspace and an account API token — see
  [Setup](/railway/setup) if you haven't created those yet

:::note[Costs]
A Railway Project is free. Compute (Services) is billed starting in
[Part 2](/railway/tutorial/part-2). `alchemy destroy` tears
everything down when you're done.
:::

## Create a project

Start with an empty directory and initialize a `package.json`:

```sh
mkdir my-app && cd my-app && bun init -y
```

## Install dependencies

Install <code>alchemy@next</code> and <code>effect@{effectVersion}</code>:

```sh
bun add "alchemy@next" "effect@rc" "@effect/platform-bun@rc" "@effect/platform-node@rc"
```

## Create the Stack

Every Alchemy program starts with a `Stack` — a collection of
Resources managed by Providers with state tracked between deploys.

Create an `alchemy.run.ts` file:

```typescript
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export default Alchemy.Stack(
  "MyApp",
  {
  // @error: ts(2345) Argument of type '{ providers: Layer.Layer<never, never, never>; }' is not assignable to parameter of type 'StackProps<never>'.
  // @error:   Property 'state' is missing in type '{ providers: Layer.Layer<never, never, never>; }' but required in type 'StackProps<never>'.
    providers: Layer.empty,
  },
  Effect.gen(function* () {
    // we'll add resources here next
  }),
);
```

TypeScript is unhappy: the `state` property is required. Every Stack
needs a **state store** so Alchemy can persist resource state between
deploys and compute diffs against your infrastructure.

## Configure state

Railway has no state backend of its own, so we'll keep state on disk
with `Alchemy.localState()` — it writes to `.alchemy/` next to your
code, no setup required:

```diff lang="typescript"
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export default Alchemy.Stack(
  "MyApp",
  {
    providers: Layer.empty,
+    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    // we'll add resources here next
  }),
);
```

:::note[Other state stores]
Local state is perfect for a solo project. When you need state your
team and CI can share, swap in `Cloudflare.state()` or `AWS.state()`
— see [State Store](/state-store).
:::

## Add a Project

Resources represent cloud infrastructure. Each resource is
`yield*`-ed inside the Stack's Effect generator.

Let's declare a Railway Project and observe the type error:

```diff lang="typescript"
// alchemy.run.ts
import * as Alchemy from "alchemy";
+import * as Railway from "alchemy/Railway";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export default Alchemy.Stack(
  "MyApp",
  {
    providers: Layer.empty,
    // @error: ts(2322) Type 'Layer<never, never, never>' is not assignable to type 'Layer<NoInfer<Providers>, never, StackServices>'.
    // @error:   Type 'Providers' is not assignable to type 'never'.
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
+    const site = yield* Railway.Project("Site");
  }),
);
```

Omit `name` and Alchemy generates a unique, DNS-safe Project name
(max 32 characters, leading letter). The workspace defaults to
whatever workspace your token belongs to. A production environment
is created with the Project.

TypeScript is telling us that `Layer.empty` doesn't provide
`Railway.Providers` — the layer required by `Project`.

## Fix the Providers

Replace `Layer.empty` with `Railway.providers()` to resolve the type
error:

```diff lang="typescript"
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Railway from "alchemy/Railway";
import * as Effect from "effect/Effect";
-import * as Layer from "effect/Layer";

export default Alchemy.Stack(
  "MyApp",
  {
+    providers: Railway.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const site = yield* Railway.Project("Site");
  }),
);
```

Now the program type-checks. The providers layer tells Alchemy how to
talk to the Railway GraphQL API, and the type system ensures you
never forget to wire it up.

## Return Stack outputs

Stack outputs let you see important values after a deploy. Return an
object from the generator to expose the Project's name, id, and
dashboard URL:

```typescript
  Effect.gen(function* () {
    const site = yield* Railway.Project("Site");

    return {
      name: site.name,
      projectId: site.projectId,
      url: site.url,
    };
  }),
```

`url` is `https://railway.com/project/{projectId}`. Nothing is
listening on the public internet yet — that's
[Part 2](/railway/tutorial/part-2).

## Deploy

Run `alchemy deploy` to create the Project:

```sh
bun alchemy deploy
```

The first time you deploy, Alchemy prompts for Railway credentials —
paste the account token you generated in [Setup](/railway/setup).
The token is verified and saved to your **`default`**
[profile](/environments/profiles), so you won't be asked again.

```text
Plan: 1 to create

+ Site (Railway.Project)

Proceed?
◉ Yes ○ No
✓ Site (Railway.Project) created
{
  name: "myapp-site-dev-a1b2c3d4",
  projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  url: "https://railway.com/project/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
}
```

Alchemy shows a plan, asks for confirmation, creates the Project, and
prints the stack outputs.

## Verify it worked

The Project is listed in your workspace in the
[Railway dashboard](https://railway.com/dashboard). Run
`alchemy deploy` again. Because nothing changed, the Project shows
as a no-op:

```text
Plan: no changes

{
  name: "myapp-site-dev-a1b2c3d4",
  projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  url: "https://railway.com/project/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
}
```

This is the core loop — declare resources in code, deploy, and
Alchemy figures out what changed.

## Recap

You now have:

- An `alchemy.run.ts` with a Stack and a Railway Project
- A live Project in your workspace with a generated unique name
- A production environment created with the Project
- Stack outputs showing `name`, `projectId`, and the dashboard URL

In [Part 2](/railway/tutorial/part-2), you'll deploy code to this
Project — a `Railway.Service` that bundles an Effect HTTP handler
into a container.
