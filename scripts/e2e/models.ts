import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai"

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

        if (!response.ok) return response

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
