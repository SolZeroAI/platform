import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import { createS0Api } from "../s0"
import { planetscaleStackFlags } from "../stack-flags"
import { stackOptions, type StackOptionsInput } from "../stack"
import { s0StackRuntime } from "./runtime"

export type S0ApiStackOutput = Effect.Success<ReturnType<typeof createS0Api>>
type S0ApiStackServices = Effect.Services<typeof S0ApiProgram>

export class S0Api extends Alchemy.Stack<S0Api, S0ApiStackOutput>()("S0Api") {}

// oxlint-disable-next-line effect/prefer-effect-fn -- Alchemy Stack.make expects an Effect value; Effect.fn changes inference here.
export const S0ApiProgram = Effect.gen(function* () {
  const runtime = yield* s0StackRuntime()
  return yield* createS0Api(runtime)
})

export function makeS0ApiStack(input: StackOptionsInput = {}) {
  return S0Api.make(
    stackOptions<S0ApiStackServices>({ ...planetscaleStackFlags(), ...input }),
    S0ApiProgram,
  )
}

export default makeS0ApiStack()
