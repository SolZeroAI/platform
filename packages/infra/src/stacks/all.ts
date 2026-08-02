import * as Alchemy from "alchemy"
import { adopt } from "alchemy/AdoptPolicy"
import * as Effect from "effect/Effect"
import { createC0 } from "../c0"
import { stackOptions, type StackOptionsInput } from "../stack"
import { c0StackRuntime } from "./runtime"

export type C0StackOutput = Effect.Success<ReturnType<typeof createC0>>
type C0StackServices = Effect.Services<typeof C0Program>

export class C0 extends Alchemy.Stack<C0, C0StackOutput>()("C0") {}

// oxlint-disable-next-line effect/prefer-effect-fn -- Alchemy Stack.make expects an Effect value; Effect.fn changes inference here.
export const C0Program = Effect.gen(function* () {
  const runtime = yield* c0StackRuntime()
  return yield* createC0(runtime).pipe(adopt(true))
})

export function makeC0Stack(input: StackOptionsInput = {}) {
  return C0.make(stackOptions<C0StackServices>(input), C0Program)
}

export default makeC0Stack()
