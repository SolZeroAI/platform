import { test, expect } from "e2e"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import {
  canonicalApiPath,
  publicApiUrl,
  resolveS0Config,
  getStageMetadataFromConfigSync,
  withWorkersDevOrigins,
} from "@solzero/shared"
import { OpenApi } from "effect/http-api"
import { apiForBrand } from "../packages/api/src/http"
import { exampleDeploymentConfig } from "./support/deployment-config"

function configured() {
  const source = exampleDeploymentConfig()

  return resolveS0Config({
    ...source,
    deployment: { ...source.deployment, zone: "example.test", webFqdn: "agent.example.test" },
  })
}

test("API configuration has no separate API hostname", async () => {
  const source = exampleDeploymentConfig()
  let error = ""

  try {
    resolveS0Config({
      ...source,
      deployment: { ...source.deployment, apiFqdn: "api.example.test" },
    })
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unexpected error"
  }

  expect(error).toContain("apiFqdn")
})

test("stage metadata binds only API paths and keeps public URLs distinct from internal transport", async () => {
  const config = configured()

  for (const name of ["pre", "pre-123", "prod"]) {
    const stage = getStageMetadataFromConfigSync(name, config.deployment, config.application)
    expect(stage.infra.serverUrl).toBe("https://agent.example.test/api")
    expect(stage.infra.authBaseUrl).toBe("https://agent.example.test")
    expect(stage.infra.webDomains).toEqual(["agent.example.test"])
    expect(stage.infra.apiRoutes).toEqual(["agent.example.test/api", "agent.example.test/api/*"])
  }

  const local = getStageMetadataFromConfigSync("dev", config.deployment, config.application)
  expect(local.infra.serverUrl).toBe("http://localhost:3000/api")
  expect(local.infra.apiRoutes).toEqual([])

  const remoteLocal = getStageMetadataFromConfigSync(
    "pre-123",
    { ...config.deployment, zone: "localhost" },
    config.application,
  )

  const workersDev = withWorkersDevOrigins(remoteLocal, {
    appName: "fixture",
    subdomain: "account",
  })

  expect(workersDev.infra.serverUrl).toBe("https://fixture-web-pre-123.account.workers.dev/api")
  expect(workersDev.infra.apiRoutes).toEqual([])
})

test("public API URLs retain the base path, stable webhook ID and OpenAPI server", async () => {
  const base = "https://agent.example.test/api"
  expect(publicApiUrl(base, "/workflows/webhooks/original-id")).toBe(
    `${base}/workflows/webhooks/original-id`,
  )
  expect(OpenApi.fromApi(apiForBrand("Fork", base)).servers).toEqual([{ url: base }])
})

test("public prefix normalization respects Better Auth, API-key ownership and segment boundaries", async () => {
  for (const [input, output] of [
    ["/api", "/"],
    ["/api/health", "/health"],
    ["/api/auth/config", "/api/auth/config"],
    ["/api/auth/callback/okta", "/api/auth/callback/okta"],
    ["/api/auth/api-keys", "/auth/api-keys"],
    ["/api/auth/api-keys/key", "/auth/api-keys/key"],
    ["/api/authentication", "/authentication"],
    ["/apiary", "/apiary"],
    ["/api/workflows/webhooks/id%2Fpart", "/workflows/webhooks/id%2Fpart"],
    ["/api/mcp", "/mcp"],
    ["/health", "/health"],
  ])
    expect(canonicalApiPath(input)).toBe(output)
})

test("real Worker service binding preserves auth, raw webhook bodies, streaming, redirects, cookies and WebSockets", async () => {
  const bundle = await build({
    entryPoints: ["tests/support/api-routing-worker.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
  })

  const script = bundle.outputFiles[0].text

  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      port: 0,
      telemetry: { enabled: false },
      workers: [
        {
          name: "web",
          modules: true,
          script,
          compatibilityDate: "2026-10-06",
          bindings: { ROLE: "web" },
          serviceBindings: { API: "api" },
        },
        {
          name: "api",
          modules: true,
          script,
          compatibilityDate: "2026-10-06",
          bindings: { ROLE: "api" },
        },
      ],
    }),
  )

  try {
    await runtime.ready
    // Ephemeral transport markers, not credentials accepted by an auth service.
    const marker = crypto.randomUUID()

    const response = await runtime.dispatchFetch(
      "https://public.example/api/workflows/webhooks/original-id?value=a%2Fb",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${marker}`,
          "x-api-key": marker,
          cookie: `session=${marker}`,
          "x-hub-signature-256": marker,
        },
        body: new Uint8Array([0, 255, 10, 13, 123, 125]),
      },
    )

    expect(await response.json()).toEqual({
      pathname: "/workflows/webhooks/original-id",
      search: "?value=a%2Fb",
      method: "POST",
      authorization: `Bearer ${marker}`,
      apiKey: marker,
      cookie: `session=${marker}`,
      signature: marker,
      body: [0, 255, 10, 13, 123, 125],
    })

    const withoutBrowserSession = await runtime.dispatchFetch(
      "https://public.example/api/github/webhook",
      {
        method: "POST",
        body: "signed payload",
        headers: { "x-hub-signature-256": marker },
      },
    )

    expect(await withoutBrowserSession.json()).toMatchObject({ cookie: null })

    const redirect = await runtime.dispatchFetch("https://public.example/api/redirect", {
      redirect: "manual",
    })

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toBe("/api/auth/callback/fixture")
    expect(redirect.headers.getSetCookie()).toHaveLength(2)
    const stream = await runtime.dispatchFetch("https://public.example/api/stream")
    expect(stream.headers.get("content-type")).toBe("text/event-stream")
    const reader = stream.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n")
    // There is no EOF: buffering at the web boundary would never yield this chunk.
    await reader.cancel()

    const upgraded = await runtime.dispatchFetch("https://public.example/api/socket", {
      headers: { Upgrade: "websocket" },
    })

    expect(upgraded.status).toBe(101)
    const socket = upgraded.webSocket
    expect(socket).toBeDefined()

    if (!socket) throw new Error("Missing WebSocket upgrade")
    socket.accept()

    const echoed = new Promise((accept) =>
      socket.addEventListener("message", (event) => accept(event.data), { once: true }),
    )

    socket.send("round-trip")
    expect(await echoed).toBe("round-trip")
    socket.close(1000)
  } finally {
    await runtime.dispose()
  }
})
