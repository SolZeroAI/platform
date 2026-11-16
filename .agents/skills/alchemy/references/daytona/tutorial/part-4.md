<!-- source: https://alchemy.run/daytona/tutorial/part-4
     upstream: website/src/content/docs/daytona/tutorial/part-4.mdx
     alchemy 2.0.0-beta.86 @ 21c6012 -->

# Part 4: Update the Snapshot

> Move the Daytona snapshots to a new Node.js version, redeploy, and see new sandboxes start from it while existing ones keep theirs.

## Change the image

Move the snapshots to Node.js 24:

```diff lang="typescript"
// src/Images.ts
export const Base = Daytona.Snapshot("Base", {
-  image: "node:22-bookworm",
+  image: "node:24-bookworm",
  cpu: 1,
  memory: 1,
  disk: 3,
});
```

## Deploy the new base

<PackageManagers run="alchemy deploy" />

A snapshot can't be changed, so a new image replaces `Base`. `Warm` starts from `Base`, so it's captured again on the new image, with the repository cloned into it. The Worker is unchanged and isn't redeployed.

<PackageManagers script={`curl -X POST "$URL/run" -d 'node --version'`} />

## Running sandboxes keep what they started with

A sandbox keeps the disk it booted with. Users who already have a sandbox keep it, with their changes and Node.js 22. Sandboxes started after the deploy get the new base. To move a user onto it, delete their sandbox; their next request starts a new one from `Warm`.

## Next

[Part 5](/daytona/tutorial/part-5) tests it.
