# git index

25 pages. A pluggable, embeddable, self-hostable git server on Cloudflare Workers, Durable Objects, and R2. Smart HTTP for any client, a typed REST plane with pull requests, and a GitHub-compatible API.

| Page | File | Covers |
| --- | --- | --- |
| Git | `_overview.md` | A pluggable, embeddable, self-hostable git server on Cloudflare Workers, Durable Objects, and R2. Smart HTTP for any client, a typed REST plane with pull requests, and a GitHub-compatible API. |
| Cloning & pushing | `clone-and-push.md` | Standard git clients over smart HTTP. What the wire supports, where credentials go, and what to do when something hangs. |
| Getting Started | `getting-started.md` | A complete quickstart for a Git host protected by a shared credential. Deploy it to Cloudflare, push a repository, and clone it back. |
| GitHub API compatibility | `github-api.md` | Point the gh CLI and Octokit at your host with the /api/v3 facade. |
| Pull requests | `pull-requests.md` | Server-side merge base, tree diffs, and fast-forward or three-way merges, computed inside the repository. |
| Repositories | `repositories.md` | Create, fork, import, and manage repositories over the typed REST plane. |

## blocks/

| Page | File | Covers |
| --- | --- | --- |
| Overview | `blocks/_overview.md` | One layer graph, provided once, builds the Worker and every Durable Object behind it. Each line is a decision with implementations you choose or write. |
| Authentication and authorization | `blocks/auth.md` | Use native Effect HTTP middleware and ordinary application effects to authorize Git operations. |
| Blob Store | `blocks/blob-store.md` | Bulk, immutable, content-addressed bytes. R2 by default, S3 when data has to live in AWS, or any store that can do ranged reads and multipart writes. |
| Engine operations | `blocks/engine.md` | Build your own HTTP API over Git operations, with scoped preparation, application authorization, and explicit commit. |
| Hasher | `blocks/hasher.md` | Every object a push sends is inflated and hashed before a ref moves. That is CPU, and where it runs is a Layer, in the Worker, in dynamically loaded Workers, or on Lambda. |
| Registry | `blocks/registry.md` | The registry resolves owner/name to a repository and serves listings. Keep it in a Durable Object or move it to a D1 database. |
| Repository | `blocks/repositories.md` | One Durable Object per repository, behind the Git.RepoStore service. Provide it, call it from your own routes, compose operations through Git.Engine, or implement its shape over another store. |
| HTTP routes | `blocks/server.md` | Compose Git route layers beside your application's Effect HTTP API, with your middleware and server. |

## recipes/

| Page | File | Covers |
| --- | --- | --- |
| Overview | `recipes/_overview.md` | Requirements pick lines. One table from what you need to the line that changes, the stack shape for one cloud or two, and complete files to copy. |
| Bytes in S3, hashing on Lambda | `recipes/cloudflare-aws.md` | Compute on Cloudflare, bytes in S3, and large pushes hashed one Lambda per chunk. One stack carries both provider sets, and Alchemy mints the cross-cloud identity. |
| All on Cloudflare | `recipes/cloudflare.md` | A git host on one Cloudflare account. One Worker, one bucket, two Durable Object namespaces, and dynamically loaded Workers hashing large pushes. |
| Scaling | `recipes/scaling.md` | Reads scale like a CDN and writes scale like git. The shape, the per-repository limits, the measured numbers, and a worked example of pushing something large and swapping the hasher. |
| Bring your own store | `recipes/your-own-store.md` | Bytes have to live somewhere that is neither R2 nor S3. Implement the five operations of Git.BlobStore and provide it in place of the shipped Layers. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Push your first repository | `tutorial/part-1.md` | Deploy a Git host, push a commit, and clone it back. Add storage and hashing one layer at a time. |
| Part 2: Control access | `tutorial/part-2.md` | Protect the existing Git host with one shared credential, then verify both accepted and rejected requests. |
| Part 3: Publish a repository | `tutorial/part-3.md` | Allow anonymous clones of public repositories while preserving authenticated writes. |
| Part 4: Give users their own credentials | `tutorial/part-4.md` | Replace the shared credential with Better Auth accounts and individual Git API keys. |
| Part 5: Add your application's API | `tutorial/part-5.md` | Add a typed /me endpoint beside Git and use the caller already supplied by your authentication middleware. |
| Part 6: Protect a branch | `tutorial/part-6.md` | Authorize parsed Git mutations in ordinary HTTP handlers, using the request's user before committing changes. |
