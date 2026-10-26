# testing index

5 pages. How Alchemy tests work — real clouds by default, local emulators on demand, one Stack deploy per suite, isolated stages, deploy → assert → destroy.

| Page | File | Covers |
| --- | --- | --- |
| Testing | `_overview.md` | How Alchemy tests work — real clouds by default, local emulators on demand, one Stack deploy per suite, isolated stages, deploy → assert → destroy. |
| Observability | `observability.md` | Effect emits OpenTelemetry natively and the exporter is a Layer. Provision the receiving end — datasets, monitors, notifiers, alarms — as resources in the same Stack as the code that emits the signals. |
| Test harness | `test-harness.md` | Reference for alchemy/Test — every helper, hook, and option exposed by Test.make for Bun and Vitest. |
| Testing a Stack | `testing-a-stack.md` | Deploy your real Stack once per suite, drive it over HTTP, tear it down. |
| Testing Providers | `testing-providers.md` | Exercise a provider's create, update, replace, and delete paths with test.provider and a scratch in-memory stack. |
