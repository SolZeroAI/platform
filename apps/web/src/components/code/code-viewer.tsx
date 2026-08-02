"use client"

import { File, type FileOptions } from "@pierre/diffs/react"
import { useMemo } from "react"
import { CODE_THEME } from "./highlighter"
import { getCodeFileName, type CodeLanguage } from "./code-utils"

interface CodeViewerProps {
  value: string
  language: CodeLanguage
  className?: string
}

const CODE_VIEWER_OPTIONS = {
  theme: CODE_THEME,
  disableFileHeader: true,
  disableLineNumbers: false,
  overflow: "scroll",
  tokenizeMaxLineLength: 1000,
} satisfies FileOptions<undefined>

export function CodeViewer({ value, language, className }: CodeViewerProps) {
  const file = useMemo(
    () => ({
      name: getCodeFileName(language),
      contents: value,
      cacheKey: `${language}:${value}`,
    }),
    [language, value],
  )

  return (
    <div className={className}>
      <File file={file} options={CODE_VIEWER_OPTIONS} />
    </div>
  )
}
