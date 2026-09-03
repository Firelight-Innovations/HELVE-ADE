/**
 * Orthogonal edge routing (PRD §12.3: "Schematify shall route an edge
 * orthogonally. An edge crosses a group border. An edge never enters a sibling
 * box.").
 *
 * Both constraints are one predicate — does a segment enter this box —
 * applied to a list the caller chooses. `frame.ts` builds that list, and
 * deliberately leaves containers out of it: a group's border is crossable, a
 * peer's box is not. This module never decides what an obstacle is.
 *
 * The routes are enumerated rather than searched. A canvas of this density
 * gets a better picture from a handful of familiar shapes — straight across,
 * split at the midpoint, around above, around below — than from a grid search
 * that produces a different staircase every time a node moves 4 pixels.
 * PRD open item 19.8 still owns the bundling rule above 40 edges.
 */
import type { Point, Rect } from "./geometry";
import { bottom, polylineHitsRect, polylineLength, right } from "./geometry";

/** How far a route stands off a box before it turns. */
export const CLEARANCE = 16;

/** A finished route. `clean` is false when no candidate avoided every
 *  obstacle, in which case the shortest is drawn anyway — an edge that is
 *  drawn awkwardly is better than an edge that vanishes, and the Problems
 *  panel is where a real complaint belongs. */
export interface Route {
  points: readonly Point[];
  clean: boolean;
}

/** The out port: right edge, vertically centred (PRD §12.6). */
export function outPort(rect: Rect): Point {
  return { x: right(rect), y: rect.y + rect.height / 2 };
}

/** The in port: left edge, vertically centred (PRD §12.6). */
export function inPort(rect: Rect): Point {
  return { x: rect.x, y: rect.y + rect.height / 2 };
}

/**
 * Routes one edge from a source box's out port to a target box's in port. The
 * first candidate that enters no obstacle wins; ties break on bend count, then
 * on length, so a route stays stable while unrelated nodes move.
 */
export function routeEdge(from: Rect, to: Rect, obstacles: readonly Rect[]): Route {
  const candidates = buildCandidates(from, to);
  let fallback: readonly Point[] = candidates[0];
  let fallbackScore = Number.POSITIVE_INFINITY;
  let best: readonly Point[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const points of candidates) {
    const score = points.length * 1000 + polylineLength(points);
    if (score < fallbackScore) {
      fallbackScore = score;
      fallback = points;
    }
    if (obstacles.some((rect) => polylineHitsRect(points, rect))) continue;
    if (score < bestScore) {
      bestScore = score;
      best = points;
    }
  }

  return best ? { points: best, clean: true } : { points: fallback, clean: false };
}

/** The 5 shapes, in the order they are preferred when scores tie. */
function buildCandidates(from: Rect, to: Rect): Point[][] {
  const start = outPort(from);
  const end = inPort(to);
  const out: Point[][] = [];

  if (Math.abs(start.y - end.y) < 0.5 && end.x > start.x) {
    out.push([start, end]);
  }

  if (end.x > start.x + CLEARANCE * 2) {
    const midX = (start.x + end.x) / 2;
    out.push([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
  }

  const above = Math.min(from.y, to.y) - CLEARANCE;
  const below = Math.max(bottom(from), bottom(to)) + CLEARANCE;
  for (const channelY of [above, below]) {
    out.push([
      start,
      { x: start.x + CLEARANCE, y: start.y },
      { x: start.x + CLEARANCE, y: channelY },
      { x: end.x - CLEARANCE, y: channelY },
      { x: end.x - CLEARANCE, y: end.y },
      end,
    ]);
  }

  // The last resort: leave the source, drop to the target's row, arrive. Never
  // pretty when the target sits behind the source, always orthogonal.
  out.push([
    start,
    { x: start.x + CLEARANCE, y: start.y },
    { x: start.x + CLEARANCE, y: end.y },
    end,
  ]);

  return out;
}

/** True when every segment of a route is horizontal or vertical. The routing
 *  test asserts this of every edge in the fixture rather than trusting the
 *  shapes above to stay orthogonal as they are edited. */
export function isOrthogonal(points: readonly Point[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dy = Math.abs(points[i].y - points[i - 1].y);
    if (dx > 0.001 && dy > 0.001) return false;
  }
  return true;
}
