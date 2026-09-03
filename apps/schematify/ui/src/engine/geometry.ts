/**
 * Rectangle and segment maths in world units. Pure, allocation-light, and the
 * hot path of every frame: `routing.ts` asks `segmentHitsRect` once per
 * candidate segment per obstacle, and `frame.ts` asks `rectsOverlap` once per
 * node to cull.
 *
 * World units are pixels at zoom 1. The viewport (`viewport.ts`) is the only
 * module that knows about screen coordinates.
 */

/** A point in world units. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned box in world units, `x`/`y` at its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The empty box a fold over zero rects starts from. Never drawn. */
export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function right(rect: Rect): number {
  return rect.x + rect.width;
}

export function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** True when the two boxes share any area. Touching edges do not overlap —
 *  a node parked exactly against another is not inside it. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
}

/** True when `inner` sits wholly within `outer`, edges included. Containment
 *  nesting and box-select both ask this. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  );
}

export function pointInRect(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x <= right(rect) && point.y >= rect.y && point.y <= bottom(rect)
  );
}

/** The smallest box holding both. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(right(a), right(b)) - x,
    height: Math.max(bottom(a), bottom(b)) - y,
  };
}

/** The smallest box holding all of them, or `null` for an empty list — `null`
 *  rather than `EMPTY_RECT` so a caller cannot mistake "nothing" for "a
 *  zero-sized thing at the origin". */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return rects.reduce(unionRect);
}

/** Grows a box by `margin` on every side. Negative shrinks. */
export function inflate(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

/** The box two corners describe, whichever way the drag went. Box-select
 *  hands this whatever the pointer did. */
export function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Rounds to the nearest grid intersection. A drag snaps its top-left corner,
 *  so a snapped node's own size is unchanged. */
export function snap(value: number, grid: number): number {
  return grid <= 0 ? value : Math.round(value / grid) * grid;
}

export function snapPoint(point: Point, grid: number): Point {
  return { x: snap(point.x, grid), y: snap(point.y, grid) };
}

/**
 * True when an axis-aligned segment passes through a box's interior. Both
 * routing constraints in PRD §12.3 are this predicate: an edge may cross a
 * group border, and may never enter a sibling box, so the router asks this of
 * every sibling box and of nothing else.
 *
 * A segment that merely grazes an edge does not enter — the comparisons are
 * strict, so a route hugging a box's side is legal.
 */
export function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const loX = Math.min(a.x, b.x);
  const hiX = Math.max(a.x, b.x);
  const loY = Math.min(a.y, b.y);
  const hiY = Math.max(a.y, b.y);
  return loX < right(rect) && hiX > rect.x && loY < bottom(rect) && hiY > rect.y;
}

/** True when any segment of the polyline enters the box. */
export function polylineHitsRect(points: readonly Point[], rect: Rect): boolean {
  for (let i = 1; i < points.length; i += 1) {
    if (segmentHitsRect(points[i - 1], points[i], rect)) return true;
  }
  return false;
}

/** Total length of a polyline, the tiebreak between two legal routes. */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return total;
}
