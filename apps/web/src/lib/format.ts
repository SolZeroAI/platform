/**
 * Utility functions for formatting display values
 */

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
