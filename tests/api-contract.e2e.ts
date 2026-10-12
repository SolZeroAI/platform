import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import * as Schema from "effect/Schema"
import { CreatedApiKeyResponse, ApiKeysResponse } from "../packages/api/src/http/schemas/auth"
import { SessionResponse } from "../packages/api/src/http/schemas/sessions"
import { api, uniqueName } from "./support/api"

test(
  "exported API key and session schemas decode actual Worker responses",
  { session: "admin" },
  async ({ browser }) => {
    const created = await api<{ keyId: string; key: string }>(browser, "/auth/api-keys", "POST", {
      label: uniqueName("e2e-contract"),
    })
    const session = await api<{ sessionId: string }>(browser, "/sessions", "POST", {
      title: uniqueName("e2e-contract"),
      agentRuntime: "isolate",
    })
    try {
      const decoded = Schema.decodeUnknownSync(CreatedApiKeyResponse)(created)
      expect(decoded).toBeDefined()
      const keys = await api<unknown>(browser, "/auth/api-keys")
      expect(Schema.decodeUnknownSync(ApiKeysResponse)(keys)).toBeDefined()
      const state = await api<unknown>(browser, `/sessions/${session.sessionId}`)
      expect(Schema.decodeUnknownSync(SessionResponse)(state)).toBeDefined()
      const spec = await fetch("http://localhost:3100/openapi.json")
      expect(spec.status).toBe(200)
      const document = await spec.json()
      const createdSchema = document.components.schemas.CreatedApiKeyResponseEncoded
      expect(createdSchema.required).toEqual(["keyId", "key", "label", "createdAt"])
      expect(Object.hasOwn(createdSchema.properties, "apiKey")).toBe(false)
      const runRef = document.paths["/sessions/run"].post.requestBody.content[
        "application/json"
      ].schema.$ref
        .split("/")
        .pop()
      const runSchema = document.components.schemas[runRef]
      expect(runSchema.required ?? []).not.toContain("sessionKind")
      expect(Object.hasOwn(runSchema.properties.sessionKind, "default")).toBe(false)
      const stateRef = document.paths["/sessions/{id}"].get.responses["200"].content[
        "application/json"
      ].schema.$ref
        .split("/")
        .pop()
      const stateSchema = document.components.schemas[stateRef]
      expect(stateSchema.required).toContain("id")
      expect(stateSchema.required).toContain("agentRuntime")
      expect(Object.hasOwn(stateSchema.properties, "session")).toBe(false)
    } finally {
      await api(browser, `/auth/api-keys/${created.keyId}`, "DELETE")
      await api(browser, `/sessions/${session.sessionId}`, "DELETE")
    }
  },
)
