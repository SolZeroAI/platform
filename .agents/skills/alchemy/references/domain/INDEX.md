# domain index

44 pages. A domain-driven design framework for Effect. Model your business as commands, aggregates, events, views, projections and policies, test it in memory, and run it on Durable Objects on Cloudflare, Rivet or Effect Cluster.

| Page | File | Covers |
| --- | --- | --- |
| Domain | `_overview.md` | A domain-driven design framework for Effect. Model your business as commands, aggregates, events, views, projections and policies, test it in memory, and run it on Durable Objects on Cloudflare, Rivet or Effect Cluster. |
| Aggregate | `aggregate.md` | How an aggregate holds state, decides commands, applies events, and keeps its rules consistent. |
| Annotations | `annotations.md` | Describe every declaration in an @alchemy.run/domain model, show the descriptions in MCP tools, CLI help and OpenAPI, and add keys of your own for tooling built on the model. |
| Api | `api.md` | How an Api publishes a model to one kind of client, how it's served, and how a typed client calls it. |
| History at scale | `backfill.md` | How a deploy backfills new views and projections on Cloudflare, how long it takes, and how to run a large Domain within Cloudflare's limits. |
| Sign in with better-auth | `better-auth.md` | Sign users in to a Domain Api with GitHub or Google through better-auth, and give every command and view the signed-in user. |
| CLI | `cli.md` | Run an Api's calls from a terminal, as a person or an agent, against the deployed Api. |
| Cloudflare Durable Objects | `cloudflare.md` | Host a domain model on Durable Objects behind a Worker, with live reads over WebSockets. |
| Command | `command.md` | How a command names its target, carries its data, declares every outcome, and reaches its aggregate exactly once. |
| Deadlines | `deadlines.md` | Give a waiting process a time limit with a scheduled command, and let the aggregate decide whether the deadline or the action wins. |
| Effect Cluster | `effect-cluster.md` | Host a domain model on Effect Cluster entities, with its state in Postgres and its runners on any cloud. |
| Event | `event.md` | What an event records, what to put in it, how it's stored, and how the rest of the model consumes it. |
| External System | `external-system.md` | Declare the outside systems your model calls in the model's own language, implement them with Layers, and turn their events into commands. |
| Integrate with Foldkit | `foldkit.md` | Derive Foldkit Commands from an Api, ask its queries, follow View snapshots, and seed the Model from Flags. |
| Plain HTTP and OpenAPI | `http-api.md` | Publish an Api as a plain HTTP JSON API, with an OpenAPI document, from the same Api. |
| In memory | `in-memory.md` | Run a domain model in a single process, for tests and for apps that don't need Cloudflare. |
| Offline and local first | `local-first.md` | Choose how local an app is, and keep it working offline by recording intents and sending them when the connection returns. |
| MCP | `mcp.md` | Give an agent the commands and reads of an Api as tools, inside the app with Effect AI, or outside it over MCP. |
| Domain Model | `model.md` | What a domain model contains, how it processes every command, and how you declare, run and use one. |
| Observability | `observability.md` | Trace how commands, events and reactions flow through an @alchemy.run/domain model, across Durable Objects and over hours. Automatic spans, correlation ids and metrics, plus the attributes your handlers record. |
| Optimistic updates | `optimistic-updates.md` | Show pending intent, confirm it by commandId from a View feed, and retry an unknown outcome safely. |
| Policy | `policy.md` | How a policy reacts to events with commands and calls to outside systems, and how to make it safe to run more than once. |
| Project layout | `project-layout.md` | How to lay out an @alchemy.run/domain project. One file per building block, named after its noun and its kind; folders per subdomain; a pure domain package, a server package that hosts it, and a foldkit web package, wired in one stack. |
| Projection | `projection.md` | How a projection consumes events into a store you own, in order per key, batched and replayable, and why it never sends commands. |
| Query | `query.md` | How a query serves a projection's store to clients across keys, typed, authorized by its handler, paged by cursor, and consistent with the caller's own writes. |
| Rivet | `rivet.md` | Host a domain model on Rivet Durable Objects, on nodes in any cloud, and serve its Apis from any runtime. |
| Saga | `saga.md` | A process that spans several aggregates and takes time, run step by step as an Effect workflow, with steps that undo earlier ones when a later one fails. |
| Sessions and middleware | `sessions.md` | Authenticate every request, carry who is asking into the domain, and sign browsers in with a cookie. |
| Story | `story.md` | A specification you can run. Given some history, when a command is sent, then these events are recorded. |
| Stream | `stream.md` | How a stream keeps a keyed, append-only log that a projection writes and clients read through an Api, with its latest entry as the current value. |
| Testing an Api | `testing-apis.md` | Test what each client may do and see, in process, over HTTP, and against a real deployment. |
| Testing a model | `testing-models.md` | Test your model's rules, views, policies and deadlines with stories that run it in memory. |
| Unique values | `unique-values.md` | Keep a value unique across every customer by making the value itself an aggregate. |
| Views as security boundaries | `view-security.md` | Decide who may read each view, keep watches honest as data changes hands, and give each audience a view of its own. |
| View | `view.md` | How a view folds events into a read model per key, emits events of its own, combines other views, and serves reads. |
| What is Domain-Driven Design? | `what-is-ddd.md` | The concepts of Domain-Driven Design, event sourcing and CQRS, and how they fit together to model a business. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Model an account | `tutorial/part-1.md` | Declare events, commands and rejections, decide them in an aggregate, and check it with stories. |
| Part 2: Read it with a view | `tutorial/part-2.md` | Show each account's balance and a statement of every movement, kept up to date as events arrive. |
| Part 3: React with a policy | `tutorial/part-3.md` | Register customers, and open a main account for each one with a policy. |
| Part 4: Expose an Api | `tutorial/part-4.md` | Authenticate requests, let customers act only on their own accounts, and expose the bank through a typed Api. |
| Part 5: Deploy to Cloudflare | `tutorial/part-5.md` | Host the bank on Durable Objects behind a Worker, run it locally, deploy it, and watch a balance change live. |
| Part 6: Build the UI with foldkit | `tutorial/part-6.md` | A browser app that signs in with a cookie, opens an account, deposits, and watches its balance live. |
| Part 7: Observe it | `tutorial/part-7.md` | Send the bank's traces and logs to Axiom, follow a deposit through every Durable Object it reaches, and trace clicks from the browser. |
| Part 8: Change a deployed model | `tutorial/part-8.md` | Change what a view computes after it has data, add a view over every account, and follow what each deploy does with the events already recorded. |
