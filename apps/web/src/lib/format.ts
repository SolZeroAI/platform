/**
 * Utility functions for formatting display values
 */

import { MODEL_OPTIONS, normalizeModelId } from "@solzero/shared"

const MODEL_DISPLAY_NAMES = new Map<string, string>(
  MODEL_OPTIONS.flatMap((g) => g.models.map((m) => [m.id, m.name])),
)

export function formatModelName(modelId: string): string {
  if (!modelId) {
    return "Unknown Model"
  }
  return MODEL_DISPLAY_NAMES.get(normalizeModelId(modelId)) ?? modelId
}

export function formatModelNameLower(modelId: string): string {
  if (!modelId) {
    return "unknown model"
  }
  return (MODEL_DISPLAY_NAMES.get(normalizeModelId(modelId)) ?? modelId).toLowerCase()
}

export function truncateBranch(branchName: string, maxLength = 30): string {
  if (!branchName) {
    return ""
  }
  if (branchName.length <= maxLength) {
    return branchName
  }
  return `...${branchName.slice(-maxLength)}`
}

function copyToClipboardWithTextArea(text: string): boolean {
  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.position = "fixed"
  textArea.style.left = "-999999px"
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  try {
    return document.execCommand("copy")
  } finally {
    textArea.remove()
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return copyToClipboardWithTextArea(text)
    }
  }

  return copyToClipboardWithTextArea(text)
}

export function formatFilePath(
  filePath: string,
  maxLength = 40,
): { display: string; full: string } {
  if (!filePath) {
    return { display: "", full: "" }
  }

  const parts = filePath.split("/")
  const basename = parts[parts.length - 1]

  if (basename.length <= maxLength) {
    return { display: basename, full: filePath }
  }

  return {
    display: `${basename.slice(0, maxLength - 3)}...`,
    full: filePath,
  }
}

export function formatDiffStat(
  additions: number,
  deletions: number,
): { additions: string; deletions: string } {
  return {
    additions: additions > 0 ? `+${additions}` : "+0",
    deletions: deletions > 0 ? `-${deletions}` : "-0",
  }
}
