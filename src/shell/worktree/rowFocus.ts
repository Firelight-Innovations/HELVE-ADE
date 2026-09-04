/**
 * Focus a clicked row without letting the browser scroll the list to it.
 *
 * This is the fix for a row at the top or bottom edge of a scrolling list that
 * could not be clicked at all: focusing it on `mousedown` scrolled it out from
 * under the cursor, so `mouseup` landed elsewhere and no `click` was ever
 * generated. **The scroll is Chromium's own — nothing here calls
 * `scrollIntoView` — so grepping for one finds nothing and proves nothing.**
 *
 * The full account and the two rejected alternatives:
 * `docs/design-notes/shell-worktree.md`, under this path. `rowFocus.test.tsx`
 * beside this file holds both lines below to their contract; the symptom itself
 * needs layout and is still uncovered, which that test's own header says.
 */
import type { MouseEvent } from "react";

/** Mouse only, deliberately: a row focused by Tab or by the commit graph's
 *  arrow keys *should* scroll into view, and neither path comes through here. */
export function focusWithoutScrolling(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
}
