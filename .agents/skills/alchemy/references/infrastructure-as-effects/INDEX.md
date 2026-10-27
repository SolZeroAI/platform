# infrastructure-as-effects index

9 pages. One Effect program models runtime code and infrastructure: Runtimes carry code, Bindings wire resources into them, Phases split deploy from runtime, and Layers package it behind typed services.

| Page | File | Covers |
| --- | --- | --- |
| Bindings | `binding.md` | A Binding connects a Resource to a Worker or Lambda. One line declares the capability and generates the permissions, the configuration, and a typed client. |
| Circular Bindings | `circular-bindings.md` | How to model two services that reference each other (Worker A ↔ Worker B, Lambda ↔ Lambda) using tagged classes and Layers. |
| Custom Runtime | `custom-runtime.md` | Implement your own Runtime resource on the Platform type — a Provider that provisions the compute and bundles the runtime Effect. |
| Event Sources | `event-sources.md` | An event source is a binding that runs your Function when something happens on a resource — one call wires the event-source mapping, the permissions, and a typed handler. |
| Layers | `layers.md` | A Layer defines a service contract with swappable implementations. In Alchemy, a Layer can encapsulate Resources and Bindings, so shared services carry their own infrastructure and permissions. |
| Phases | `phases.md` | Alchemy programs run in two phases — Construction drives the deploy, Runtime handles requests. Knowing which is which is the key to writing Workers and Lambda Functions. |
| Runtime | `runtime.md` | A Runtime is a Resource that carries the code it runs — a Worker, Lambda Function, Container, or Server declared with the Effectful Constructor pattern. Bind what you need, return what you expose. |
| Sinks | `sinks.md` | A Sink is the write-side dual of an Event Source — a Binding that exposes a resource as an Effect Sink, batching writes into the batch API with least-privilege IAM. |
| Telemetry | `telemetry.md` | OpenTelemetry is built into every runtime — exporters are Layers, wired to resources through the binding infrastructure, built per event, and flushed as each request completes. |
