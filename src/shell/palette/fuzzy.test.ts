/**
 * What the palette's field matches, and in what order.
 *
 * Ordering is the whole of whether a palette is usable — the first row is the
 * one Enter runs, so a scorer that puts `Terminal: Clear` above `Edit: Copy`
 * for `copy` is a palette that does the wrong thing to a keystroke nobody
 * looked at. These pin the bonuses that decide it, using the shell's own
 * labels rather than invented strings.
 */
import { describe, expect, it } from "vitest";
import { fuzzyMatch, matchRuns } from "./fuzzy";

/** The score, or `null`. Most assertions here are about which of two is higher. */
const score = (needle: string, haystack: string): number | null =>
  fuzzyMatch(needle, haystack)?.score ?? null;

describe("matching a needle against a label", () => {
  it("matches a subsequence, not just a substring", () => {
    expect(score("vzi", "View: Zoom In")).not.toBeNull();
  });

  it("does not match when a character is missing", () => {
    expect(score("zqoom", "View: Zoom In")).toBeNull();
  });

  it("ignores case on both sides", () => {
    expect(score("ZOOM", "View: Zoom In")).not.toBeNull();
    expect(score("zoom", "VIEW: ZOOM IN")).not.toBeNull();
  });

  it("matches everything on an empty needle, so the palette opens on a full list", () => {
    expect(fuzzyMatch("", "View: Zoom In")).toEqual({ score: 0, positions: [] });
  });

  it("reports the characters it matched, in order", () => {
    expect(fuzzyMatch("zoom", "View: Zoom In")?.positions).toEqual([6, 7, 8, 9]);
  });
});

/**
 * Every run of the needle has to match, but the runs are matched independently
 * — so the order the words are typed in cannot decide whether a command is
 * findable. Nobody typing into a palette is thinking about that order.
 */
describe("a needle of several words", () => {
  it("finds the command whichever way round the words are typed", () => {
    expect(score("view zoom", "View: Zoom In")).not.toBeNull();
    expect(score("zoom view", "View: Zoom In")).not.toBeNull();
  });

  it("still requires every word", () => {
    expect(score("view zoom pane", "View: Zoom In")).toBeNull();
  });
});

describe("the ordering the bonuses produce", () => {
  it("puts a word-start match above one buried mid-word", () => {
    expect(score("term", "Terminal: New Terminal")).toBeGreaterThan(
      score("term", "File: Determine Something") ?? 0,
    );
  });

  it("puts a whole word above the same letters spread across several", () => {
    expect(score("save", "File: Save")).toBeGreaterThan(score("save", "Apps: Set A Value") ?? 0);
  });

  /**
   * The regression for the anchor bug in `matchToken`. A leftmost-only scan
   * matched `in` against the "in" *inside* "Terminal", collected the
   * consecutive-pair bonus for it, and ranked that label above the one a person
   * would have picked — where the leftmost `i` is in "View" and the `n` is
   * eleven characters away.
   */
  it("anchors each word where it scores best, not where it first appears", () => {
    expect(score("view zoom in", "View: Zoom In")).toBeGreaterThan(
      score("view zoom in", "Terminal: Zoom In View") ?? 0,
    );
  });

  it("breaks a tie toward the shorter, more specific label", () => {
    expect(score("save", "File: Save")).toBeGreaterThan(
      score("save", "Apps › Presets: Save Current Layout…") ?? 0,
    );
  });
});

/**
 * The runs the row draws. One element per character was the shape this
 * replaced: sixty rows of forty characters is 2400 nodes rebuilt per
 * keystroke.
 */
describe("cutting a label into matched and unmatched runs", () => {
  it("groups neighbouring matches into one run", () => {
    expect(matchRuns("Zoom In", [0, 1, 2, 3])).toEqual([
      { text: "Zoom", hit: true },
      { text: " In", hit: false },
    ]);
  });

  it("alternates when the matches are scattered", () => {
    expect(matchRuns("Zoom In", [0, 5])).toEqual([
      { text: "Z", hit: true },
      { text: "oom ", hit: false },
      { text: "I", hit: true },
      { text: "n", hit: false },
    ]);
  });

  it("returns the whole label unmatched when nothing matched", () => {
    expect(matchRuns("Zoom In", [])).toEqual([{ text: "Zoom In", hit: false }]);
  });

  /** Whatever it does with the runs, the row must still read as the label. */
  it("loses no characters", () => {
    const label = "Apps › Presets: Save Current Layout…";
    const rejoined = matchRuns(label, [0, 1, 7, 20, 21])
      .map((run) => run.text)
      .join("");
    expect(rejoined).toBe(label);
  });
});
