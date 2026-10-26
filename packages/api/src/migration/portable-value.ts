/** Lossless encoding for the structured values used by Durable Object KV. Unsupported graphs fail closed. */
type PortableEncoded = readonly [string, ...(readonly unknown[])]

type PortableDecoded =
  | undefined
  | null
  | boolean
  | number
  | string
  | bigint
  | Date
  | ArrayBuffer
  | Uint8Array
  | PortableDecoded[]
  | Set<PortableDecoded>
  | Map<PortableDecoded, PortableDecoded>
  | PortableDecodedRecord

interface PortableDecodedRecord {
  [key: string]: PortableDecoded
}

export function encodePortableValue(value: unknown): string {
  const seen = new WeakSet<object>()

  function encode(item: unknown): PortableEncoded {
    if (item === undefined) return ["undefined"]

    if (item === null || typeof item === "string" || typeof item === "boolean")
      return ["scalar", item]

    if (typeof item === "number" && Number.isFinite(item)) return ["scalar", item]

    if (typeof item === "bigint") return ["bigint", String(item)]

    if (typeof item !== "object" || item === null || seen.has(item))
      throw new Error("Unsupported or shared/cyclic migration value")
    seen.add(item)

    if (item instanceof Date) return ["date", item.toISOString()]

    if (item instanceof ArrayBuffer) return ["buffer", bytesToBase64(new Uint8Array(item))]

    if (item instanceof Uint8Array) return ["bytes", bytesToBase64(item)]

    if (Array.isArray(item)) return ["array", item.map(encode)]

    if (item instanceof Map)
      return ["map", [...item].map(([key, entry]) => [encode(key), encode(entry)])]

    if (item instanceof Set) return ["set", [...item].map(encode)]

    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new Error("Unsupported migration value prototype")

    return [
      Object.getPrototypeOf(item) === null ? "null-object" : "object",
      Object.entries(item).map(([key, entry]) => [key, encode(entry)]),
    ]
  }

  return JSON.stringify(encode(value))
}

export function decodePortableValue(encoded: string): unknown {
  function decode(item: unknown): PortableDecoded {
    if (!Array.isArray(item) || typeof item[0] !== "string")
      throw new Error("Invalid portable migration value")
    const [kind, value] = item

    if (kind === "undefined" && item.length === 1) return undefined

    if (item.length !== 2) throw new Error("Invalid portable migration value")

    if (
      kind === "scalar" &&
      (value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)))
    )
      return value

    if (kind === "bigint" && typeof value === "string" && /^-?[0-9]+$/.test(value))
      return BigInt(value)

    if (kind === "date" && typeof value === "string" && Number.isFinite(Date.parse(value)))
      return new Date(value)

    if ((kind === "buffer" || kind === "bytes") && typeof value === "string") {
      const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

      return kind === "buffer" ? bytes.buffer : bytes
    }

    if (Array.isArray(value)) {
      if (kind === "array") return value.map(decode)

      if (kind === "set") return new Set(value.map(decode))

      if (kind === "map")
        return new Map(
          value.map((pair) => {
            if (!Array.isArray(pair) || pair.length !== 2) throw new Error("Invalid portable map")

            const entry: [PortableDecoded, PortableDecoded] = [decode(pair[0]), decode(pair[1])]

            return entry
          }),
        )

      if (kind === "object" || kind === "null-object") {
        const result: PortableDecodedRecord = Object.create(
          kind === "object" ? Object.prototype : null,
        )

        for (const pair of value) {
          if (
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            typeof pair[0] !== "string" ||
            Object.hasOwn(result, pair[0])
          )
            throw new Error("Invalid portable object")
          Object.defineProperty(result, pair[0], {
            value: decode(pair[1]),
            enumerable: true,
            writable: true,
            configurable: true,
          })
        }

        return result
      }
    }

    throw new Error("Invalid portable migration value")
  }

  return decode(JSON.parse(encoded))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
}
