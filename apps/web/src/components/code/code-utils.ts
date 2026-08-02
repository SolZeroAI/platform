export type CodeLanguage = "json" | "javascript" | "text"
export type CodeSurfaceMode = "readonly" | "editable"

export interface JsonFormatResult {
  ok: boolean
  value: string
  error: string | null
}

type JsonParseResult =
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
      error: string
    }

export function getCodeSurfaceActionLabel(mode: CodeSurfaceMode): "Full View" | "Editor" {
  return mode === "editable" ? "Editor" : "Full View"
}

export function formatJsonValue(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2)
}

function parseJsonText(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch (errorValue) {
    return {
      ok: false,
      error: errorValue instanceof Error ? errorValue.message : "Invalid JSON",
    }
  }
}

export function formatJsonText(value: string): JsonFormatResult {
  const result = parseJsonText(value)
  if (!result.ok) {
    return {
      ok: false,
      value,
      error: result.error,
    }
  }

  return { ok: true, value: formatJsonValue(result.value), error: null }
}

export function getCodeLanguageForValue(
  value: unknown,
  preferredLanguage?: CodeLanguage,
): CodeLanguage {
  if (preferredLanguage) {
    return preferredLanguage
  }
  if (typeof value === "string") {
    return parseJsonText(value).ok ? "json" : "text"
  }
  return "json"
}

export function getCodeTextForValue(value: unknown, preferredLanguage?: CodeLanguage): string {
  if (typeof value === "string") {
    if (preferredLanguage && preferredLanguage !== "json") {
      return value
    }

    const result = parseJsonText(value)
    if (result.ok) {
      return formatJsonValue(result.value)
    }

    return value
  }
  return formatJsonValue(value)
}

export function getCodeFileName(language: CodeLanguage): string {
  switch (language) {
    case "javascript":
      return "code.js"
    case "json":
      return "data.json"
    case "text":
      return "output.txt"
  }
}
