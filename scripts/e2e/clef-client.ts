import { createHmac } from "node:crypto"
import { AgentError } from "e2e"

import { gatewayCache, measuredTokens, recordAiUsage } from "./ai-usage"
import type { AiUsage } from "./ai-usage"

export const CLEF_MODEL_ID = "@cf/cloudflare/clef"

type ClefUsage = { input_tokens?: number; output_tokens?: number }

export type ClefAttempt = {
  usage: ClefUsage | undefined
  cache: AiUsage["cache"]
  httpStatus: number | null
  status: AiUsage["status"]
  startedAt: string
  durationMs: number
}

type ClefCredentials = { account: string; token: string; gateway: string }

/** One Workers AI Clef call through AI Gateway, with the executor's bounded retries. */
export async function postClef<T>(options: {
  signal: AbortSignal
  timeoutMs: () => number
  state: unknown
  questions: Record<string, unknown>
  images?: readonly string[]
  source: AiUsage["source"]
  prepare?: () => void
  onAttempt?: (attempt: ClefAttempt) => void
  accept: (answers: Record<string, unknown>, usage: ClefUsage | undefined) => T
}): Promise<T> {
  const credentials = clefCredentials()
  const images = options.images ?? []
  const body = JSON.stringify({
    model: "clef",
    state: options.state,
    questions: options.questions,
    ...(images.length > 0 ? { images } : {}),
  })
  // Opt in even when the Gateway's default caching is disabled. Scope the opaque
  // key to the credential, account, endpoint and complete identical request.
  const cacheKey = `e2e-clef-${createHmac("sha256", credentials.token)
    .update(JSON.stringify([credentials.account, credentials.gateway, CLEF_MODEL_ID, body]))
    .digest("hex")}`
  const bypass = process.env.CF_AI_GATEWAY_E2E_SKIP_CACHE === "1"
  for (let attempt = 0; attempt < 3; attempt += 1) {
    options.prepare?.()
    const started = performance.now()
    const startedAt = new Date().toISOString()
    let usage: ClefUsage | undefined
    let retryDelay: number | undefined
    let cache: AiUsage["cache"] = bypass ? "bypass" : "unknown"
    let httpStatus: number | null = null
    let status: AiUsage["status"] = "error"
    try {
      const response = await fetch(clefUrl(credentials.account), {
        method: "POST",
        signal: AbortSignal.any([
          options.signal,
          AbortSignal.timeout(Math.max(1, options.timeoutMs())),
        ]),
        headers: {
          authorization: `Bearer ${credentials.token}`,
          "content-type": "application/json",
          "cf-aig-gateway-id": credentials.gateway,
          "cf-aig-authorization": `Bearer ${credentials.token}`,
          "cf-aig-cache-ttl": "3600",
          "cf-aig-cache-key": cacheKey,
          "cf-aig-skip-cache": bypass ? "true" : "false",
        },
        body,
      })
      httpStatus = response.status
      cache = gatewayCache(response.headers, bypass)
      if (!response.ok) {
        if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
          const seconds = Number(response.headers.get("retry-after"))
          retryDelay =
            Number.isFinite(seconds) && seconds > 0
              ? Math.min(seconds * 1000, 5000)
              : 500 * 2 ** attempt
          await response.body?.cancel()
        } else {
          throw new AgentError(
            "MODEL_PROVIDER_FAILED",
            `Cloudflare Clef request failed (HTTP ${response.status}).`,
          )
        }
      } else {
        // SAFETY: the Workers AI REST envelope is untyped JSON. Callers validate each answer.
        const envelope = (await response.json()) as {
          success?: boolean
          result?: { answers?: Record<string, unknown>; usage?: ClefUsage }
        }
        if (envelope.success === false || !envelope.result)
          throw new AgentError("MODEL_OUTPUT_INVALID", "Cloudflare Clef returned no result.")
        usage = envelope.result.usage
        const value = options.accept(envelope.result.answers ?? {}, usage)
        status = "success"
        return value
      }
    } catch (error) {
      options.signal.throwIfAborted()
      if (error instanceof AgentError) throw error
      if (error instanceof TypeError && attempt < 2) retryDelay = 500 * 2 ** attempt
      else
        throw new AgentError(
          "MODEL_PROVIDER_FAILED",
          "The Cloudflare Clef request failed or exceeded its deadline.",
        )
    } finally {
      const inputTokens = measuredTokens(usage?.input_tokens)
      const outputTokens = measuredTokens(usage?.output_tokens)
      recordAiUsage({
        schemaVersion: 1,
        source: options.source,
        model: CLEF_MODEL_ID,
        cache,
        cacheLayer: "gateway",
        requests: 1,
        operations: 0,
        inputTokens,
        outputTokens,
        cachedInputTokens: null,
        status,
        httpStatus,
        startedAt,
      })
      options.onAttempt?.({
        usage,
        cache,
        httpStatus,
        status,
        startedAt,
        durationMs: performance.now() - started,
      })
    }
    if (retryDelay !== undefined) await waitForRetry(options.signal, retryDelay)
  }
  throw new AgentError(
    "MODEL_PROVIDER_FAILED",
    "Cloudflare Clef exhausted its bounded transport retries.",
  )
}

function clefCredentials(): ClefCredentials {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CF_AI_GATEWAY_E2E_TOKEN
  const gateway = process.env.CF_AI_GATEWAY_E2E_ID ?? "default"
  if (!account || !token)
    throw new AgentError(
      "MODEL_UNAVAILABLE",
      "Set CLOUDFLARE_ACCOUNT_ID and CF_AI_GATEWAY_E2E_TOKEN for live Clef steps.",
    )
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-zA-Z0-9_-]+$/.test(gateway))
    throw new AgentError("MODEL_UNAVAILABLE", "Invalid Cloudflare account or gateway identifier.")
  return { account, token, gateway }
}

function clefUrl(account: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CLEF_MODEL_ID}`
}

function waitForRetry(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, delay)
    signal.addEventListener("abort", abort, { once: true })
  })
}
