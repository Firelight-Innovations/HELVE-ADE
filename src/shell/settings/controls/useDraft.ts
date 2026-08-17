/**
 * A field's text while it is being typed, re-seeded whenever the stored value
 * moves underneath it.
 *
 * Every text-shaped control on this screen has the same problem. `useSettings`
 * writes optimistically on every call, so a field wired straight to `session.set`
 * would send one write per keystroke — and half of those keystrokes are not
 * values at all. Clearing a number field to retype it passes through `""`, and
 * typing `120` passes through `1` and `12`, each of which Rust would dutifully
 * clamp into range and hand back, rewriting the field under the cursor.
 *
 * So the field owns its own text and commits on blur and on Enter, which are the
 * two moments a person has finished.
 *
 * The rejected alternative was debouncing the write. It removes the round trips
 * but not the problem: a debounced `""` is still a write of nothing, just later.
 */
import { useEffect, useState } from "react";

export function useDraft(committed: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(committed);

  // The other half of the deal. Rust answers a write with the value it *stored*,
  // not the one it was sent, so a clamped answer has to land in the field. This
  // fires on any change to the stored value — a write from another window, a
  // section reset, or the clamp — because none of those are distinguishable from
  // here and all three mean the same thing: what is on screen is out of date.
  useEffect(() => setDraft(committed), [committed]);

  return [draft, setDraft];
}
