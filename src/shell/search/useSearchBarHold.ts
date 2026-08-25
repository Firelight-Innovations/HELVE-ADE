/**
 * The switcher bar's copy of "is search open", which lags the real one on the
 * way down and not on the way up. Why the fourth beat cannot be a framer delay,
 * and why opening is deliberately not deferred: `docs/design-notes/shell-search.md`.
 */
import { useEffect, useState } from "react";

/**
 * Follows `open` immediately when it becomes `true`, and after `holdMs` when
 * it becomes `false`. Reopening during the hold cancels it rather than
 * queueing behind it — the cleanup clears the pending timer, so a Ctrl+K landing
 * 40ms after an Escape leaves the bar expanded throughout instead of
 * collapsing and immediately re-crossing.
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
