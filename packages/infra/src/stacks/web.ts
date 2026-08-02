import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import { createC0Web } from "../c0"
import { stackOptions, type StackOptionsInput } from "../stack"
import { c0StackRuntime } from "./runtime"

export type C0WebStackOutput = Effect.Success<ReturnType<typeof createC0Web>>
type C0WebStackServices = Effect.Services<typeof C0WebProgram>

export class C0Web extends Alchemy.Stack<C0Web, C0WebStackOutput>()("C0Web") {}

// oxlint-disable-next-line effect/prefer-effect-fn -- Alchemy Stack.make expects an Effect value; Effect.fn changes inference here.
export const C0WebProgram = Effect.gen(function* () {
  const runtime = yield* c0StackRuntime()
  return yield* createC0Web({
    appName: runtime.appName,
    deploymentMetadata: runtime.deploymentMetadata,
    dev: runtime.dev,
    repoRoot: runtime.repoRoot,
    stageMetadata: runtime.stageMetadata,
  })
})

export function makeC0WebStack(input: StackOptionsInput = {}) {
  return C0Web.make(stackOptions<C0WebStackServices>(input), C0WebProgram)
}

export default makeC0WebStack()
