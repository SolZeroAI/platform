/**
 * Recessed form fields.
 *
 * A "recessed" field uses the `bg-kumo-recessed` surface (#262626) so it reads as inset on an
 * elevated card surface (`bg-kumo-base` / `bg-kumo-elevated`, #2d2d2d). Reach for these whenever
 * an input, select, textarea, or Kumo `InputGroup` sits on top of a card.
 *
 * Why overrides are needed at all:
 * - `app.css` sets a global `input, select, textarea { background: #2d2d2d }` rule.
 * - Kumo's `InputGroup` defaults its surface to `bg-kumo-control` (#2d2d2d).
 *
 * The native helpers win on specificity alone; the `InputGroup` helpers use Tailwind v4 important
 * (suffix `!`, not prefix) to override Kumo's own utilities.
 */

/** Native `<input>` / `<select>` on a card. Compose with layout, e.g. `` `mt-1 w-full ${recessedFieldClassName}` ``. */
export const recessedFieldClassName =
  "rounded-lg border border-kumo-hairline bg-kumo-recessed px-2 py-1.5 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-focus"

/** Native `<textarea>` on a card. Compose with size, e.g. `` `mt-1 h-28 w-full ${recessedTextareaClassName}` ``. */
export const recessedTextareaClassName =
  "resize-none rounded-lg border border-kumo-hairline bg-kumo-recessed px-2 py-1.5 text-sm text-kumo-default outline-none focus:ring-2 focus:ring-kumo-focus"

/**
 * Standalone Kumo `Input` / `InputArea` on a card. When `invalid`, swaps the hairline ring for a
 * danger ring so a ring-only validation state can be driven by `aria-invalid` alone (no Kumo `error`
 * message). When Kumo's `error` prop is also set, the matching danger ring just reinforces Kumo's.
 */
export function recessedInputClassName(invalid = false): string {
  return invalid ? "bg-kumo-recessed! ring-kumo-danger!" : "bg-kumo-recessed! ring-kumo-hairline!"
}

/**
 * Kumo `InputGroup` with no non-ghost button (Kumo "container" mode). The hairline ring is scoped
 * to the non-error state via `has-[input:not([aria-invalid=true])]` so Kumo's danger ring wins when
 * the group's `error` prop sets `aria-invalid` on the input.
 */
export const recessedInputGroupClassName =
  "bg-kumo-recessed! shadow-xs [&_input]:bg-kumo-recessed! has-[input:not([aria-invalid=true])]:ring-kumo-hairline!"

/** Kumo `Combobox.TriggerInput` on a recessed card surface (matches `recessedInputGroupClassName`). */
export const recessedComboboxTriggerClassName =
  "max-w-none! w-full shadow-xs [&_input]:bg-kumo-recessed! has-[input:not([aria-invalid=true])]:[&_input]:ring-kumo-hairline!"

/**
 * Kumo `InputGroup` that contains a non-ghost `InputGroup.Button` (Kumo "individual" mode).
 * Because the group has a `label`, Kumo inserts an absolute label overlay as the first child,
 * which steals `first:rounded-l-[inherit]` from the input — so we re-apply the inherited radius
 * and align the input/button borders with the rest of the field.
 */
export const recessedInputGroupWithButtonClassName =
  "bg-kumo-recessed! ring-kumo-hairline! shadow-xs [&_input]:bg-kumo-recessed! [&_input]:rounded-l-[inherit]! [&_input]:border-kumo-hairline! [&_button]:border-kumo-hairline!"
