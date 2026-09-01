/**
 * The round trip that "clicking a row shows nothing" would break: the value a
 * click writes has to be the value the pane and the highlight read back.
 *
 * The runner is `node` with no DOM (STANDARDS.md §8.3), so none of this can
 * press a button. It pins the layer below the button instead — which is the
 * layer where a row's identity could disagree with itself.
 */
import { describe, expect, it } from "vitest";
import type { GitFileChange } from "../contract";
import { followAcrossIndex, isRowSelected, selectionFor } from "./selection";

function change(path: string, staged: boolean): GitFileChange {
  const cut = path.lastIndexOf("/");
  return {
    path,
    file: cut === -1 ? path : path.slice(cut + 1),
    dir: cut === -1 ? "" : path.slice(0, cut),
    kind: "modified",
    staged,
    insertions: 1,
    deletions: 0,
  };
}

describe("selectionFor and isRowSelected", () => {
  // The round trip. If these two ever disagree about what identifies a row, a
  // click sets state and nothing on screen matches it.
  it("agrees with itself for every row", () => {
    for (const row of [
      change("src/a.ts", true),
      change("src/a.ts", false),
      change("README.md", false),
      change("deep/nested/path/file.rs", true),
    ]) {
      expect(isRowSelected(selectionFor(row), row)).toBe(true);
    }
  });

  it("does not match the same path on the other side of the index", () => {
    const stagedRow = change("src/a.ts", true);
    const unstagedRow = change("src/a.ts", false);
    expect(isRowSelected(selectionFor(stagedRow), unstagedRow)).toBe(false);
    expect(isRowSelected(selectionFor(unstagedRow), stagedRow)).toBe(false);
  });

  it("does not match a different path on the same side", () => {
    expect(isRowSelected(selectionFor(change("src/a.ts", true)), change("src/b.ts", true))).toBe(
      false,
    );
  });

  it("matches nothing when no row is open", () => {
    expect(isRowSelected(null, change("src/a.ts", true))).toBe(false);
  });

  it("carries only the two fields the readers use", () => {
    expect(selectionFor(change("src/a.ts", true))).toEqual({ path: "src/a.ts", staged: true });
  });
});

describe("followAcrossIndex", () => {
  it("moves the open row to the other side when it is the one staged", () => {
    const open = { path: "src/a.ts", staged: false };
    expect(followAcrossIndex(open, ["src/a.ts"], false)).toEqual({
      path: "src/a.ts",
      staged: true,
    });
  });

  it("moves the open row when a whole section is staged at once", () => {
    const open = { path: "src/b.ts", staged: false };
    expect(followAcrossIndex(open, ["src/a.ts", "src/b.ts", "src/c.ts"], false)).toEqual({
      path: "src/b.ts",
      staged: true,
    });
  });

  it("moves it back on unstage", () => {
    const open = { path: "src/a.ts", staged: true };
    expect(followAcrossIndex(open, ["src/a.ts"], true)).toEqual({
      path: "src/a.ts",
      staged: false,
    });
  });

  // The case the `staged` argument exists for: the same path is in both lists,
  // and only the row that actually moved should drag the pane with it.
  it("leaves a selection on the other side alone", () => {
    const open = { path: "src/a.ts", staged: true };
    expect(followAcrossIndex(open, ["src/a.ts"], false)).toBe(open);
  });

  it("leaves an unrelated path alone", () => {
    const open = { path: "src/z.ts", staged: false };
    expect(followAcrossIndex(open, ["src/a.ts", "src/b.ts"], false)).toBe(open);
  });

  it("stays closed when nothing is open", () => {
    expect(followAcrossIndex(null, ["src/a.ts"], false)).toBeNull();
  });

  // Never `null` for an open row — closing is what cost the second click.
  it("never closes an open pane", () => {
    const open = { path: "src/a.ts", staged: false };
    for (const paths of [["src/a.ts"], ["src/other.ts"], []]) {
      for (const staged of [true, false]) {
        expect(followAcrossIndex(open, paths, staged)).not.toBeNull();
      }
    }
  });
});
