const STICKY_SELECT_PORTAL_ATTR = "data-sticky-select-portal"

let stickySelectPortalRoot: HTMLElement | null = null

/** Shared portal target for Kumo Select menus opened from sticky page controls. */
export function getStickySelectPortalRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null
  }

  if (!stickySelectPortalRoot || !document.body.contains(stickySelectPortalRoot)) {
    stickySelectPortalRoot = document.createElement("div")
    stickySelectPortalRoot.setAttribute(STICKY_SELECT_PORTAL_ATTR, "")
    document.body.appendChild(stickySelectPortalRoot)
  }

  return stickySelectPortalRoot
}
