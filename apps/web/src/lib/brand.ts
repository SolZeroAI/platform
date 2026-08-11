import { resolveS0Brand } from "@solzero/shared"

export const s0Brand = resolveS0Brand(import.meta.env)

export function getS0Brand() {
  return s0Brand
}
