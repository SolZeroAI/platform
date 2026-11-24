# modal index

28 pages. Run Functions, Servers and Sandboxes on Modal with Alchemy. Declare apps, images, volumes and secrets in TypeScript, and create sandboxes from any Worker or Lambda.

| Page | File | Covers |
| --- | --- | --- |
| Modal | `_overview.md` | Run Functions, Servers and Sandboxes on Modal with Alchemy. Declare apps, images, volumes and secrets in TypeScript, and create sandboxes from any Worker or Lambda. |
| Setup | `setup.md` | Log in to Modal, or give Alchemy a Modal token. |
| What is Modal? | `what-is-modal.md` | The concepts behind Modal — workspaces and tokens, environments, apps, images, Functions, Servers, Sandboxes, Volumes, Dicts, Queues and Secrets — and how @alchemy.run/modal models each of them. |
| Workspaces and tokens | `workspaces-and-tokens.md` | How a Modal workspace holds everything, how environments keep stages apart, how profiles choose the workspace, and the service users your runtimes act as. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Choosing a runtime | `compute/choosing-a-runtime.md` | Functions, Servers, program sandboxes and sandboxes created at run time on Modal, and when to use each. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| Network & tunnels | `networking/network.md` | Limit what a Modal Sandbox can reach, reach its ports through tunnels, and give its traffic static egress IPs. |

## sandboxes/

| Page | File | Covers |
| --- | --- | --- |
| Images | `sandboxes/images.md` | Build Modal images from a registry image, a Dockerfile, or another image, and start sandboxes with a repository already installed. |
| Persistent sandboxes | `sandboxes/persistent.md` | One Modal sandbox whose filesystem outlives its sessions, resumed from a Worker. |
| Programs | `sandboxes/programs.md` | Run your own Effect or Node program in Modal sandboxes and call it over HTTP. |
| Sandboxes | `sandboxes/sandboxes.md` | Create, find, run commands in, and stop Modal sandboxes from any runtime. |
| Snapshots | `sandboxes/snapshots.md` | Save a Modal sandbox's files, its memory, or one directory, and start new sandboxes from it. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Access control | `security/access-control.md` | Separate workloads with environments, member roles and scoped tokens. |
| Secrets | `security/secrets.md` | Give Modal Functions, Servers and Sandboxes API keys and passwords as Modal Secrets, as environment variables or added to requests on the way out. |

## services/

| Page | File | Covers |
| --- | --- | --- |
| Autoscaling | `services/autoscaling.md` | Keep containers warm and cap concurrency for a deployed Modal function. |
| Call Python functions | `services/calling-python.md` | Call functions you deployed with modal deploy from a Worker or Lambda. |
| Functions | `services/functions.md` | Run your program as a Modal Function that other runtimes call, on a schedule, or on the web. |
| Operate services | `services/operating.md` | Read logs, stats and request history, scale, and roll back Modal Functions, Servers and Apps at runtime. |
| Servers | `services/servers.md` | Run a long-running HTTP server on Modal with regional routing and concurrency-based autoscaling. |
| Web endpoints | `services/web-endpoints.md` | Serve a Modal Function on the web at a modal.run URL. |

## storage/

| Page | File | Covers |
| --- | --- | --- |
| Dicts | `storage/dicts.md` | Share key-value data between Modal sandboxes, functions and Workers. |
| Queues | `storage/queues.md` | Hand work between Workers, Modal sandboxes and Python functions with a Modal Queue. |
| Volumes | `storage/volumes.md` | Keep files on Modal volumes and read or write them without a sandbox. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Build a Warm Image | `tutorial/part-1.md` | Declare a Modal environment, an app, and a warm image with a repository cloned, all built at deploy time. |
| Part 2: Start Sandboxes from It | `tutorial/part-2.md` | A Cloudflare Worker that starts a Modal sandbox from the warm image for each command, and reads back its output. |
| Part 3: A Copy per User | `tutorial/part-3.md` | Give each user a Modal volume of their own, mounted into every sandbox they start from the warm image. |
| Part 4: Update the Image | `tutorial/part-4.md` | Change the warm Modal image, redeploy, and see new sandboxes start from the new image while users keep their files. |
| Part 5: Testing | `tutorial/part-5.md` | Deploy the Stack in a test, start a sandbox from the warm image, and check it sees the warm image and the user's files. |
| Part 6: Stages and CI | `tutorial/part-6.md` | Deploy a stage per environment and per pull request, each in its own Modal environment with its own images. |
