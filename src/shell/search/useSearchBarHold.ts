/**
 * The switcher bar's copy of "is search open", which lags the real one on the
 * way down and not on the way up.
 *
 * Search opens and closes as two beats — the field crosses the bar, then the
 * overlay comes down; the overlay rolls up, then the field crosses back. The
 * first three of those fall out of framer for free, because they are animations
 * and an animation can be given a delay. The fourth cannot: the cluster chips do
 * not animate back at all. `switcher.css` is explicit about why — the collapsed
 * row has an empty rect, so there is nothing for framer to interpolate and the
 * chips return already drawn.
 *
 * So on close, the chips reappear the instant the boolean flips, which would put
 * them back underneath a field that is still full width and still shrinking. The
 * fix is not to delay an animation but to delay the state change, which is what
 * this is: one boolean, held at `true` for as long as the overlay takes to
 * leave, and never held on the way in.
 *
 * Opening is deliberately not deferred. The bar leads that direction, and a
 * field that hesitated before crossing would be answering the keystroke late.
 */
import { useEffect, useState } from "react";

/**
 * Follows `open` immediately when it becomes `true`, and after `holdMs` when it
 * becomes `false`.
 *
 * Reopening during the hold cancels it rather than queueing behind it — the
 * cleanup clears the pending timer, so a ⌘K landing 40ms after an Escape leaves
 * the bar expanded throughout instead of collapsing and immediately re-crossing.
 */
export function useSearchBarHold(open: boolean, holdMs: number): boolean {
  const [held, setHeld] = useState(open);

  useEffect(() => {
    if (open) {
      setHeld(true);
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), holdMs);
    return () => window.clearTimeout(timer);
  }, [open, holdMs]);

  return held;
}
