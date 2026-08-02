import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import { createC0Api } from "../c0"
import { stackOptions, type StackOptionsInput } from "../stack"
import { c0StackRuntime } from "./runtime"

export type C0ApiStackOutput = Effect.Success<ReturnType<typeof createC0Api>>
type C0ApiStackServices = Effect.Services<typeof C0ApiProgram>

export class C0Api extends Alchemy.Stack<C0Api, C0ApiStackOutput>()("C0Api") {}

// oxlint-disable-next-line effect/prefer-effect-fn -- Alchemy Stack.make expects an Effect value; Effect.fn changes inference here.
export const C0ApiProgram = Effect.gen(function* () {
  const runtime = yield* c0StackRuntime()
  return yield* createC0Api(runtime)
})

export function makeC0ApiStack(input: StackOptionsInput = {}) {
  return C0Api.make(stackOptions<C0ApiStackServices>(input), C0ApiProgram)
}

export default makeC0ApiStack()
