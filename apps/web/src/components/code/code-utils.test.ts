import { describe, expect, it } from "vitest"
import {
  formatJsonText,
  formatJsonValue,
  getCodeLanguageForValue,
  getCodeSurfaceActionLabel,
} from "./code-utils"

describe("code surface helpers", () => {
  it("formats JSON values with stable indentation", () => {
    expect(formatJsonValue({ ok: true, nested: { count: 2 } })).toBe(
      '{\n  "ok": true,\n  "nested": {\n    "count": 2\n  }\n}',
    )
  })

  it("formats valid JSON text and reports invalid JSON text", () => {
    expect(formatJsonText('{"a":1}')).toEqual({ ok: true, value: '{\n  "a": 1\n}', error: null })

    const invalid = formatJsonText("{")
    expect(invalid.ok).toBe(false)
    expect(invalid.value).toBe("{")
    expect(invalid.error).toBeTruthy()
  })

  it("detects default languages", () => {
    expect(getCodeLanguageForValue({ ok: true })).toBe("json")
    expect(getCodeLanguageForValue("[1,2]")).toBe("json")
    expect(getCodeLanguageForValue("return inputs.payload")).toBe("text")
    expect(getCodeLanguageForValue("return inputs.payload", "javascript")).toBe("javascript")
  })

  it("labels readonly and editable dialogs", () => {
    expect(getCodeSurfaceActionLabel("readonly")).toBe("Full View")
    expect(getCodeSurfaceActionLabel("editable")).toBe("Editor")
  })
})
