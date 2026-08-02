import * as Cloudflare from "alchemy/Cloudflare"
import * as Output from "alchemy/Output"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { describe, expect, it } from "vitest"
import { bindWorkerAsyncBindings } from "../../node_modules/alchemy/lib/Cloudflare/Workers/WorkerAsyncBindings.js"

describe("Alchemy Worker async bindings patch", () => {
  it("resolves generated secret outputs before choosing the Worker binding type", async () => {
    const capturedBindings: unknown[] = []
    const worker = {
      bind:
        (_template: TemplateStringsArray, ..._args: unknown[]) =>
        (binding: unknown) =>
          Effect.sync(() => {
            capturedBindings.push(binding)
          }),
    }

    await Effect.runPromise(
      bindWorkerAsyncBindings(
        worker as never,
        {
          env: {
            GENERATED_SECRET: Output.literal(Redacted.make("generated-secret")),
          },
        } as never,
      ),
    )

    const binding = await Effect.runPromise(Output.evaluate(capturedBindings[0], {}))

    expect(binding).toEqual({
      bindings: [
        {
          type: "secret_text",
          name: "GENERATED_SECRET",
          text: "generated-secret",
        },
      ],
      hyperdrives: undefined,
    })
  })

  it("classifies resource references before deferring unresolved outputs", async () => {
    const capturedBindings: unknown[] = []
    const worker = {
      workerName: Output.literal("host-worker"),
      bind:
        (_template: TemplateStringsArray, ..._args: unknown[]) =>
        (binding: unknown) =>
          Effect.sync(() => {
            capturedBindings.push(binding)
          }),
    }
    await Effect.runPromise(
      Effect.gen(function* () {
        const referencedWorker = yield* Cloudflare.Worker.ref("ReferencedWorker")
        yield* bindWorkerAsyncBindings(
          worker as never,
          {
            env: {
              REFERENCED_WORKER: referencedWorker,
            },
          } as never,
        )
      }),
    )

    expect(Output.isOutput(capturedBindings[0])).toBe(false)
    expect(capturedBindings[0]).toMatchObject({
      bindings: [
        {
          type: "service",
          name: "REFERENCED_WORKER",
        },
      ],
    })
  })
})
