import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../contract";
import { formatComment, formatComments } from "./reviewPrompt";

function note(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "n1",
    path: "src/a.ts",
    scope: "unstaged",
    startLine: 12,
    endLine: 12,
    body: "tighten this",
    createdAt: 1,
    resolved: false,
    ...over,
  };
}

describe("formatComment", () => {
  it("names the file, the line, the diff and the note", () => {
    expect(formatComment(note())).toBe(
      [
        "File: src/a.ts",
        "Line: 12",
        "Diff: the uncommitted changes",
        'User comment: "tighten this"',
      ].join("\n"),
    );
  });

  it("says lines rather than line for a range", () => {
    expect(formatComment(note({ startLine: 12, endLine: 18 }))).toContain("Lines: 12-18");
  });

  it("names each of the three diffs distinctly", () => {
    const said = (["unstaged", "staged", "branch"] as const).map(
      (scope) => formatComment(note({ scope })).split("\n")[2],
    );

    expect(new Set(said).size).toBe(3);
    expect(said[1]).toBe("Diff: the staged changes");
    expect(said[2]).toBe("Diff: this branch's changes since it forked");
  });
});

describe("escaping", () => {
  /** The reason the body is quoted and flattened at all: a pasted newline is a submitted line. */
  it("flattens a multi-line body onto one line", () => {
    const formatted = formatComment(note({ body: "first\nsecond" }));

    expect(formatted).toContain('User comment: "first\\nsecond"');
    expect(formatted.split("\n")).toHaveLength(4);
  });

  it("escapes a carriage return as well as a newline", () => {
    expect(formatComment(note({ body: "a\r\nb" }))).toContain('"a\\r\\nb"');
  });

  it("escapes a quote so it cannot close the string early", () => {
    expect(formatComment(note({ body: 'call it "done"' }))).toContain(
      'User comment: "call it \\"done\\""',
    );
  });

  /** Backslash is escaped first, or every escape after it is escaped twice. */
  it("escapes a backslash exactly once", () => {
    expect(formatComment(note({ body: "C:\\Users" }))).toContain('"C:\\\\Users"');
    expect(formatComment(note({ body: "a\\nb" }))).toContain('"a\\\\nb"');
  });
});

describe("formatComments", () => {
  it("has nothing to say about no notes", () => {
    expect(formatComments([])).toBe("");
  });

  it("introduces a single note in the singular", () => {
    const text = formatComments([note()]);

    expect(text.startsWith("Here is a review note")).toBe(true);
    expect(text).toContain("File: src/a.ts");
  });

  it("counts the notes in the preamble and separates them with a blank line", () => {
    const text = formatComments([note({ id: "1" }), note({ id: "2", startLine: 40, endLine: 40 })]);

    expect(text.startsWith("Here are 2 review notes")).toBe(true);
    expect(text).toContain('User comment: "tighten this"\n\nFile: src/a.ts');
  });

  /** The determinism the module header promises: the same notes, the same string. */
  it("is deterministic", () => {
    const notes = [note({ id: "1" }), note({ id: "2", startLine: 3, endLine: 5 })];
    expect(formatComments(notes)).toBe(formatComments(notes));
  });
});
