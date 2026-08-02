import * as Effect from "effect/Effect"
import * as Match from "effect/Match"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function padAesKey(raw: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(32)
  out.set(raw)
  return out.buffer
}

export function generateId(bytes = 16): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

export const hashToken = Effect.fn("auth.crypto.hashToken")(function* (token: string) {
  const digest = yield* Effect.tryPromise(() =>
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
  )
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
})

function normalizeAesKey(key: string): ArrayBuffer {
  const raw = encoder.encode(key)
  return Match.value(raw.byteLength).pipe(
    Match.when(
      (length) => length === 16 || length === 24 || length === 32,
      () => copyToArrayBuffer(raw),
    ),
    Match.when(
      (length) => length >= 32,
      () => copyToArrayBuffer(raw.slice(0, 32)),
    ),
    Match.orElse(() => padAesKey(raw)),
  )
}

export const encryptSecret = Effect.fn("auth.crypto.encryptSecret")(function* (
  plaintext: string,
  keyMaterial: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = yield* Effect.tryPromise(() =>
    crypto.subtle.importKey("raw", normalizeAesKey(keyMaterial), { name: "AES-GCM" }, false, [
      "encrypt",
    ]),
  )
  const encrypted = yield* Effect.tryPromise(() =>
    crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext)),
  )
  const payload = new Uint8Array(iv.byteLength + encrypted.byteLength)
  payload.set(iv, 0)
  payload.set(new Uint8Array(encrypted), iv.byteLength)
  return btoa(String.fromCharCode(...payload))
})

export const decryptSecret = Effect.fn("auth.crypto.decryptSecret")(function* (
  ciphertext: string,
  keyMaterial: string,
) {
  const bytes = Uint8Array.from(atob(ciphertext), (char) => char.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const data = bytes.slice(12)
  const key = yield* Effect.tryPromise(() =>
    crypto.subtle.importKey("raw", normalizeAesKey(keyMaterial), { name: "AES-GCM" }, false, [
      "decrypt",
    ]),
  )
  const decrypted = yield* Effect.tryPromise(() =>
    crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data),
  )
  return decoder.decode(decrypted)
})
