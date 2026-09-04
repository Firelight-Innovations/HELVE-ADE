/**
 * How short either half of `WorktreePanel` may get, in pixels.
 *
 * Both halves clip rather than scroll or squeeze, so a half shorter than its
 * own chrome loses its last child — the commit box, and with it
 * `.worktree__error`, the only surface a failed git operation is reported on.
 * `clipFloorPx` is the guarantee and goes to the section's `min-height`;
 * `dragFloorPx` is the comfort and bounds the divider gesture. The full
 * account: `docs/design-notes/shell-worktree.md`.
 */

/** Which of the three things a section is drawing. The graph is always the
 *  top; the bottom is one of the other two. */
export type PanelSection = "graph" | "source-control" | "divergence";

/** The chrome, mirroring `worktree.css` and commented at both ends like
 *  `DIVIDER_PX`: the branch row, the commit box without its error line, one
 *  line of that error plus the gap above it, the least `.worktree__lists` can
 *  be while still being a list, then the `MIN_SECTION_PX` these replace. */
const BRANCH_ROW_PX = 34;
const COMMIT_BOX_PX = 103;
const ERROR_LINE_PX = 35;
const LIST_MIN_PX = 61;
const READABLE_MIN_PX = 120;

/** The height below which a section loses a child it cannot afford to lose.
 *  Only the source-control view has one: `DivergenceView` reports its error
 *  inside the diff pane, which is the child that gives way. */
export function clipFloorPx(section: PanelSection): number {
  if (section !== "source-control") return 0;
  return BRANCH_ROW_PX + COMMIT_BOX_PX + ERROR_LINE_PX;
}

/** The smallest the divider will leave a section: everything `clipFloorPx`
 *  guarantees, plus enough list for the panel to still read as one. */
export function dragFloorPx(section: PanelSection): number {
  if (section !== "source-control") return READABLE_MIN_PX;
  return Math.max(READABLE_MIN_PX, clipFloorPx(section) + LIST_MIN_PX);
}

export interface DividerBounds {
  /** Smallest top-section ratio the divider may be dragged to. */
  min: number;
  /** Largest. Never below `min` — see the degenerate case below. */
  max: number;
}

/**
 * The range the divider may move in, for a panel `totalPx` tall.
 *
 * A panel too short for both floors has no range, and the arithmetic produces
 * `max < min`; a clamp reading those pins every drag to `max`, leaving the top
 * whatever is left, which can be nothing. Collapsing the range to one point
 * splits the shortfall instead — never so far that the bottom drops below what
 * it cannot clip.
 */
export function dividerBounds(totalPx: number, bottom: PanelSection): DividerBounds {
  if (totalPx <= 0) return { min: 0, max: 0 };

  const top = dragFloorPx("graph");
  const floor = dragFloorPx(bottom);
  if (top + floor >= totalPx) {
    const proportional = (totalPx * top) / (top + floor);
    const capped = Math.min(proportional, Math.max(0, totalPx - clipFloorPx(bottom)));
    const share = capped / totalPx;
    return { min: share, max: share };
  }

  return { min: top / totalPx, max: 1 - floor / totalPx };
}

/** One divider position, held inside `dividerBounds`. */
export function clampTopRatio(ratio: number, totalPx: number, bottom: PanelSection): number {
  const { min, max } = dividerBounds(totalPx, bottom);
  return Math.min(Math.max(ratio, min), max);
}
