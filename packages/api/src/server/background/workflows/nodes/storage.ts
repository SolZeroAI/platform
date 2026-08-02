import {
  WORKFLOW_KV_NAMESPACE_OPTIONS,
  WORKFLOW_R2_BUCKET_OPTIONS,
  WORKFLOW_STORAGE_ENCODING_OPTIONS,
  type WorkflowStorageEncoding,
} from "@c0-agent/shared"
import { parseJson } from "../../../lib/json"
import { toError } from "../../../lib/effect-errors"
import { createGlobalSecretsStoreFromD1 } from "../../db/repo-secrets"
import type { Env } from "../../types"
import { prefixStorageKeyWithUserId } from "../../../lib/better-auth"
import {
  createNodeContext,
  getActionUserId,
  getPositiveInteger,
  getString,
  renderTemplate,
  type WorkflowNodeExecutionInput,
} from "./common"
import { workflowNodeFail, workflowNodeFailWhen } from "./errors"
import { recordWorkflowNodeRunEvent } from "./events"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"

export type WorkflowStorageNodeExecutionInput = WorkflowNodeExecutionInput

const workflowStorageNodeTypes = new Set([
  "r2-put-object",
  "r2-get-object",
  "kv-put",
  "kv-get",
  "get-secret",
])

const workflowR2BucketIds = new Set<string>(
  WORKFLOW_R2_BUCKET_OPTIONS.map((bucket) => bucket.binding),
)
const workflowKvNamespaceIds = new Set<string>(
  WORKFLOW_KV_NAMESPACE_OPTIONS.map((namespace) => namespace.binding),
)
const workflowResponseTypes = new Set(["auto", "json", "text"])
const workflowStorageEncodings = new Set<string>(
  WORKFLOW_STORAGE_ENCODING_OPTIONS.map((encoding) => encoding.value),
)
const R2_CONTENT_ENCODING_MANIFEST_VERSION = 2

export function isWorkflowStorageNodeType(nodeType: string): boolean {
  return workflowStorageNodeTypes.has(nodeType)
}

const requireString = (value: Option.Option<string>, message: string) =>
  Option.match(value, {
    onNone: () => workflowNodeFail(message),
    onSome: (resolved) => Effect.succeed(resolved),
  })

export const executeWorkflowStorageNode = Effect.fn("workflows.executeStorageNode")(function* (
  input: WorkflowStorageNodeExecutionInput,
) {
  return yield* Match.value(input.node.type).pipe(
    Match.when("r2-put-object", () => runR2PutObjectNode(input)),
    Match.when("r2-get-object", () => runR2GetObjectNode(input)),
    Match.when("kv-put", () => runKvPutNode(input)),
    Match.when("kv-get", () => runKvGetNode(input)),
    Match.when("get-secret", () => runGetSecretNode(input)),
    Match.orElse((nodeType) => workflowNodeFail(`Unsupported workflow storage node '${nodeType}'`)),
  )
})

function getR2BucketBinding(env: Env, binding: string): R2Bucket {
  return Match.value(workflowR2BucketIds.has(binding)).pipe(
    Match.when(false, () => {
      throw new Error(`Unsupported workflow R2 bucket '${binding}'`)
    }),
    Match.orElse(() =>
      Match.value(binding).pipe(
        Match.when("WORKFLOW_BUCKET", () => env.WORKFLOW_BUCKET),
        Match.when("AI_SEARCH_CONTENT_BUCKET", () => env.AI_SEARCH_CONTENT_BUCKET),
        Match.orElse(() => {
          throw new Error(`Unsupported workflow R2 bucket '${binding}'`)
        }),
      ),
    ),
  )
}

function getKvNamespaceBinding(env: Env, binding: string): KVNamespace {
  return Match.value(workflowKvNamespaceIds.has(binding)).pipe(
    Match.when(false, () => {
      throw new Error(`Unsupported workflow KV namespace '${binding}'`)
    }),
    Match.orElse(() =>
      Match.value(binding).pipe(
        Match.when("REPOS_CACHE", () => env.REPOS_CACHE),
        Match.when("USER_WORKFLOW_KV", () => env.USER_WORKFLOW_KV),
        Match.orElse(() => {
          throw new Error(`Unsupported workflow KV namespace '${binding}'`)
        }),
      ),
    ),
  )
}

type SerializedStorageContent = {
  body: string | Uint8Array
  contentType: string
}

function serializeStorageContent(content: unknown): { body: string; contentType: string } {
  return Match.value(typeof content === "string").pipe(
    Match.when(true, () => ({
      body: content as string,
      contentType: "text/plain; charset=utf-8",
    })),
    Match.orElse(() => ({
      // oxlint-disable-next-line effect/avoid-direct-json -- Serializes non-string content as 2-space pretty-printed JSON that is persisted as the stored object body; the sanctioned `stringifyJson` helper is compact and would change persisted storage bytes.
      body: JSON.stringify(content ?? null, null, 2),
      contentType: "application/json",
    })),
  )
}

function resolveR2Encoding(options: Record<string, unknown>): WorkflowStorageEncoding {
  const encoding = Option.getOrElse(getString(options.encoding), () => "text")
  return Match.value(workflowStorageEncodings.has(encoding)).pipe(
    Match.when(false, () => {
      throw new Error(`Unsupported R2 content encoding '${encoding}'`)
    }),
    Match.orElse(() => encoding as WorkflowStorageEncoding),
  )
}

function getR2ContentEncoding(
  options: Record<string, unknown>,
  manifestVersion: number | undefined,
): WorkflowStorageEncoding {
  return Match.value(
    !manifestVersion || manifestVersion < R2_CONTENT_ENCODING_MANIFEST_VERSION,
  ).pipe(
    Match.when(true, () => "text" as WorkflowStorageEncoding),
    Match.orElse(() => resolveR2Encoding(options)),
  )
}

function readBase64Payload(value: string): string {
  const trimmed = value.trim()
  const dataUrlMatch = /^data:[^,]*;base64,(.*)$/is.exec(trimmed)
  return (dataUrlMatch?.[1] ?? trimmed).replaceAll(/\s/g, "")
}

function decodeBase64Content(value: string): Uint8Array {
  const encoded = readBase64Payload(value)
  return Result.match(
    Result.try(() => atob(encoded)),
    {
      onFailure: () => {
        throw new Error("R2 base64 content was not valid base64")
      },
      onSuccess: (binary) =>
        Uint8Array.from({ length: binary.length }, (_, index) => binary.charCodeAt(index)),
    },
  )
}

function serializeBase64Content(content: unknown): SerializedStorageContent {
  return Match.value(typeof content === "string").pipe(
    Match.when(true, () => ({
      body: decodeBase64Content(content as string),
      contentType: "application/octet-stream",
    })),
    Match.orElse(() => {
      throw new Error("R2 base64 content must be a string")
    }),
  )
}

function serializeR2StorageContent(
  content: unknown,
  encoding: WorkflowStorageEncoding,
): SerializedStorageContent {
  return Match.value(encoding === "base64").pipe(
    Match.when(true, () => serializeBase64Content(content)),
    Match.orElse(() => serializeStorageContent(content)),
  )
}

function looksLikeJsonDocument(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

type ParsedStoredText = { body: unknown; json: unknown; text: string }

function parseStoredJson(text: string): unknown {
  return Match.value(text.length > 0).pipe(
    Match.when(true, () => parseJson(text)),
    Match.orElse(() => null),
  )
}

function parseStoredJsonOrText(text: string, responseType: string): ParsedStoredText {
  return Result.match(
    Result.try(() => parseStoredJson(text)),
    {
      onSuccess: (json) => ({ body: json, json, text }),
      onFailure: () =>
        Match.value(responseType === "json").pipe(
          Match.when(true, (): ParsedStoredText => {
            throw new Error("Stored value was not valid JSON")
          }),
          Match.orElse(() => ({ body: text, json: null, text })),
        ),
    },
  )
}

function parseStoredTextBody(
  text: string,
  responseType: string,
  contentType: string | null,
): ParsedStoredText {
  const shouldParseJson =
    responseType === "json" ||
    (responseType === "auto" && (contentType ?? "").toLowerCase().includes("json")) ||
    (responseType === "auto" && looksLikeJsonDocument(text))
  return Match.value(shouldParseJson).pipe(
    Match.when(false, () => ({ body: text, json: null, text })),
    Match.orElse(() => parseStoredJsonOrText(text, responseType)),
  )
}

function parseStoredText(
  text: string,
  responseType: string,
  contentType: string | null = null,
): ParsedStoredText {
  return Match.value(workflowResponseTypes.has(responseType)).pipe(
    Match.when(false, (): ParsedStoredText => {
      throw new Error(`Unsupported response type '${responseType}'`)
    }),
    Match.orElse(() => parseStoredTextBody(text, responseType, contentType)),
  )
}

const runR2PutObjectNode = Effect.fn("workflows.runR2PutObjectNode")(function* (
  input: WorkflowStorageNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const bucketBinding = Option.getOrElse(getString(options.bucket), () => "WORKFLOW_BUCKET")
  const bucket = getR2BucketBinding(input.env, bucketBinding)
  const defaultKey = `workflow-outputs/${input.workflowId}/${input.runId}/${input.node.id}.json`
  const keyTemplate = Option.getOrElse(
    Option.orElse(getString(input.inputs.key), () => getString(options.key)),
    () => defaultKey,
  )
  const renderedKey = renderTemplate(keyTemplate, createNodeContext(input)).trim()
  yield* workflowNodeFailWhen(renderedKey.length === 0, "R2 object key is required")
  const userId = getActionUserId(input)
  const storageKey = prefixStorageKeyWithUserId(userId, renderedKey)
  const content = Match.value("content" in input.inputs).pipe(
    Match.when(true, () => input.inputs.content),
    Match.orElse(() => input.inputs),
  )
  const encoding = getR2ContentEncoding(options, input.manifestVersion)
  const serialized = serializeR2StorageContent(content, encoding)
  const contentType = Option.getOrElse(getString(options.contentType), () => serialized.contentType)
  const result = yield* Effect.tryPromise({
    try: () => bucket.put(storageKey, serialized.body, { httpMetadata: { contentType } }),
    catch: toError,
  })
  return {
    outputs: {
      bucket: bucketBinding,
      key: renderedKey,
      etag: result?.etag ?? null,
      contentType,
    },
  }
})

const readR2Object = Effect.fn("workflows.readR2Object")(function* (params: {
  options: Record<string, unknown>
  object: R2ObjectBody
  bucketBinding: string
  renderedKey: string
}) {
  const text = yield* Effect.tryPromise({
    try: () => params.object.text(),
    catch: toError,
  })
  const contentType = params.object.httpMetadata?.contentType ?? null
  const responseType = Option.getOrElse(getString(params.options.responseType), () => "auto")
  const parsed = parseStoredText(text, responseType, contentType)
  return {
    outputs: {
      found: true,
      bucket: params.bucketBinding,
      key: params.renderedKey,
      body: parsed.body,
      json: parsed.json,
      text: parsed.text,
      etag: params.object.etag ?? null,
      contentType,
    },
  }
})

const runR2GetObjectNode = Effect.fn("workflows.runR2GetObjectNode")(function* (
  input: WorkflowStorageNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const bucketBinding = Option.getOrElse(getString(options.bucket), () => "WORKFLOW_BUCKET")
  const bucket = getR2BucketBinding(input.env, bucketBinding)
  const keyTemplate = yield* requireString(
    Option.orElse(getString(input.inputs.key), () => getString(options.key)),
    "R2 object key is required",
  )
  const renderedKey = renderTemplate(keyTemplate, createNodeContext(input)).trim()
  yield* workflowNodeFailWhen(renderedKey.length === 0, "R2 object key is required")
  const userId = getActionUserId(input)
  const storageKey = prefixStorageKeyWithUserId(userId, renderedKey)
  const object = yield* Effect.tryPromise({
    try: () => bucket.get(storageKey),
    catch: toError,
  })
  return yield* Match.value(object).pipe(
    Match.when(Match.null, () =>
      Effect.succeed({
        outputs: {
          found: false,
          bucket: bucketBinding,
          key: renderedKey,
          body: null,
          json: null,
          text: null,
          etag: null,
          contentType: null,
        },
      }),
    ),
    Match.orElse((resolvedObject) =>
      readR2Object({ options, object: resolvedObject, bucketBinding, renderedKey }),
    ),
  )
})

const runKvPutNode = Effect.fn("workflows.runKvPutNode")(function* (
  input: WorkflowStorageNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const namespaceBinding = Option.getOrElse(getString(options.namespace), () => "USER_WORKFLOW_KV")
  const namespace = getKvNamespaceBinding(input.env, namespaceBinding)
  const defaultKey = `workflow-outputs/${input.workflowId}/${input.runId}/${input.node.id}.json`
  const keyTemplate = Option.getOrElse(
    Option.orElse(getString(input.inputs.key), () => getString(options.key)),
    () => defaultKey,
  )
  const renderedKey = renderTemplate(keyTemplate, createNodeContext(input)).trim()
  yield* workflowNodeFailWhen(renderedKey.length === 0, "KV key is required")
  const userId = getActionUserId(input)
  const storageKey = prefixStorageKeyWithUserId(userId, renderedKey)
  const value = Match.value("value" in input.inputs).pipe(
    Match.when(true, () => input.inputs.value),
    Match.orElse(() => input.inputs),
  )
  const serialized = serializeStorageContent(value)
  const expirationTtl = Option.getOrUndefined(
    Option.orElse(getPositiveInteger(input.inputs.expirationTtl), () =>
      getPositiveInteger(options.expirationTtl),
    ),
  )
  const putOptions = Option.match(Option.fromNullishOr(expirationTtl), {
    onNone: () => undefined,
    onSome: (ttl) => ({ expirationTtl: ttl }),
  })
  yield* Effect.tryPromise({
    try: () => namespace.put(storageKey, serialized.body, putOptions),
    catch: toError,
  })
  return {
    outputs: {
      namespace: namespaceBinding,
      key: renderedKey,
      expirationTtl: expirationTtl ?? null,
    },
  }
})

function buildKvGetResult(
  text: string,
  options: Record<string, unknown>,
  namespaceBinding: string,
  renderedKey: string,
) {
  const responseType = Option.getOrElse(getString(options.responseType), () => "auto")
  const parsed = parseStoredText(text, responseType)
  return {
    outputs: {
      found: true,
      namespace: namespaceBinding,
      key: renderedKey,
      value: parsed.body,
      json: parsed.json,
      text: parsed.text,
    },
  }
}

const runKvGetNode = Effect.fn("workflows.runKvGetNode")(function* (
  input: WorkflowStorageNodeExecutionInput,
) {
  const options = input.node.options ?? {}
  const namespaceBinding = Option.getOrElse(getString(options.namespace), () => "USER_WORKFLOW_KV")
  const namespace = getKvNamespaceBinding(input.env, namespaceBinding)
  const keyTemplate = yield* requireString(
    Option.orElse(getString(input.inputs.key), () => getString(options.key)),
    "KV key is required",
  )
  const renderedKey = renderTemplate(keyTemplate, createNodeContext(input)).trim()
  yield* workflowNodeFailWhen(renderedKey.length === 0, "KV key is required")
  const userId = getActionUserId(input)
  const storageKey = prefixStorageKeyWithUserId(userId, renderedKey)
  const text = yield* Effect.tryPromise({
    try: () => namespace.get(storageKey),
    catch: toError,
  })
  return Match.value(text).pipe(
    Match.when(Match.null, () => ({
      outputs: {
        found: false,
        namespace: namespaceBinding,
        key: renderedKey,
        value: null,
        json: null,
        text: null,
      },
    })),
    Match.orElse((resolvedText) =>
      buildKvGetResult(resolvedText, options, namespaceBinding, renderedKey),
    ),
  )
})

const runGetSecretNode = Effect.fn("workflows.runGetSecretNode")(function* (
  input: WorkflowStorageNodeExecutionInput,
) {
  const encryptionKey = yield* Option.match(
    Option.fromNullishOr(input.env.REPO_SECRETS_ENCRYPTION_KEY),
    {
      onNone: () => workflowNodeFail("REPO_SECRETS_ENCRYPTION_KEY not configured"),
      onSome: (resolved) => Effect.succeed(resolved),
    },
  )
  const options = input.node.options ?? {}
  const keyTemplate = yield* requireString(
    Option.orElse(getString(input.inputs.key), () => getString(options.key)),
    "Secret key is required",
  )
  const key = renderTemplate(keyTemplate, createNodeContext(input)).trim()
  yield* workflowNodeFailWhen(key.length === 0, "Secret key is required")
  const userId = getActionUserId(input)
  const secrets = yield* Effect.tryPromise({
    try: () =>
      createGlobalSecretsStoreFromD1(input.env.DB, encryptionKey).getDecryptedSecrets({ userId }),
    catch: toError,
  })
  const value = secrets[key]
  const found = typeof value === "string"
  const secretMessage = Match.value(found).pipe(
    Match.when(true, () => "read a secret"),
    Match.orElse(() => "could not find a secret"),
  )
  yield* recordWorkflowNodeRunEvent(input, {
    eventType: "secret_accessed",
    message: `${input.node.label} ${secretMessage}`,
    data: { key, found },
  })
  return {
    outputs: {
      found,
      key,
      value: value ?? null,
    },
  }
})
