<!-- source: https://alchemy.run/gcp/tutorial/part-1
     upstream: website/src/content/docs/gcp/tutorial/part-1.mdx
     alchemy 2.0.0-beta.86 @ 21c6012 -->

# Part 1: Your First Stack

> Install Alchemy, create a Stack with a Cloud Storage Bucket, and deploy it to Google Cloud.

In this part you install Alchemy, create a Stack with a Cloud Storage
Bucket, and deploy it to your Google Cloud project.

## Prerequisites

- [Node.js](https://nodejs.org) 24.11.1+ or [Bun](https://bun.sh)
- A Google Cloud project and a service-account key that can create
  what you deploy. See [Setup](/gcp/setup).

## Create a project

Start with an empty directory and a `package.json`:

<PackageManagers init dir="my-app" />

## Install dependencies

Install Alchemy, the GCP provider, and Effect:

<PackageManagers add={pkgs} />

## Create the Stack

Every Alchemy program starts with a `Stack`. Create `alchemy.run.ts`:

```typescript
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as GCP from "@alchemy.run/gcp";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MyApp",
  {
    providers: GCP.providers(),
    state: GCP.state(),
  },
  Effect.gen(function* () {
    // resources go here next
  }),
);
```

The first argument, `"MyApp"`, names the Stack. Alchemy uses it as a
prefix when it generates names for your resources.

`GCP.providers()` registers every GCP resource.

## Where state lives

`state: GCP.state()` keeps deploy state in a Cloud Storage bucket in
your project, `alchemy-state-{project}`, created on the first deploy.
Because state lives in your project and not on your machine, the same
setup works on your laptop and in CI.

:::note[Other state stores]
For purely local iteration, use `Alchemy.localState()` instead. It
writes state under `.alchemy/` next to your code. See
[State store](/state-store).
:::

## Connect your project

Point Alchemy at your project once:

<PackageManagers run="alchemy profile edit --add GCP" />

Choose **gcloud login**, pick a gcloud configuration and sign in with your
Google account. (**Service account JSON** works too, with a
key file.) The choice is saved to your `default`
[profile](/environments/profiles).

## Add a Bucket

Declare a Cloud Storage Bucket inside the Stack:

```diff lang="typescript"
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as GCP from "@alchemy.run/gcp";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MyApp",
  {
    providers: GCP.providers(),
    state: GCP.state(),
  },
  Effect.gen(function* () {
+    const bucket = yield* GCP.Storage.Bucket("Bucket", {});
  }),
);
```

`Bucket` is the logical id. Alchemy generates a globally unique bucket
name from the Stack, stage, and logical id.

## Return Stack outputs

Return the values you want to see after a deploy:

```diff lang="typescript"
Effect.gen(function* () {
  const bucket = yield* GCP.Storage.Bucket("Bucket", {});
+
+  return {
+    bucketName: bucket.bucketName,
+  };
}),
```

`bucket.bucketName` is an Output. It resolves during the deploy and
prints with the rest of the outputs.

## Deploy

<PackageManagers run="alchemy deploy" />

```text
Plan: 1 to create
+ Bucket (GCP.Storage.Bucket)

Proceed?
◉ Yes ○ No
✓ Bucket (GCP.Storage.Bucket) created
{
  bucketName: "myapp-live-sam-bucket-a1b2c3d4",
}
```

Alchemy shows the plan, asks for confirmation, creates the Bucket, and
prints the outputs.

## Verify it worked

The Bucket shows up under **Cloud Storage → Buckets** in the console,
or with:

```sh
gcloud storage ls
```

Deploy again. Nothing changed, so there is nothing to do:

```text
Plan: no changes

{
  bucketName: "myapp-live-sam-bucket-a1b2c3d4",
}
```

## Destroy (optional)

`destroy` deletes everything the Stack created:

<PackageManagers run="alchemy destroy" />

Deploy again afterwards if you try it. Part 2 builds on the Bucket.

## Recap

You now have:

- An `alchemy.run.ts` with a Stack and a Cloud Storage Bucket
- A live Bucket in your Google Cloud project
- Stack outputs showing the Bucket name

In [Part 2](/gcp/tutorial/part-2), you put an HTTP service on Cloud
Run that reads and writes objects in this Bucket.
