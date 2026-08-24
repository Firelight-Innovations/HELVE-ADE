/**
 * The Keyboard Shortcuts screen lists what the shell actually binds.
 *
 * `shortcuts.ts` is a second table describing `useKeyboard.ts`'s bindings, and
 * the failure it invites is silent: a chord renamed in one and not the other
 * leaves the screen promising a keystroke that does nothing, with every check
 * still green. These two tests are the reason that table is allowed to exist.
 */
import { describe, expect, it } from "vitest";
import { CHORDS } from "./useKeyboard";
import { SHORTCUT_GROUPS, type Chord } from "./shortcuts";

/** `"s+shift"` — one string per bound half of a `CHORDS` row. */
const id = (chord: Chord) => `${chord.key}${chord.shift ? "+shift" : ""}`;

/** Every half of `CHORDS` that is bound to something. */
function boundChords(): string[] {
  const found: string[] = [];
  for (const [key, row] of Object.entries(CHORDS)) {
    if (row.plain) found.push(id({ key, shift: false }));
    if (row.shift) found.push(id({ key, shift: true }));
  }
  return found.sort();
}

/** Every chord the screen claims, across all groups. */
function claimedChords(): string[] {
  return SHORTCUT_GROUPS.flatMap((group) => group.items)
    .flatMap((item) => item.chords ?? [])
    .map(id)
    .sort();
}

describe("the shortcuts list and the keymap", () => {
  it("account for exactly the same chords", () => {
    expect(claimedChords()).toEqual(boundChords());
  });

  /**
   * Separate from the test above because it catches a different mistake: two
   * rows claiming one chord compare equal to a keymap with a duplicate in it
   * only by accident, and a chord listed twice is two rows on screen saying
   * different things about one keystroke.
   */
  it("claim no chord twice", () => {
    const claimed = claimedChords();
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});
