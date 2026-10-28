import {
  convertUint8ArrayToBase64,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  postJsonToApi,
} from "@ai-sdk/provider-utils"
import type { Experimental_DecisionModel } from "ai"
import * as Schema from "effect/Schema"

type DecisionModel = Extract<Exclude<Experimental_DecisionModel, string>, { doDecide: unknown }>

type DecideOptions = Parameters<DecisionModel["doDecide"]>[0]

type DecideResult = Awaited<ReturnType<DecisionModel["doDecide"]>>

type Question = DecideOptions["questions"][string]

type Answer = DecideResult["answers"][string]

type FilePart = Extract<DecideOptions["state"][number], { type: "file" }>

/** Workers AI accepts 1 to 64 questions on one Clef request. */
const QUESTION_LIMIT = 64

const Probabilities = Schema.Record(Schema.String, Schema.Number)

const ClefAnswer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Probabilities,
    confidence: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Number,
    probabilities: Probabilities,
    confidence: Schema.Number,
  }),
])

type ClefAnswer = typeof ClefAnswer.Type

const ClefResponse = Schema.Struct({
  result: Schema.Struct({
    answers: Schema.Record(Schema.String, ClefAnswer),
    usage: Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number }),
  }),
})

const ClefError = Schema.Struct({
  errors: Schema.Array(Schema.Struct({ message: Schema.String })),
})

/** State with text parts, JSON parts, or both. */
type ClefState = { text?: string; json?: unknown }

/** The Clef request body. `state` and `images` follow the Workers AI input schema. */
type ClefRequest = {
  model: string
  state: unknown
  questions: Record<string, ClefQuestion>
  images?: string[]
}

type ClefQuestion =
  | { type: "noul"; instructions: Question["instructions"]; criteria?: unknown }
  | Extract<Question, { type: "choice" | "score" }>

/**
 * AI SDK decision model for Cloudflare Clef on the Workers AI REST route,
 * through the account's existing AI Gateway. Clef answers choice, score and
 * yes/no (`noul`) questions with probabilities, so the e2e decision executor
 * needs no language-model adapter. `modelId` is `@cf/cloudflare/clef` or
 * `@cf/cloudflare/clef-flash`.
 */
export function clefDecisionModel(options: {
  modelId: string
  accountId: string
  gatewayId: string
  token: string
}): DecisionModel {
  const { modelId } = options
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/ai/run/${modelId}`
  // The body names the variant: "clef" or "clef-flash".
  const variant = modelId.slice(modelId.lastIndexOf("/") + 1)

  return {
    specificationVersion: "v4",
    provider: "cloudflare-workers-ai",
    modelId,
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doDecide({ state, questions, abortSignal }) {
      const clefState = toClefState(state)
      const ids = Object.keys(questions)
      const answers: Record<string, Answer> = {}
      const confidence: Record<string, number> = {}
      const usage = { inputTokens: 0, outputTokens: 0 }

      for (let start = 0; start < ids.length; start += QUESTION_LIMIT) {
        const slice = ids.slice(start, start + QUESTION_LIMIT)

        const body: ClefRequest = {
          model: variant,
          state: clefState.body,
          questions: Object.fromEntries(slice.map((id) => [id, toClefQuestion(questions[id]!)])),
        }

        if (clefState.images.length > 0) body.images = clefState.images

        const { value } = await postJsonToApi({
          url,
          headers: {
            authorization: `Bearer ${options.token}`,
            "cf-aig-gateway-id": options.gatewayId,
            // A cached body would replay one answer to every retry. Verified
            // e2e action replay is the only cache.
            "cf-aig-skip-cache": "true",
          },
          body,
          failedResponseHandler: createJsonErrorResponseHandler({
            errorSchema: Schema.toStandardSchemaV1(ClefError),
            errorToMessage: (error) =>
              error.errors.map((item) => item.message).join("; ") || "Clef request failed",
          }),
          successfulResponseHandler: createJsonResponseHandler(
            Schema.toStandardSchemaV1(ClefResponse),
          ),
          abortSignal,
        })

        for (const id of slice) {
          const answer = value.result.answers[id]

          if (answer === undefined) continue

          answers[id] = toAnswer(answer, questions[id]!)

          if (answer.type !== "noul") confidence[id] = answer.confidence
        }

        usage.inputTokens += value.result.usage.input_tokens
        usage.outputTokens += value.result.usage.output_tokens
      }

      return {
        answers,
        usage,
        warnings: [],
        providerMetadata: { clef: { confidence } },
        response: { modelId, timestamp: new Date() },
      }
    },
  }
}

function toClefQuestion(question: Question): ClefQuestion {
  switch (question.type) {
    case "boolean": {
      const noul: ClefQuestion = { type: "noul", instructions: question.instructions }

      if (question.criteria !== undefined) noul.criteria = question.criteria

      return noul
    }

    case "choice":
    case "score":
      return question
    case "box":
      throw new Error("Clef does not answer box questions.")
  }
}

/**
 * Clef rounds its probabilities, and the AI SDK checks that a distribution
 * sums to 1 and that a score is its weighted mean. Normalize the
 * distribution and derive the choice and the score from it.
 */
function toAnswer(answer: ClefAnswer, question: Question): Answer {
  if (answer.type === "noul") return { type: "boolean", probability: answer.noul }

  const keys =
    question.type === "score"
      ? question.criteria.map((_, index) => String(index))
      : Object.keys(question.type === "choice" ? question.criteria : {})

  const total = keys.reduce((sum, key) => sum + (answer.probabilities[key] ?? 0), 0)

  const probabilities = Object.fromEntries(
    keys.map((key) => [key, total > 0 ? (answer.probabilities[key] ?? 0) / total : 0]),
  )

  if (answer.type === "score") {
    const score = keys.reduce((sum, key) => sum + Number(key) * probabilities[key]!, 0)

    return { type: "score", score, probabilities }
  }

  const choice = keys.reduce((best, key) =>
    probabilities[key]! > probabilities[best]! ? key : best,
  )

  return { type: "choice", choice, probabilities }
}

/** Splits AI SDK state parts into Clef `state` and its `images` extension. */
function toClefState(parts: DecideOptions["state"]) {
  const images: string[] = []
  const text: string[] = []
  const json: unknown[] = []

  for (const part of parts) {
    if (part.type === "text") text.push(part.text)
    else if (part.type === "json") json.push(part.value)
    else if (part.mediaType.startsWith("image")) images.push(imageDataUrl(part))
  }

  if (json.length === 1 && text.length === 0) return { body: json[0], images }

  const body: ClefState = {}

  if (text.length > 0) body.text = text.join("\n")

  if (json.length > 0) body.json = json.length === 1 ? json[0] : json

  return { body, images }
}

function imageDataUrl({ data, mediaType }: FilePart): string {
  if (data.type === "data") {
    const base64 = typeof data.data === "string" ? data.data : convertUint8ArrayToBase64(data.data)

    return `data:${mediaType};base64,${base64}`
  }

  if (data.type === "url" && data.url.protocol === "data:") return data.url.toString()

  throw new Error("Clef accepts only embedded images.")
}
