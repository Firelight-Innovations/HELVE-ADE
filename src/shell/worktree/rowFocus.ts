/**
 * Focus a clicked row without letting the browser scroll the list to it.
 *
 * **This is the fix for a row that could not be clicked at all.** Every list in
 * this panel scrolls — `.worktree__lists`, `.worktreepanel__divlist` and
 * `.worktreepanel__graph-scroll` are each `overflow-y: auto` — and every row in
 * them is focusable. Chromium focuses a control on `mousedown`, and focusing an
 * element that is only partly in view scrolls it into view, so a row at the top
 * or bottom edge of a list slid out from under the cursor between the press and
 * the release. `mouseup` then landed on a different element, no `click` was
 * generated at all, and the row did nothing.
 *
 * A row in the middle of a list does not move and always worked, which is what
 * made this read as a mystery rather than as geometry: the handler, the state,
 * the identity lookup and the pane were all fine, and activating the same row
 * from the keyboard opened it every time.
 */
import type { MouseEvent } from "react";

/**
 * `preventDefault` suppresses the browser's own focus, and the scroll with it;
 * the explicit `focus` puts the focus back without one. `preventScroll` is the
 * whole trick — a plain `focus()` here would scroll exactly as the default did.
 *
 * **Rejected: activating on `pointerup` or `mousedown` instead of `click`.** Both
 * sidestep the pairing rather than fixing it, and both break the keyboard —
 * neither fires for Enter on a focused button, so `onClick` would have to stay
 * beside them and every mouse activation would then run twice.
 *
 * **Rejected: leaving focus alone and giving the rows `scroll-margin`.** That
 * changes where a scroll lands, not whether one happens, so the row still moves.
 *
 * Mouse only, deliberately: a row focused by Tab or by the commit graph's arrow
 * keys *should* scroll into view, and no such path comes through here.
 */
export function focusWithoutScrolling(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
}
