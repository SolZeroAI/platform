import * as Schema from "effect/Schema"
import type { MigrationWorkerEnv } from "./env"
import type { DurableObject } from "cloudflare:workers"
import { storageMetadataSchema } from "../../packages/api/src/migration/protocol"
type MigrationObject = DurableObject & { migrationState(request: unknown): Promise<unknown> }

async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 32) return false
  const received = request.headers.get("Authorization") ?? ""
  const encoder = new TextEncoder()
  const [left, right] = await Promise.all(
    [received, `Bearer ${token}`].map((value) =>
      crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  )
  const a = new Uint8Array(left),
    b = new Uint8Array(right)
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}
function metadataHeader(value: unknown) {
  return { "x-s0-metadata": encodeURIComponent(JSON.stringify(value)) }
}
async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing migration request")
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.length
    if (length > 8 * 1024 * 1024) {
      await reader.cancel()
      throw new Error("Migration request too large")
    }
    chunks.push(result.value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(body))
}

/** This separate, temporary operator Worker is never routed through the application. */
export default {
  async fetch(request: Request, env: MigrationWorkerEnv): Promise<Response> {
    const respond = (response: Response) => {
      response.headers.set("Cache-Control", "no-store")
      return response
    }
    if (!(await authorized(request, env.MIGRATION_TOKEN)))
      return respond(new Response(null, { status: 403 }))
    try {
      const url = new URL(request.url),
        kind = env.MIGRATION_STORE_KIND
      if (!env.MIGRATION_RESOURCE_ID || env.MIGRATION_RESOURCE_ID.startsWith("replace-"))
        return respond(new Response(null, { status: 409 }))
      if (request.method === "GET" && url.pathname === "/info")
        return respond(
          Response.json({
            kind,
            resourceId: env.MIGRATION_RESOURCE_ID,
            writable: env.MIGRATION_WRITABLE === "true",
          }),
        )
      if (request.method === "GET" && url.pathname === "/inventory") {
        const cursor = url.searchParams.get("cursor") ?? undefined
        if (kind === "kv") {
          const listed = await env.KV.list({ limit: 100, cursor })
          return respond(
            Response.json({
              kind,
              entries: listed.keys,
              cursor: listed.list_complete ? null : listed.cursor,
            }),
          )
        }
        if (kind === "r2") {
          const listed = await env.BUCKET.list({ limit: 100, cursor })
          return respond(
            Response.json({
              kind,
              entries: listed.objects.map((object) => ({ name: object.key, size: object.size })),
              cursor: listed.truncated ? listed.cursor : null,
            }),
          )
        }
      }
      const key = url.searchParams.get("key")
      if (url.pathname === "/value" && key !== null) {
        if (request.method === "GET") {
          if (kind === "kv") {
            const found = await env.KV.getWithMetadata(key, "arrayBuffer")
            if (found.value === null) return respond(new Response(null, { status: 404 }))
            // Expiration comes from the inventory, metadata is re-read with the value.
            return respond(
              new Response(found.value, { headers: metadataHeader({ metadata: found.metadata }) }),
            )
          }
          if (kind === "r2") {
            const found = await env.BUCKET.get(key)
            if (!found) return respond(new Response(null, { status: 404 }))
            return respond(
              new Response(found.body, {
                headers: metadataHeader({
                  httpMetadata: found.httpMetadata,
                  customMetadata: found.customMetadata,
                  storageClass: found.storageClass || "Standard",
                }),
              }),
            )
          }
        }
        if (request.method === "PUT" && env.MIGRATION_WRITABLE === "true") {
          const metadata = Schema.decodeUnknownSync(storageMetadataSchema, {
            onExcessProperty: "error",
          })(JSON.parse(decodeURIComponent(request.headers.get("x-s0-metadata") ?? "{}")))
          if (kind === "kv") {
            if ((await env.KV.get(key, "arrayBuffer")) !== null)
              return respond(new Response(null, { status: 409 }))
            if (
              metadata.expiration !== undefined &&
              (!Number.isSafeInteger(metadata.expiration) ||
                metadata.expiration < Date.now() / 1000 + 60)
            )
              return respond(new Response(null, { status: 409 }))
            await env.KV.put(key, request.body ?? new Uint8Array(), {
              metadata: metadata.metadata,
              expiration: metadata.expiration,
            })
            return respond(new Response(null, { status: 201 }))
          }
          if (kind === "r2") {
            const httpMetadata = metadata.httpMetadata
              ? {
                  ...metadata.httpMetadata,
                  cacheExpiry: metadata.httpMetadata.cacheExpiry
                    ? new Date(metadata.httpMetadata.cacheExpiry)
                    : undefined,
                }
              : undefined
            const result = await env.BUCKET.put(key, request.body ?? new Uint8Array(), {
              httpMetadata,
              customMetadata: metadata.customMetadata,
              storageClass: metadata.storageClass,
              onlyIf: new Headers({ "If-None-Match": "*" }),
            })
            return respond(new Response(null, { status: result ? 201 : 409 }))
          }
        }
      }
      if (
        ["session", "isolate"].includes(kind) &&
        url.pathname === "/object" &&
        request.method === "POST"
      ) {
        const name = url.searchParams.get("name")
        if (!name) return respond(new Response(null, { status: 400 }))
        const body = await boundedJson(request)
        const read =
          typeof body === "object" &&
          body !== null &&
          "operation" in body &&
          ["inventory", "read", "read-kv", "progress"].includes(String(body.operation))
        if (!read && env.MIGRATION_WRITABLE !== "true")
          return respond(new Response(null, { status: 403 }))
        // SAFETY: the operator config must bind an existing SessionDO or IsolateSessionAgent namespace; both expose this identical privileged RPC, never a client @callable method.
        const namespace = env.OBJECTS as DurableObjectNamespace<MigrationObject>
        return respond(
          Response.json(await namespace.get(namespace.idFromName(name)).migrationState(body)),
        )
      }
      return respond(new Response(null, { status: 404 }))
    } catch {
      // Do not reflect SDK/SQL errors: they may contain imported row data or credentials.
      return respond(
        Response.json(
          {
            error: "migration_operation_failed",
            action:
              "Check resource bindings, schema compatibility, quiescence and page order. No raw driver details are exposed.",
          },
          { status: 409 },
        ),
      )
    }
  },
}
