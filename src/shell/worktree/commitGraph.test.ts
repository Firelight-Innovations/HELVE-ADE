/**
 * The two pure halves of the commit graph: which column a commit lands in
 * (`layoutCommits`) and which lines a row has to draw (`rowSegments`).
 *
 * Both are testable without a DOM, which is the whole reason the layout maths
 * was kept out of the component in the first place — the runner here is `node`
 * with no rendering library, so a component test is not merely absent but
 * impossible (see `vitest.config.ts`).
 */
import { describe, expect, it } from "vitest";
import type { GitCommit } from "../contract";
import { laneColor, layoutCommits, rowSegments } from "./CommitGraph";

/** A commit with only the fields the layout reads. `when`, `author` and the
 *  rest are filled in so the type is honest rather than cast away. */
function commit(sha: string, parents: string[]): GitCommit {
  return {
    sha,
    short: sha.slice(0, 7),
    summary: `commit ${sha}`,
    author: "someone",
    when: 1_700_000_000,
    parents,
    refs: [],
  };
}

describe("layoutCommits", () => {
  it("keeps a linear history in one lane", () => {
    const placed = layoutCommits([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(placed.map((p) => p.lane)).toEqual([0, 0, 0]);
  });

  // Two tips with a shared parent: the second tip has no lane waiting for it,
  // so it opens one, and the shared parent lands back in whichever got there
  // first — the convergence the graph draws as two lines meeting.
  it("gives a second branch tip its own lane and converges at the shared parent", () => {
    const placed = layoutCommits([
      commit("tipA", ["base"]),
      commit("tipB", ["base"]),
      commit("base", []),
    ]);
    expect(placed.map((p) => p.lane)).toEqual([0, 1, 0]);
    // The second lane is closed by the convergence rather than left open.
    expect(placed[2].lanesAfter[1] ?? null).toBeNull();
  });

  it("opens a lane for a merge's second parent", () => {
    const placed = layoutCommits([commit("merge", ["first", "second"]), commit("first", [])]);
    expect(placed[0].lanesAfter[0]).toBe("first");
    expect(placed[0].lanesAfter[1]).toBe("second");
  });

  // History truncated by the row limit leaves a lane waiting for a sha that
  // never arrives. That must be a line running off the bottom, not a crash.
  it("leaves a lane open for a parent the list never reaches", () => {
    const placed = layoutCommits([commit("only", ["missing"])]);
    expect(placed[0].lane).toBe(0);
    expect(placed[0].lanesAfter[0]).toBe("missing");
  });
});

describe("rowSegments", () => {
  it("draws a line in and a line out for a commit mid-history", () => {
    const [, middle] = layoutCommits([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(rowSegments(middle)).toHaveLength(2);
    expect(rowSegments(middle).every((s) => s.stroke === laneColor(0))).toBe(true);
  });

  it("draws no line above a branch tip and none below a root", () => {
    const placed = layoutCommits([commit("tip", ["root"]), commit("root", [])]);
    expect(rowSegments(placed[0])).toHaveLength(1);
    expect(rowSegments(placed[1])).toHaveLength(1);
  });

  /**
   * The regression this file was written for.
   *
   * Every segment used to be stroked with the *row's* lane colour, so a lane
   * merely passing through a row was painted in whatever colour the commit
   * beside it happened to have. One continuous branch therefore changed colour
   * on every row, according to which column its neighbours occupied — a
   * five-branch history drew as horizontal stripes rather than five rails.
   */
  it("gives a pass-through lane its own colour, not the row's", () => {
    // `tipB` sits in lane 1 and is still waiting for `base`, so the row for
    // the commit in lane 0 has lane 1 running straight through it.
    const placed = layoutCommits([
      commit("tipA", ["mid"]),
      commit("tipB", ["base"]),
      commit("mid", ["base"]),
      commit("base", []),
    ]);

    const midRow = placed[2];
    expect(midRow.lane).toBe(0);

    const passing = rowSegments(midRow).filter((s) => s.stroke !== laneColor(midRow.lane));
    expect(passing).toHaveLength(1);
    expect(passing[0].stroke).toBe(laneColor(1));
  });

  // A curve takes the lane of the end that is not the node, so a converging
  // branch keeps its own colour right up to where it joins.
  it("colours a converging fork by the lane it is closing", () => {
    const placed = layoutCommits([
      commit("tipA", ["base"]),
      commit("tipB", ["base"]),
      commit("base", []),
    ]);

    const baseRow = placed[2];
    expect(baseRow.lane).toBe(0);
    expect(rowSegments(baseRow).some((s) => s.stroke === laneColor(1))).toBe(true);
  });

  // And a merge's extra parent takes the lane it opens, so the new rail starts
  // in the colour it will keep all the way down.
  it("colours a merge's new lane by the lane it opens", () => {
    const placed = layoutCommits([commit("merge", ["first", "second"])]);
    const opened = rowSegments(placed[0]).filter((s) => s.stroke === laneColor(1));
    expect(opened).toHaveLength(1);
  });
});
