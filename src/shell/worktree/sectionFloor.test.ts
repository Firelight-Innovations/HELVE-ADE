/**
 * The invariant the source control panel was missing: however the divider is
 * dragged, the bottom section keeps enough height to draw the surface a git
 * failure is reported on.
 *
 * The runner is `node` with no DOM (STANDARDS.md §8.3), so none of this can
 * drag a divider or measure a box. It holds the arithmetic underneath both
 * instead — the numbers that reach `flex-basis` and `min-height` — which is
 * where the bug was: a floor of 120px against roughly 360px of children that
 * do not shrink, inside a section that clips.
 */
import { describe, expect, it } from "vitest";
import { clampTopRatio, clipFloorPx, dividerBounds, dragFloorPx } from "./sectionFloor";

/** Panel heights to sweep: a strip, the short end of ordinary, ordinary, and
 *  a tall window. 40px is well below any floor and is here to pin the
 *  degenerate case rather than to describe a panel anyone uses. */
const HEIGHTS = [40, 120, 200, 240, 320, 480, 640, 900, 1400];

/** Ratios a drag can ask for, including the two it cannot reach. */
const RATIOS = [-0.5, 0, 0.05, 0.25, 0.45, 0.5, 0.75, 0.95, 1, 1.5];

/** These are ratios multiplied back out by the height they were divided by, so
 *  a floor of exactly 120 lands on 119.999999999999986 at some heights. The
 *  slack is for that and nothing else — a real shortfall is whole pixels. */
const EPSILON = 1e-9;

describe("clipFloorPx", () => {
  // The regression itself. The old single floor was 120, which is less than
  // the branch row and the commit box alone — so the error line inside that
  // box had nowhere to be, and a failed commit reported nothing.
  it("covers more than the 120px floor it replaces", () => {
    expect(clipFloorPx("source-control")).toBeGreaterThan(120);
  });

  it("asks nothing of the sections that cannot clip a surface away", () => {
    expect(clipFloorPx("graph")).toBe(0);
    expect(clipFloorPx("divergence")).toBe(0);
  });
});

describe("dragFloorPx", () => {
  it("never lets the divider go below what min-height guarantees", () => {
    for (const section of ["graph", "source-control", "divergence"] as const) {
      expect(dragFloorPx(section)).toBeGreaterThanOrEqual(clipFloorPx(section));
    }
  });

  // The divergence view has no commit box, so nothing about this change is
  // allowed to move its floor: it keeps the 120px every section had.
  it("leaves the graph and the divergence view where they were", () => {
    expect(dragFloorPx("graph")).toBe(120);
    expect(dragFloorPx("divergence")).toBe(120);
  });
});

describe("dividerBounds", () => {
  it("never returns a range the wrong way round", () => {
    for (const total of HEIGHTS) {
      for (const bottom of ["source-control", "divergence"] as const) {
        const { min, max } = dividerBounds(total, bottom);
        expect(max).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("stays inside the panel", () => {
    for (const total of HEIGHTS) {
      const { min, max } = dividerBounds(total, "source-control");
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
    }
  });

  // A panel of zero height is what a section measures at while the window is
  // being restored; dividing by it must not produce a NaN that then reaches
  // `flex-basis` as the string "calc(NaN% - 0.5px)".
  it("answers for a panel with no height at all", () => {
    const { min, max } = dividerBounds(0, "source-control");
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
  });
});

describe("clampTopRatio", () => {
  // The whole point of the module, stated as the property the bug violated.
  it("leaves the error line room at every height and every drag", () => {
    for (const total of HEIGHTS) {
      for (const ratio of RATIOS) {
        const bottom = total * (1 - clampTopRatio(ratio, total, "source-control"));
        // Only where the panel can afford it — a 40px panel cannot, and no
        // arithmetic here can conjure the pixels.
        if (total >= clipFloorPx("source-control")) {
          expect(bottom).toBeGreaterThanOrEqual(clipFloorPx("source-control") - EPSILON);
        }
      }
    }
  });

  it("gives the graph its floor whenever both floors fit", () => {
    const floors = dragFloorPx("graph") + dragFloorPx("source-control");
    for (const total of HEIGHTS.filter((h) => h > floors)) {
      for (const ratio of RATIOS) {
        const top = total * clampTopRatio(ratio, total, "source-control");
        expect(top).toBeGreaterThanOrEqual(dragFloorPx("graph") - EPSILON);
      }
    }
  });

  it("leaves an in-range ratio alone", () => {
    expect(clampTopRatio(0.45, 900, "source-control")).toBe(0.45);
    expect(clampTopRatio(0.45, 900, "divergence")).toBe(0.45);
  });

  // Not a rounding difference: 45% of a 480px panel leaves the bottom 264px,
  // which fits the source-control floor and not by much, and 45% of 400px does
  // not fit it at all. The default ratio is the one position nothing clamps at
  // render time, so it is the one the `min-height` has to catch.
  it("pulls the default ratio up on a panel too short to honour it", () => {
    expect(clampTopRatio(0.45, 400, "source-control")).toBeLessThan(0.45);
    expect(clampTopRatio(0.45, 480, "source-control")).toBe(0.45);
  });
});
