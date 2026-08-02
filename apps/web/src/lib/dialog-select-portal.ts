const DIALOG_SELECT_PORTAL_ATTR = "data-dialog-select-portal"

let dialogSelectPortalRoot: HTMLElement | null = null

/** Shared portal target for Kumo Select menus opened inside modal dialogs. */
export function getDialogSelectPortalRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null
  }

  if (!dialogSelectPortalRoot || !document.body.contains(dialogSelectPortalRoot)) {
    dialogSelectPortalRoot = document.createElement("div")
    dialogSelectPortalRoot.setAttribute(DIALOG_SELECT_PORTAL_ATTR, "")
    document.body.appendChild(dialogSelectPortalRoot)
  }

  return dialogSelectPortalRoot
}
