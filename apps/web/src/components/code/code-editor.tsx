"use client"

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import shiki from "codemirror-shiki"
import { useEffect, useMemo, useRef } from "react"
import { useTheme } from "@/lib/theme"
import type { CodeLanguage } from "./code-utils"
import { CODE_THEME, getCodeHighlighter } from "./highlighter"

interface CodeEditorProps {
  value: string
  language: CodeLanguage
  onChange?: (value: string) => void
  className?: string
  readOnly?: boolean
  autoFocus?: boolean
}

const codeEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "100%",
    backgroundColor: "var(--color-kumo-control)",
    color: "var(--text-color-kumo-default)",
    fontSize: "12px",
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily:
      "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "10px 0",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-kumo-tint)",
    borderRight: "1px solid var(--color-kumo-line)",
    color: "var(--text-color-kumo-subtle)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--color-kumo-tint)",
    color: "var(--text-color-kumo-default)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--color-kumo-tint)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--color-kumo-tint)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-color-kumo-default)",
  },
})

function getLanguageExtensions(language: CodeLanguage) {
  switch (language) {
    case "javascript":
      return [javascript()]
    case "json":
      return [json()]
    case "text":
      return []
  }
}

export function CodeEditor({
  value,
  language,
  onChange,
  className,
  readOnly = false,
  autoFocus = true,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const suppressChangeRef = useRef(false)
  const { resolvedTheme } = useTheme()
  const theme = CODE_THEME[resolvedTheme]

  onChangeRef.current = onChange
  valueRef.current = value

  const extensions = useMemo(
    () => [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      indentUnit.of("  "),
      bracketMatching(),
      closeBrackets(),
      ...getLanguageExtensions(language),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...defaultKeymap,
      ]),
      codeEditorTheme,
      ...(language === "text"
        ? []
        : [
            shiki({
              highlighter: getCodeHighlighter(),
              language,
              theme,
            }),
          ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppressChangeRef.current || readOnly) {
          return
        }
        onChangeRef.current?.(update.state.doc.toString())
      }),
    ],
    [language, readOnly, theme],
  )

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({ doc: valueRef.current, extensions }),
    })
    viewRef.current = view
    const frameId = window.requestAnimationFrame(() => {
      view.requestMeasure()
      if (autoFocus) {
        view.focus()
      }
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      view.destroy()
      if (viewRef.current === view) {
        viewRef.current = null
      }
    }
  }, [autoFocus, extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    const currentValue = view.state.doc.toString()
    if (currentValue === value) {
      return
    }

    suppressChangeRef.current = true
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
    })
    suppressChangeRef.current = false
  }, [value])

  return <div ref={containerRef} className={className} />
}
