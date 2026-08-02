import { exports } from "cloudflare:workers"
import { afterAll, beforeAll } from "vitest"

beforeAll(async () => {
  const worker = exports as unknown as {
    readonly default: { fetch(request: Request): Response | Promise<Response> }
  }
  await worker.default.fetch(new Request("http://facet-test-warmup/"))
}, 60_000)

// Agent-tool cancellation finishes a small amount of SDK reconciliation after
// the awaited result settles. Let those close handlers drain before Vitest
// invalidates the Worker module graph.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)))
