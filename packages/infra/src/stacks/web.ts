import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import { createS0Web } from "../s0"
import { stackOptions, type StackOptionsInput } from "../stack"
import { s0StackRuntime } from "./runtime"

export type S0WebStackOutput = Effect.Success<ReturnType<typeof createS0Web>>
type S0WebStackServices = Effect.Services<typeof S0WebProgram>

export class S0Web extends Alchemy.Stack<S0Web, S0WebStackOutput>()("S0Web") {}

// oxlint-disable-next-line effect/prefer-effect-fn -- Alchemy Stack.make expects an Effect value; Effect.fn changes inference here.
export const S0WebProgram = Effect.gen(function* () {
  const runtime = yield* s0StackRuntime()
  return yield* createS0Web({
    appName: runtime.appName,
    deploymentMetadata: runtime.deploymentMetadata,
    dev: runtime.dev,
    repoRoot: runtime.repoRoot,
    stageMetadata: runtime.stageMetadata,
  })
})

export function makeS0WebStack(input: StackOptionsInput = {}) {
  return S0Web.make(stackOptions<S0WebStackServices>(input), S0WebProgram)
}

export default makeS0WebStack()
