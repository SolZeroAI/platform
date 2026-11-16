# infrastructure-as-code index

12 pages. The noun graph: Stacks, Resources, Actions, Outputs, references, lifecycle, providers.

| Page | File | Covers |
| --- | --- | --- |
| Actions | `action.md` | A node in the dependency graph that runs an Effect during apply when its inputs change. |
| Provider Contributions | `contributions.md` | Ship a provider's auth, state stores and CLI commands in a package, so the alchemy CLI finds them without a stack. |
| Custom Provider | `custom-provider.md` | Add support for a new cloud or third-party API by declaring a Resource type and implementing its lifecycle as an Effect Layer. |
| DNS Adapters | `dns-adapters.md` | Publish a custom domain's DNS records in Route 53, Cloudflare, or Hetzner DNS from any platform, and build an adapter for another DNS host. |
| Local Provider | `local-provider.md` | Build the local implementation of a resource — dual registration with ProviderLayer.dual and the LocalProvider runner for long-running processes. |
| Inputs & Outputs | `outputs.md` | Output<T> is alchemy's lazy reference type — the lazy values that flow between resources, get composed with .pipe, mapped, interpolated, and resolved during deploy. |
| Providers | `provider.md` | Providers implement the lifecycle operations for a resource type — reconcile, delete, diff, read, and more. |
| References | `references.md` | Read an already-deployed Resource or Stack at plan time — Resource.ref by Logical ID with optional stack/stage props, Resource.lookup for resources Alchemy doesn't manage, or import a Stack tag and depend on its outputs. |
| Renaming Resources | `renaming.md` | Migrate a resource's state across a logical ID change instead of replacing it. |
| Resource Lifecycle | `resource-lifecycle.md` | How alchemy plans, applies, replaces, and destroys resources — and how to think about idempotency and recovery. |
| Resources | `resource.md` | Resources are named cloud entities with input properties and output attributes. |
| Stacks | `stack.md` | A Stack is a collection of Resources deployed together as a unit. |
