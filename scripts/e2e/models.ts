import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai"
import * as P from "effect/Predicate"

// Shared Project DNA: every SolZero repository keeps this file identical.
// E2E_DECISION_MODEL and E2E_LANGUAGE_MODEL are SolZeroAI organization Actions
// variables, so CI changes models for the fleet in one place. The defaults
// below serve local runs and must match the DNA page.
const DEFAULT_DECISION_MODEL = "@cf/cloudflare/clef"
const DEFAULT_LANGUAGE_MODEL = "anthropic/claude-haiku-5.5"

/**
 * Official AI SDK providers pointed at the Cloudflare AI Gateway REST API.
 *
 * The decision model answers agent.act actions, agent.assert verdicts and the
 * affected-test filter. The language model writes text: field values,
 * agent.waitFor and agent.extract.
 *
 * Gateway response caching stays off. It stores any 200 body, including an
 * answer the runner rejects, and replays it to the retry and to every CI run
 * inside the TTL. Verified e2e action replay is the only cache.
 */
export function e2eModels(options: { accountId: string; gatewayId: string; token: string }) {
  const account = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}`

  const headers = {
    "cf-aig-gateway-id": options.gatewayId,
    "cf-aig-skip-cache": "true",
    "cf-aig-max-attempts": "3",
    "cf-aig-backoff": "exponential",
  }

  const anthropic = createAnthropic({
    baseURL: `${account}/ai/v1`,
    authToken: options.token,
    headers,
  })

  const openai = createOpenAI({ baseURL: `${account}/ai/v1`, apiKey: options.token, headers })

  // Clef speaks the TypeSafe System One protocol. Workers AI serves it at
  // /ai/run/<model> instead of /systemone and wraps the answer in
  // { success, result }.
  const clef = (modelId: string) =>
    createTypeSafeAi({
      baseURL: `${account}/ai/run`,
      apiKey: options.token,
      headers,
      fetch: async (input, init) => {
        const url = String(input).replace(/\/systemone$/, `/${modelId}`)
        const response = await fetch(url, init)

        if (!response.ok) return cloudflareFailure(response)

        // SAFETY: Workers AI wraps every successful /ai/run answer as
        // { success, result }. The TypeSafe provider validates `result`.
        const { result } = (await response.json()) as { result: unknown }

        return Response.json(result, { status: response.status })
      },
    }).decisionModel(modelId.slice(modelId.lastIndexOf("/") + 1))

  const decisionModelId = process.env.E2E_DECISION_MODEL || DEFAULT_DECISION_MODEL
  const languageModelId = process.env.E2E_LANGUAGE_MODEL || DEFAULT_LANGUAGE_MODEL

  if (
    !decisionModelId.startsWith("@cf/cloudflare/clef") &&
    !decisionModelId.startsWith("anthropic/")
  )
    throw new Error(
      `E2E_DECISION_MODEL must name a Cloudflare Clef model or an anthropic/ model, not ${decisionModelId}.`,
    )

  return {
    decisionModel: decisionModelId.startsWith("anthropic/")
      ? anthropic.decisionModel(decisionModelId)
      : clef(decisionModelId),
    languageModel: languageModelId.startsWith("anthropic/")
      ? anthropic(languageModelId)
      : openai.chat(languageModelId),
  }
}

/**
 * Cloudflare names a failure in { errors: [{ code, message }] }. The TypeSafe
 * provider reads only a top-level `message`, so without this every failure
 * reads "TypeSafe request failed" and its reason is lost.
 */
async function cloudflareFailure(response: Response) {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)

  if (P.isObject(body) && P.isString(body.message)) return response

  const errors: ReadonlyArray<unknown> = P.isObject(body)
    ? [body.errors, body.error].flatMap((list) => (Array.isArray(list) ? list : []))
    : []

  const reasons = errors.flatMap((error) =>
    P.isObject(error) && P.isString(error.message)
      ? [P.isNumber(error.code) ? `${error.code}: ${error.message}` : error.message]
      : [],
  )

  const reason = reasons.length === 0 ? response.statusText : reasons.join("; ")

  return Response.json(
    { message: `Cloudflare ${response.status}: ${reason}` },
    { status: response.status, statusText: response.statusText },
  )
}
