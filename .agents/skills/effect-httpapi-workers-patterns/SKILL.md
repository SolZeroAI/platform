---
name: effect-httpapi-workers-patterns
description: Build, refactor, or review Effect v4 HttpApi services on Cloudflare Workers. Use when working with effect/unstable/httpapi, HttpApiBuilder, generated Effect clients, typed API contracts, request context, tagged errors, Worker observability, Maple, OpenTelemetry, OTLP, or Cloudflare logs and traces.
---

# Effect HttpApi Workers Patterns

Use this skill when editing or reviewing an Effect HttpApi stack, generated Effect clients, or Cloudflare Worker observability. The patterns are intentionally portable; adapt file paths and config names to the repo.

## Contract And Route Structure

- Keep API contracts separate from server implementation.
  - Contract modules define `HttpApi`, `HttpApiGroup`, endpoints, schemas, tagged errors, and security declarations.
  - Server route modules only implement `HttpApiBuilder.group(...)` live layers.
- Prefer named `Schema.Class` response/request types and `Schema.TaggedErrorClass` errors with `httpApiStatus`.
- Avoid broad `JsonRecord`, `AnyJson`, and generic `{ error: string }` contracts for real endpoints.
- If a generated client requires `unknown` or extra services, fix the schema contract instead of casting at the call site.
- Avoid `as unknown as ...` for Effect client calls. It usually means a helper lost a concrete type or the HttpApi contract is too loose.

## Effect Runtime And Services

- Provide platform/request context as Effect services, not globals or nullable references.
- Keep raw `Response` / `HttpServerResponse` only for streaming, proxying, or other genuinely raw HTTP surfaces.
- Wrap route effects with shared helpers such as `observeRoute(group, endpoint, effect)` instead of scattering logs and spans through handlers.
- Use `Effect.log*`, `Effect.annotateLogs`, `Effect.withLogSpan`, `Effect.withSpan`, and `Effect.annotateCurrentSpan` as the default instrumentation vocabulary.

## Observability Principles

- Make Effect instrumentation the application source of truth: route code should call Effect logs/spans, not framework-specific loggers directly.
- Emit one structured request summary for every request: start/end/error, status, duration, route branch, stream/raw response signal, and sanitized context.
- Request metadata should include `requestId`, `requestIdSrc`, method, path, status, duration, stage/environment, service/worker name, route branch, `cf-ray`, `traceparent`, and `tracestate` when present.
- Always record where the request ID came from:
  - `x-request-id`
  - `cf-ray`
  - generated fallback
- Redact `authorization`, `cookie`, `set-cookie`, `x-api-key`, `cf-access-jwt-assertion`, API tokens, bearer tokens, and provider secrets before logging.

## Cloudflare Workers OTEL

- Enable Worker `observability.logs` and `observability.traces` explicitly in Worker config.
- Prefer Cloudflare native tracing for platform spans: Worker handlers, `fetch`, service bindings, Durable Objects, KV, D1, R2, Queues, and other bindings.
- Configure sampling and persistence intentionally:
  - Dev/previews can usually use `head_sampling_rate: 1`.
  - Production should use metadata/configurable rates.
  - Keep invocation logs enabled until application logs are proven complete.
- Use Cloudflare Observability destinations for platform OTEL export when possible.
- If also exporting Effect app spans/logs via `effect/unstable/observability/Otlp`, pass a base OTLP URL. Do not pass a URL that already ends in `/v1/traces`, `/v1/logs`, or `/v1/metrics` because Effect appends those paths.
- Keep OTLP headers and tokens in secrets/env vars; never in source or non-secret metadata.

## Maple With Effect

- Use `@maple-dev/effect-sdk/cloudflare` for Worker-local Effect logs and traces.
- Provide the Maple telemetry layer to the same runtime that runs route handlers; do not run route telemetry in a separate runtime.
- Flush Maple telemetry at the Worker request boundary with `ctx.waitUntil(telemetry.flush(env))` after the response path has scheduled its Effect logs/spans.
- In local dev, use `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` and run `maple start` before the app dev command.
- Avoid duplicate exports: route code should use Effect logs/spans, the Worker should provide one Maple layer, and Cloudflare Worker Observability should remain the platform collection path for deployed stages.

## Cloudflare Workers General

- Request logs should include: `requestId`, `requestIdSrc`, method, path, status, duration, stage, worker name, route branch, `cf-ray`, and trace headers when present.
- Redact `authorization`, `cookie`, `set-cookie`, `x-api-key`, `cf-access-jwt-assertion`, and similar sensitive headers before logging.
- Do not store request-scoped observability state in module-level mutable variables.
- Use `ctx.waitUntil` for post-response telemetry/drain work.

## TypeScript Hygiene

- Preserve concrete exported helper types for generated clients and cross-package APIs.
- Fix weak source types at the contract boundary rather than widening downstream consumers.
- Use type casts only when wrapping a known library typing limitation, and keep the cast local to the integration boundary.
- Re-run dependent app typechecks after changing API contracts or generated client types.

## Validation

After touching Effect contracts, clients, runtime, or Worker observability, run the repo's required validation. Common commands:

```bash
nub run typecheck
nub run lint
nub run format
```

Also run focused tests when applicable. Example:

```bash
nub exec vitest run tests/integration/api-observability.test.ts tests/integration/effect-api-contract.test.ts tests/integration/repos-discovery-alignment.test.ts
```
