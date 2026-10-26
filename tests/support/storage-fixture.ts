import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { randomBytes } from "node:crypto"

const kind = process.argv[2]

if (!["r2", "kv", "session"].includes(kind ?? "")) throw new Error("Invalid fixture kind")

const token = randomBytes(48).toString("base64url")

const bundle = await build({
  entryPoints: ["tests/support/storage-worker.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["cloudflare:workers"],
  write: false,
})

function create(role: string) {
  return new Miniflare(
    convertV4MiniflareOptions({
      port: 0,
      telemetry: { enabled: false },
      workers: [
        {
          name: "fixture",
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-10-06",
          kvNamespaces: ["KV"],
          r2Buckets: ["BUCKET"],
          durableObjects: { OBJECTS: { className: "MigrationFixture", useSQLite: true } },
          bindings: {
            MIGRATION_TOKEN: token,
            MIGRATION_RESOURCE_ID: `${role}/${kind}`,
            MIGRATION_STORE_KIND: kind,
            MIGRATION_WRITABLE: role === "destination" ? "true" : "false",
          },
        },
      ],
    }),
  )
}

const source = create("source"),
  destination = create("destination")

try {
  const [sourceUrl, destinationUrl] = await Promise.all([source.ready, destination.ready])

  if (kind === "r2") {
    const bucket = await source.getR2Bucket("BUCKET")
    await bucket.put("workflows/original/code.js", "export default 'original';", {
      httpMetadata: { contentType: "text/javascript" },
      customMetadata: { owner: "original", unicode: "零" },
    })
    await bucket.put("binary/零", new Uint8Array([0, 1, 2, 255]))
    await bucket.put("empty", new Uint8Array())
  } else if (kind === "kv") {
    const kv = await source.getKVNamespace("KV")

    for (let index = 0; index < 105; index++)
      await kv.put(`entry-${String(index).padStart(3, "0")}`, String(index), {
        metadata: { index },
      })
    await kv.put("expiring", "retained", {
      expiration: Math.floor(Date.now() / 1000) + 3600,
      metadata: { type: "ttl" },
    })
    await kv.put("binary", new Uint8Array([0, 255]))
    await kv.put("empty", "")
  } else {
    const response = await fetch(new URL("/seed", sourceUrl), {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) throw new Error("Durable Object fixture could not be seeded")
  }

  process.send?.({ token, sourceUrl: sourceUrl.origin, destinationUrl: destinationUrl.origin })
  let stopping = false

  const stop = async () => {
    if (stopping) return
    stopping = true
    await Promise.all([source.dispose(), destination.dispose()])
    process.disconnect?.()
  }

  process.on("message", () => {
    void stop()
  })
  process.on("disconnect", () => {
    void stop()
  })
  process.on("SIGINT", () => {
    void stop()
  })
  process.on("SIGTERM", () => {
    void stop()
  })
} catch (cause) {
  process.send?.({
    error:
      cause instanceof Error
        ? cause.message.replaceAll(token, "[redacted]").slice(0, 1500)
        : "Storage fixture failed",
  })
  await Promise.all([source.dispose(), destination.dispose()])
  process.exitCode = 1
  process.disconnect?.()
}
