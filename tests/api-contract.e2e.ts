import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import * as Schema from "effect/Schema"
import { CreatedApiKeyResponse, ApiKeysResponse } from "../packages/api/src/http/schemas/auth"
import { SessionResponse } from "../packages/api/src/http/schemas/sessions"
import { ForbiddenError } from "../packages/api/src/http/errors"
import { api, authRequest, uniqueName } from "./support/api"
import { resolveOpenApiSchema } from "./support/openapi"

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
      // The isolated account has no GitHub App authorization, so the repository list is forbidden.
      const repos = await authRequest(browser, "/repos")
      expect(repos.status).toBe(403)
      expect(Schema.decodeUnknownSync(ForbiddenError)(repos.payload)).toBeDefined()
      const spec = await fetch("http://localhost:3100/openapi.json")
      expect(spec.status).toBe(200)
      const document = await spec.json()
      const createdSchema = document.components.schemas.CreatedApiKeyResponseEncoded
      expect(createdSchema.required).toEqual(["keyId", "key", "label", "createdAt"])
      expect(Object.hasOwn(createdSchema.properties, "apiKey")).toBe(false)

      const runSchema = resolveOpenApiSchema(
        document,
        document.paths["/sessions/run"].post.requestBody.content["application/json"].schema,
      )

      expect(runSchema.required).not.toContain("sessionKind")
      expect(runSchema.propertyHasDefault("sessionKind")).toBe(false)

      const stateSchema = resolveOpenApiSchema(
        document,
        document.paths["/sessions/{id}"].get.responses["200"].content["application/json"].schema,
      )

      expect(stateSchema.required).toContain("id")
      expect(stateSchema.required).toContain("agentRuntime")
      expect(stateSchema.hasProperty("session")).toBe(false)
    } finally {
      await api(browser, `/auth/api-keys/${created.keyId}`, "DELETE")
      await api(browser, `/sessions/${session.sessionId}`, "DELETE")
    }
  },
)
