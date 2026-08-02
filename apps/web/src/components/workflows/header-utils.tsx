import { WorkflowHeaderDraftRow, WorkflowHeaderDraftRowErrors } from "./types"
import { getErrorMessage } from "./run-utils"

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: unknown }

export type HeaderDraftParseResult =
  | { ok: true; value: Record<string, string>; rowErrors: WorkflowHeaderDraftRowErrors }
  | {
      ok: false
      message: string
      messages: string[]
      rowErrors: WorkflowHeaderDraftRowErrors
    }

export type HeaderDraftRowsValidation = {
  rows: WorkflowHeaderDraftRow[]
  validation: HeaderDraftParseResult
}

export type HeaderDraftRecordParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string; messages: string[] }

export const WORKFLOW_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function tryParseJsonInput(value: string): JsonParseResult {
  try {
    return { ok: true, value: value.trim() ? JSON.parse(value) : {} }
  } catch (errorValue) {
    return { ok: false, error: errorValue }
  }
}

export function parseJsonInput(value: string, label: string): unknown {
  const parsed = tryParseJsonInput(value)
  if (!parsed.ok) {
    throw new Error(`${label} must be valid JSON: ${getErrorMessage(parsed.error)}`, {
      cause: parsed.error,
    })
  }
  return parsed.value
}

export function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  const parsed = parseJsonInput(value, label)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

export function getWorkflowHeaderDraftRowsValidation(
  value: unknown,
  createRow: (key?: string, value?: string) => WorkflowHeaderDraftRow,
): HeaderDraftRowsValidation {
  const parsedRecord = parseWorkflowHeaderDraftRecord(value)
  if (!parsedRecord.ok) {
    return {
      rows: [],
      validation: {
        ok: false,
        message: parsedRecord.message,
        messages: parsedRecord.messages,
        rowErrors: {},
      },
    }
  }

  const rows = Object.entries(parsedRecord.value).map(([key, headerValue]) =>
    createRow(key, formatHeaderDraftValue(headerValue)),
  )

  return {
    rows,
    validation: parseWorkflowHeaderDraftRows(rows),
  }
}

export function parseWorkflowHeaderOption(value: unknown): HeaderDraftParseResult {
  let index = 0
  return getWorkflowHeaderDraftRowsValidation(value, (key = "", rowValue = "") => {
    const row = { id: `header-${index.toString(36)}`, key, value: rowValue }
    index += 1
    return row
  }).validation
}

export function parseWorkflowHeaderDraftRecord(value: unknown): HeaderDraftRecordParseResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: {} }
  }
  if (typeof value === "string") {
    const parsed = tryParseJsonInput(value)
    if (!parsed.ok) {
      const message = `Headers must be valid JSON: ${getErrorMessage(parsed.error)}`
      return { ok: false, message, messages: [message] }
    }

    const record = asJsonRecord(parsed.value)
    if (!record) {
      const message = "Headers must be a JSON object."
      return { ok: false, message, messages: [message] }
    }
    return { ok: true, value: record }
  }

  const record = asJsonRecord(value)
  if (!record) {
    const message = "Headers must be a JSON object."
    return { ok: false, message, messages: [message] }
  }
  return { ok: true, value: record }
}

export function formatHeaderDraftValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "string") {
    return value
  }
  return JSON.stringify(value) ?? String(value)
}

export function parseWorkflowHeaderDraftRows(
  rows: WorkflowHeaderDraftRow[],
): HeaderDraftParseResult {
  const headers: Record<string, string> = {}
  const rowErrors: WorkflowHeaderDraftRowErrors = {}
  const rowsByNormalizedKey = new Map<string, WorkflowHeaderDraftRow[]>()
  const messages: string[] = []
  let firstMessage: string | null = null

  const addMessage = (message: string) => {
    if (!messages.includes(message)) {
      messages.push(message)
    }
    firstMessage ??= message
  }

  const setKeyError = (rowId: string, message: string) => {
    rowErrors[rowId] = { ...rowErrors[rowId], key: message }
    addMessage(message)
  }

  for (const row of rows) {
    const key = row.key.trim()
    const value = row.value
    if (!key && !value) {
      continue
    }
    if (!key) {
      setKeyError(row.id, "Header name is required.")
      continue
    }
    if (!WORKFLOW_HEADER_NAME_PATTERN.test(key)) {
      setKeyError(row.id, `Header "${key}" must use a valid HTTP header name.`)
      continue
    }

    const normalizedKey = key.toLowerCase()
    rowsByNormalizedKey.set(normalizedKey, [...(rowsByNormalizedKey.get(normalizedKey) ?? []), row])
  }

  for (const duplicateRows of rowsByNormalizedKey.values()) {
    if (duplicateRows.length < 2) {
      continue
    }

    addMessage("Header names must be unique. HTTP header names are case-insensitive.")
    for (const row of duplicateRows) {
      rowErrors[row.id] = {
        ...rowErrors[row.id],
        key: "Header name duplicates another row.",
      }
    }
  }

  if (firstMessage) {
    return { ok: false, message: firstMessage, messages, rowErrors }
  }

  for (const row of rows) {
    const key = row.key.trim()
    if (!key && !row.value) {
      continue
    }
    headers[key] = row.value
  }

  return { ok: true, value: headers, rowErrors }
}

export function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

export function toDateTimeLocal(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return ""
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ""
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
