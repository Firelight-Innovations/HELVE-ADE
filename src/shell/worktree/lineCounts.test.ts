/**
 * The one rule in `lineCounts.ts` worth pinning down: an absent count and a
 * zero count are different facts and are drawn differently. Everything else
 * here is arithmetic, and is covered because the arithmetic is what the rule
 * has to survive.
 */
import { describe, expect, it } from "vitest";
import type { GitFileChange } from "../contract";
import { describeLineCounts, formatLineCounts, sumLineCounts } from "./lineCounts";

/** A change with only the fields these functions read. The rest of
 *  `GitFileChange` is irrelevant here and is filled in so the type is honest
 *  rather than cast away. */
function change(insertions: number | null, deletions: number | null): GitFileChange {
  return {
    path: "src/a.ts",
    file: "a.ts",
    dir: "src",
    kind: "modified",
    staged: false,
    insertions,
    deletions,
  };
}

describe("formatLineCounts", () => {
  it("prints both columns with a plus and a minus sign", () => {
    expect(formatLineCounts(12, 3)).toEqual({ added: "+12", removed: "−3" });
  });

  it("prints a zero on one side when the other has a count", () => {
    expect(formatLineCounts(0, 4)).toEqual({ added: "+0", removed: "−4" });
    expect(formatLineCounts(4, 0)).toEqual({ added: "+4", removed: "−0" });
  });

  // The distinction this module exists for: a binary file has no counts and
  // must not be drawn as a file that changed by nothing.
  it("prints nothing for a change with no counts", () => {
    expect(formatLineCounts(null, null)).toBeNull();
  });

  it("prints nothing when both counts are zero", () => {
    expect(formatLineCounts(0, 0)).toBeNull();
  });
});

describe("describeLineCounts", () => {
  it("says both counts in words", () => {
    expect(describeLineCounts(12, 3)).toBe("12 lines added, 3 lines removed");
  });

  it("says one line in the singular", () => {
    expect(describeLineCounts(1, 1)).toBe("1 line added, 1 line removed");
  });

  it("says nothing wherever the columns print nothing", () => {
    expect(describeLineCounts(null, null)).toBeNull();
    expect(describeLineCounts(0, 0)).toBeNull();
  });
});

describe("sumLineCounts", () => {
  it("adds the counted changes", () => {
    expect(sumLineCounts([change(12, 3), change(5, 0)])).toEqual({
      insertions: 17,
      deletions: 3,
      uncounted: 0,
    });
  });

  // A section header that quietly folded an uncountable file into its totals
  // would report `+40 −2` over nine files while having read eight.
  it("counts the changes it could not add rather than dropping them", () => {
    expect(sumLineCounts([change(12, 3), change(null, null), change(null, null)])).toEqual({
      insertions: 12,
      deletions: 3,
      uncounted: 2,
    });
  });

  it("is zero for an empty list", () => {
    expect(sumLineCounts([])).toEqual({ insertions: 0, deletions: 0, uncounted: 0 });
  });
});
