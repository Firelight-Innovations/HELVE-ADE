/**
 * Which slice of a fixed-height row list is worth putting in the DOM.
 *
 * The whole of the windowing, and the row height everything else measures
 * against. `node_modules` expanded is 30,000 rows; at ~40 in the DOM the tree
 * costs the same there as it does in an empty folder, and it does so without a
 * virtualization dependency — because every row is exactly `ROW_HEIGHT` tall,
 * the visible range is arithmetic rather than measurement, which is precisely
 * the case where hand-rolling this is both short and reliable.
 *
 * What it deliberately does not do: know what a row *is*. It is handed a count
 * and returns indices. Flattening the tree, filtering it, and deciding which
 * row the keyboard is on all live in `useTree.ts` and `Explorer.tsx`, so this
 * file has no opinion that could disagree with theirs.
 *
 * It also does not scroll anything on its own. `scrollRowIntoView` below is a
 * plain function the caller invokes from a key handler — a hook that moved the
 * scrollport as a side effect of rendering would fight the user's own wheel.
 */
import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The one place the row height is written down.
 *
 * `Explorer` publishes it to CSS as `--explorer-row` on the tree's own element,
 * so `explorer.css` sizes rows from this number rather than repeating it. A
 * second literal in the stylesheet is not a duplicate that would be caught —
 * the two would simply disagree, and the tree would scroll to the wrong place
 * with everything still compiling.
 */
export const ROW_HEIGHT = 22;

/** Rows kept mounted beyond each edge, so a fast wheel doesn't show blank. */
const OVERSCAN = 8;

export interface RowWindow {
  /** First index to render. */
  start: number;
  /** One past the last index to render. */
  end: number;
  /** Height of the spacer standing in for rows before `start`. */
  padTop: number;
  /** Height of the spacer standing in for rows after `end`. */
  padBottom: number;
}

export function useVirtualRows(
  scrollRef: RefObject<HTMLElement | null>,
  rowCount: number,
): RowWindow {
  const [port, setPort] = useState({ top: 0, height: 0 });

  // Layout effect rather than effect: the first measurement has to land before
  // the first paint, or the tree flashes with only the overscan rows drawn
  // against a zero-height scrollport.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const read = () =>
      setPort((prev) =>
        prev.top === el.scrollTop && prev.height === el.clientHeight
          ? prev // Same numbers, same object — no render.
          : { top: el.scrollTop, height: el.clientHeight },
      );

    read();
    el.addEventListener("scroll", read, { passive: true });
    // The pane is resizable, so the scrollport's height is not a constant.
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [scrollRef]);

  // Clamped against `rowCount` because the list can shrink under a scrollport
  // that is still scrolled past its new end — applying a filter does exactly
  // that. The browser corrects `scrollTop` and this recomputes a frame later;
  // until then, an unclamped `start` would index past the array.
  const start = Math.max(0, Math.min(Math.floor(port.top / ROW_HEIGHT) - OVERSCAN, rowCount));
  const end = Math.min(rowCount, start + Math.ceil(port.height / ROW_HEIGHT) + OVERSCAN * 2 + 1);

  return {
    start,
    end,
    padTop: start * ROW_HEIGHT,
    padBottom: (rowCount - end) * ROW_HEIGHT,
  };
}

/**
 * Bring one row fully inside the scrollport, moving as little as possible.
 *
 * Nothing smooth: this runs from the arrow keys, and a held-down arrow that
 * animates each step lags behind the selection it is supposed to be following.
 */
export function scrollRowIntoView(el: HTMLElement | null, index: number): void {
  if (!el) return;
  const top = index * ROW_HEIGHT;
  const bottom = top + ROW_HEIGHT;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
}
