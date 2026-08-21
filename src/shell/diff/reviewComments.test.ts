import { describe, expect, it } from "vitest";
import type { ReviewComment, ReviewScope } from "../contract";
import {
  anchorFor,
  commentsFor,
  countLabel,
  decorations,
  describeRange,
  markAtLine,
  unresolved,
  unsent,
} from "./reviewComments";

function note(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "n1",
    path: "src/a.ts",
    scope: "unstaged",
    startLine: 1,
    endLine: 1,
    body: "a note",
    createdAt: 1,
    resolved: false,
    ...over,
  };
}

describe("commentsFor", () => {
  it("keeps only the notes for this file in this diff", () => {
    const all = [
      note({ id: "keep", path: "src/a.ts", scope: "unstaged" }),
      note({ id: "other-file", path: "src/b.ts", scope: "unstaged" }),
      note({ id: "other-scope", path: "src/a.ts", scope: "staged" }),
    ];

    expect(commentsFor(all, "src/a.ts", "unstaged").map((c) => c.id)).toEqual(["keep"]);
  });

  /** The scope filter is the load-bearing half — same file, same line, different code. */
  it("does not let a note from one diff surface against another", () => {
    const all: ReviewComment[] = (["unstaged", "staged", "branch"] as ReviewScope[]).map((scope) =>
      note({ id: scope, scope, startLine: 7, endLine: 7 }),
    );

    expect(commentsFor(all, "src/a.ts", "branch").map((c) => c.id)).toEqual(["branch"]);
  });

  it("orders by position in the file, then by age", () => {
    const all = [
      note({ id: "late-top", startLine: 2, endLine: 2, createdAt: 99 }),
      note({ id: "bottom", startLine: 40, endLine: 40, createdAt: 1 }),
      note({ id: "early-top", startLine: 2, endLine: 2, createdAt: 5 }),
    ];

    expect(commentsFor(all, "src/a.ts", "unstaged").map((c) => c.id)).toEqual([
      "early-top",
      "late-top",
      "bottom",
    ]);
  });

  it("does not mutate what it was handed", () => {
    const all = [note({ id: "b", startLine: 9 }), note({ id: "a", startLine: 1 })];

    commentsFor(all, "src/a.ts", "unstaged");

    expect(all.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("decorations", () => {
  it("draws one marker per range, however many notes are on it", () => {
    const found = decorations([
      note({ id: "1", startLine: 5, endLine: 5 }),
      note({ id: "2", startLine: 5, endLine: 5 }),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].comments.map((c) => c.id)).toEqual(["1", "2"]);
  });

  /** A note on 3-9 and a note on 3 are about different code — see the doc comment. */
  it("keeps ranges that share a start line apart", () => {
    const found = decorations([
      note({ id: "single", startLine: 3, endLine: 3 }),
      note({ id: "span", startLine: 3, endLine: 9 }),
    ]);

    expect(found.map((d) => `${d.startLine}-${d.endLine}`)).toEqual(["3-3", "3-9"]);
  });

  it("comes back in file order whatever order it was given", () => {
    const found = decorations([
      note({ startLine: 40, endLine: 41 }),
      note({ startLine: 2, endLine: 2 }),
      note({ startLine: 12, endLine: 12 }),
    ]);

    expect(found.map((d) => d.startLine)).toEqual([2, 12, 40]);
  });

  it("has nothing to draw for no notes", () => {
    expect(decorations([])).toEqual([]);
  });
});

describe("markAtLine", () => {
  const marks = decorations([
    note({ id: "span", startLine: 3, endLine: 9 }),
    note({ id: "single", startLine: 20, endLine: 20 }),
  ]);

  it("finds the marker on the line itself", () => {
    expect(markAtLine(marks, 20)?.comments[0].id).toBe("single");
  });

  it("finds a marker from anywhere inside its range, ends included", () => {
    for (const line of [3, 6, 9]) {
      expect(markAtLine(marks, line)?.comments[0].id).toBe("span");
    }
  });

  it("finds nothing on a line no marker covers", () => {
    for (const line of [1, 2, 10, 19, 21]) {
      expect(markAtLine(marks, line)).toBeUndefined();
    }
  });

  /**
   * The bug this was extracted for: the click handler and the hover affordance
   * both have to agree that a line is noted. When they disagreed, a noted line
   * grew an "add" plus through its own marker on hover, because Monaco merges
   * two glyph classes into one cell rather than letting one win.
   */
  it("agrees for every line of a range, so hover and click cannot disagree", () => {
    const noted = [3, 4, 5, 6, 7, 8, 9].map((line) => markAtLine(marks, line) !== undefined);
    expect(noted).toEqual([true, true, true, true, true, true, true]);
  });

  it("has nothing to find among no markers", () => {
    expect(markAtLine([], 5)).toBeUndefined();
  });
});

describe("unsent and unresolved", () => {
  it("counts a note with no sent stamp as unsent", () => {
    const all = [note({ id: "fresh" }), note({ id: "gone", sentAt: 10 })];
    expect(unsent(all).map((c) => c.id)).toEqual(["fresh"]);
  });

  /** Resolving and sending are different questions; see `unsent`'s doc comment. */
  it("still counts a resolved note as unsent when it was never sent", () => {
    const all = [note({ id: "resolved-but-unsent", resolved: true })];
    expect(unsent(all).map((c) => c.id)).toEqual(["resolved-but-unsent"]);
  });

  it("counts a sent note as unresolved until somebody says otherwise", () => {
    const all = [note({ id: "sent", sentAt: 10 })];
    expect(unresolved(all).map((c) => c.id)).toEqual(["sent"]);
  });
});

describe("labels", () => {
  it("names a single line and a range differently", () => {
    expect(describeRange(note({ startLine: 12, endLine: 12 }))).toBe("Line 12");
    expect(describeRange(note({ startLine: 12, endLine: 18 }))).toBe("Lines 12-18");
  });

  it("gets the plural right", () => {
    expect(countLabel(0)).toBe("0 notes");
    expect(countLabel(1)).toBe("1 note");
    expect(countLabel(4)).toBe("4 notes");
  });
});

describe("anchorFor", () => {
  it("anchors a caret to the line it is on", () => {
    expect(
      anchorFor({ startLineNumber: 7, startColumn: 3, endLineNumber: 7, endColumn: 3 }),
    ).toEqual({ startLine: 7, endLine: 7 });
  });

  it("anchors a selection to the lines it covers", () => {
    expect(
      anchorFor({ startLineNumber: 4, startColumn: 1, endLineNumber: 9, endColumn: 12 }),
    ).toEqual({ startLine: 4, endLine: 9 });
  });

  /** The drag case: three lines selected must not become four. */
  it("trims a selection that ends at the start of the next line", () => {
    expect(
      anchorFor({ startLineNumber: 4, startColumn: 1, endLineNumber: 7, endColumn: 1 }),
    ).toEqual({ startLine: 4, endLine: 6 });
  });

  it("does not trim a selection back past its own start", () => {
    expect(
      anchorFor({ startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 }),
    ).toEqual({ startLine: 4, endLine: 4 });
  });

  it("does not trim a selection that ends anywhere but column 1", () => {
    expect(
      anchorFor({ startLineNumber: 4, startColumn: 1, endLineNumber: 7, endColumn: 2 }),
    ).toEqual({ startLine: 4, endLine: 7 });
  });
});
