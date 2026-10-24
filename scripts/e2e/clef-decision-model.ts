import { Buffer } from "node:buffer"
import { AgentError } from "e2e"
import type { Experimental_DecisionModel } from "ai"

import { measuredTokens } from "./ai-usage"
import { CLEF_MODEL_ID, postClef } from "./clef-client"

type ClefDecisionModel = Extract<
  Exclude<Experimental_DecisionModel, string>,
  { readonly doDecide: unknown }
>
type DecideOptions = Parameters<ClefDecisionModel["doDecide"]>[0]
type DecisionQuestion = DecideOptions["questions"][string]

/** Workers AI accepts at most 64 questions on one Clef request. */
const CLEF_QUESTION_LIMIT = 64

type BooleanAnswer = { type: "boolean"; probability: number }
type TokenTotal = { input: number | undefined; output: number | undefined }

/**
 * AI SDK decision model that asks Cloudflare Clef `noul` questions.
 * `noul` is P(true). The SDK boolean answer uses that same probability.
 */
export function clefDecisionModel(): ClefDecisionModel {
  return {
    specificationVersion: "v4",
    provider: "cloudflare-ai-gateway",
    modelId: CLEF_MODEL_ID,
    supportedQuestionTypes: ["boolean"],
    async doDecide(options) {
      const { state, images } = clefState(options.state)
      const ids = Object.keys(options.questions)
      const answers: Record<string, BooleanAnswer> = {}
      const tokens: TokenTotal = { input: 0, output: 0 }
      for (let start = 0; start < ids.length; start += CLEF_QUESTION_LIMIT) {
        const slice = ids.slice(start, start + CLEF_QUESTION_LIMIT)
        const part = await postClef({
          signal: options.abortSignal ?? new AbortController().signal,
          timeoutMs: () => 120_000,
          state,
          questions: Object.fromEntries(
            slice.map((id) => [id, noulQuestion(options.questions[id]!)]),
          ),
          ...(images.length > 0 ? { images } : {}),
          source: "filter",
          accept: (raw, usage) => ({
            answers: Object.fromEntries(slice.map((id) => [id, booleanAnswer(raw[id])])),
            usage,
          }),
        })
        Object.assign(answers, part.answers)
        addTokens(tokens, part.usage)
      }
      return {
        answers,
        warnings: [],
        usage: {
          ...(tokens.input === undefined ? {} : { inputTokens: tokens.input }),
          ...(tokens.output === undefined ? {} : { outputTokens: tokens.output }),
        },
        response: { modelId: CLEF_MODEL_ID, timestamp: new Date() },
      }
    },
  }
}

function noulQuestion(question: DecisionQuestion | undefined): {
  type: "noul"
  instructions?: string
  criteria?: { true?: string; false?: string }
} {
  if (question?.type !== "boolean")
    throw new AgentError("MODEL_OUTPUT_INVALID", "Clef test filters answer boolean questions only.")
  const instructions = clefText(question.instructions)
  const yes = clefText(question.criteria?.true)
  const no = clefText(question.criteria?.false)
  const criteria = {
    ...(yes === undefined ? {} : { true: yes }),
    ...(no === undefined ? {} : { false: no }),
  }
  return {
    type: "noul",
    ...(instructions === undefined ? {} : { instructions }),
    ...(Object.keys(criteria).length > 0 ? { criteria } : {}),
  }
}

function booleanAnswer(value: unknown): BooleanAnswer {
  if (typeof value !== "object" || value === null)
    throw new AgentError("MODEL_OUTPUT_INVALID", "Clef returned an invalid yes/no probability.")
  const noul = "noul" in value ? value.noul : undefined
  if (typeof noul !== "number" || !Number.isFinite(noul) || noul < 0 || noul > 1)
    throw new AgentError("MODEL_OUTPUT_INVALID", "Clef returned an invalid yes/no probability.")
  return { type: "boolean", probability: noul }
}

function clefState(parts: DecideOptions["state"]): {
  state: unknown
  images: string[]
} {
  const images: string[] = []
  const text: string[] = []
  const json: unknown[] = []
  for (const part of parts) {
    if (part.type === "text") text.push(part.text)
    else if (part.type === "json") json.push(part.value)
    else {
      const image = imageDataUrl(part.mediaType, part.data)
      if (image !== undefined) images.push(image)
    }
  }
  if (json.length === 1 && text.length === 0) return { state: json[0], images }
  return {
    state: {
      ...(text.length > 0 ? { text: text.join("\n") } : {}),
      ...(json.length === 1 ? { json: json[0] } : json.length > 1 ? { json } : {}),
    },
    images,
  }
}

function imageDataUrl(mediaType: string, data: unknown): string | undefined {
  if (!mediaType.startsWith("image/")) return undefined
  if (typeof data === "string")
    return data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`
  if (data instanceof Uint8Array)
    return `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`
  return undefined
}

function clefText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return undefined
  return JSON.stringify(value)
}

function addTokens(
  total: TokenTotal,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
): void {
  const input = measuredTokens(usage?.input_tokens)
  const output = measuredTokens(usage?.output_tokens)
  if (total.input !== undefined) total.input = input === null ? undefined : total.input + input
  if (total.output !== undefined) total.output = output === null ? undefined : total.output + output
}
