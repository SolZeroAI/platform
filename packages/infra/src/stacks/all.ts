import * as Alchemy from "alchemy"
import { adopt } from "alchemy/AdoptPolicy"
import * as Effect from "effect/Effect"
import { createS0 } from "../s0"
import { planetscaleStackFlags } from "../stack-flags"
import { stackOptions, type StackOptionsInput } from "../stack"
import { s0StackRuntime } from "./runtime"

export type S0StackOutput = Effect.Success<ReturnType<typeof createS0>>
type S0StackServices = Effect.Services<typeof S0Program>

export class S0 extends Alchemy.Stack<S0, S0StackOutput>()("S0") {}

// oxlint-disable-next-line effect/prefer-effect-fn -- Alchemy Stack.make expects an Effect value; Effect.fn changes inference here.
export const S0Program = Effect.gen(function* () {
  const runtime = yield* s0StackRuntime()
  return yield* createS0(runtime).pipe(adopt(true))
})

export function makeS0Stack(input: StackOptionsInput = {}) {
  return S0.make(stackOptions<S0StackServices>({ ...planetscaleStackFlags(), ...input }), S0Program)
}

export default makeS0Stack()
