import type { WorkflowNodeOptions } from "@solzero/shared"
import { stringifyJson } from "../../../lib/json"
import { raise } from "../../../lib/effect-errors"
import type { RequestLogger } from "../../../effect/services/observability"
import type { Env } from "../../types"
import type { WorkflowTriggerPayload } from "../runner"
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

export interface WorkflowNodeExecutionInput {
  env: Env
  log?: RequestLogger
  workflowId: string
  runId: string
  manifestVersion?: number
  node: {
    id: string
    type: string
    label: string
    options?: WorkflowNodeOptions
  }
  inputs: Record<string, unknown>
  trigger: WorkflowTriggerPayload
  userId: string
  oktaUserId?: string | null
}

export function getString(value: unknown): Option.Option<string> {
  return Match.value(value).pipe(
    Match.when(Match.string, (stringValue) =>
      Match.value(stringValue.trim().length > 0).pipe(
        Match.when(true, () => Option.some(stringValue.trim())),
        Match.orElse(() => Option.none<string>()),
      ),
    ),
    Match.orElse(() => Option.none<string>()),
  )
}

export function getPositiveInteger(value: unknown): Option.Option<number> {
  const numberValue = Match.value(value).pipe(
    Match.when(Match.number, (resolved) => resolved),
    Match.orElse(() =>
      Option.match(getString(value), {
        onNone: () => Number.NaN,
        onSome: (stringValue) => Number(stringValue),
      }),
    ),
  )
  return Match.value(Number.isInteger(numberValue) && numberValue > 0).pipe(
    Match.when(true, () => Option.some(numberValue)),
    Match.orElse(() => Option.none<number>()),
  )
}

function prettyPrintTemplateJson(value: unknown): string {
  // oxlint-disable-next-line effect/avoid-direct-json -- Renders non-string template values as 2-space pretty-printed JSON into user-visible workflow output; the sanctioned `stringifyJson` helper is compact and would change rendered template text.
  return JSON.stringify(value, null, 2)
}

export function stringifyTemplateValue(value: unknown): string {
  return Match.value(value).pipe(
    Match.when(Match.null, () => ""),
    Match.when(Match.undefined, () => ""),
    Match.when(Match.string, (stringValue) => stringValue),
    Match.orElse((other) => prettyPrintTemplateJson(other)),
  )
}

function getPathValue(value: unknown, path: string): unknown {
  return Match.value(path.length > 0).pipe(
    Match.when(false, () => value),
    Match.orElse(() =>
      Arr.reduce(path.split("."), value, (current, part) =>
        Match.value(current).pipe(
          Match.when(Match.record, (record) => record[part]),
          Match.orElse(() => undefined),
        ),
      ),
    ),
  )
}

function getTemplatePathValue(context: Record<string, unknown>, path: string): unknown {
  const value = getPathValue(context, path)
  return Match.value(value === undefined).pipe(
    Match.when(true, () =>
      raise(
        `Template path '${path}' is not available. Connect the upstream output to this node and use the connected input handle.`,
      ),
    ),
    Match.orElse(() => value),
  )
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) =>
    stringifyTemplateValue(getTemplatePathValue(context, path)),
  )
}

function stringifyJsonTemplateValue(value: unknown): string {
  // oxlint-disable-next-line effect/avoid-direct-json -- Intentionally relies on `JSON.stringify` returning `undefined` for non-serializable values so the explicit `"null"` fallback applies; the sanctioned `stringifyJson` helper throws instead, changing behavior.
  const json = JSON.stringify(value ?? null) as string | undefined
  return Match.value(json).pipe(
    Match.when(Match.undefined, () => "null"),
    Match.orElse((resolved) => resolved),
  )
}

function escapeJsonStringTemplateValue(value: unknown): string {
  const json = stringifyJson(stringifyTemplateValue(value))
  return json.slice(1, -1)
}

function isInsideJsonString(template: string, index: number): boolean {
  const state = Arr.reduce(
    template.slice(0, index).split(""),
    { inString: false, escaped: false },
    (acc, char) =>
      Match.value(acc.escaped).pipe(
        Match.when(true, () => ({ inString: acc.inString, escaped: false })),
        Match.orElse(() =>
          Match.value(char).pipe(
            Match.when("\\", () => ({ inString: acc.inString, escaped: true })),
            Match.when('"', () => ({ inString: !acc.inString, escaped: false })),
            Match.orElse(() => ({ inString: acc.inString, escaped: false })),
          ),
        ),
      ),
  )
  return state.inString
}

export function renderJsonTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_match, path: string, offset: number) =>
      Match.value(isInsideJsonString(template, offset)).pipe(
        Match.when(true, () => escapeJsonStringTemplateValue(getTemplatePathValue(context, path))),
        Match.orElse(() => stringifyJsonTemplateValue(getTemplatePathValue(context, path))),
      ),
  )
}

export function createNodeContext(input: WorkflowNodeExecutionInput): Record<string, unknown> {
  return {
    workflowId: input.workflowId,
    runId: input.runId,
    nodeId: input.node.id,
    userId: input.userId,
    oktaUserId: input.oktaUserId,
    inputs: input.inputs,
  }
}

export function getActionUserId(input: { userId: string }): string {
  return Option.match(getString(input.userId), {
    onNone: () => raise("Workflow action userId is required"),
    onSome: (userId) => userId,
  })
}
