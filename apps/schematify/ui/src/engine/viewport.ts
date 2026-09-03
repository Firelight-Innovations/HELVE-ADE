/**
 * Pan and zoom. The viewport is the only place screen coordinates and world
 * coordinates meet: everything else in the engine works in world units, so a
 * zoom change never touches the document.
 *
 * `x` and `y` are the world point drawn at the Schematic's top-left corner.
 * `zoom` is screen pixels per world unit — the number the readout draws as a
 * percentage (PRD §12.1).
 */
import type { Point, Rect } from "./geometry";
import type { ZoomConfig } from "./config";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Where a Schematic opens before any layout file says otherwise. */
export function initialViewport(zoom: ZoomConfig): Viewport {
  return { x: 0, y: 0, zoom: zoom.initial };
}

export function toScreen(viewport: Viewport, point: Point): Point {
  return { x: (point.x - viewport.x) * viewport.zoom, y: (point.y - viewport.y) * viewport.zoom };
}

export function toWorld(viewport: Viewport, point: Point): Point {
  return { x: point.x / viewport.zoom + viewport.x, y: point.y / viewport.zoom + viewport.y };
}

/** Pans by a screen-space delta, which is what a pointer reports. */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return {
    ...viewport,
    x: viewport.x - dxScreen / viewport.zoom,
    y: viewport.y - dyScreen / viewport.zoom,
  };
}

export function clampZoom(zoom: number, limits: ZoomConfig): number {
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

/**
 * Zooms about a fixed screen point, so the world point under the cursor stays
 * under the cursor. A wheel zoom that drifts is the single most disorienting
 * thing a canvas can do, which is the same concern PRD §12.3 raises about
 * cutting rather than animating.
 */
export function zoomAt(
  viewport: Viewport,
  factor: number,
  anchorScreen: Point,
  limits: ZoomConfig,
): Viewport {
  const zoom = clampZoom(viewport.zoom * factor, limits);
  const before = toWorld(viewport, anchorScreen);
  const after = toWorld({ ...viewport, zoom }, anchorScreen);
  return { x: viewport.x + (before.x - after.x), y: viewport.y + (before.y - after.y), zoom };
}

/** The size of the Schematic's drawn area, in screen pixels. */
export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * The viewport that fits `bounds` inside `size` with a margin — `Fit`, and the
 * end state of zoom-to-fit and zoom-to-choice (PRD §12.3). Returns the current
 * viewport unchanged when there is nothing to fit, rather than snapping to an
 * arbitrary corner.
 */
export function fitTo(
  viewport: Viewport,
  bounds: Rect | null,
  size: ViewportSize,
  limits: ZoomConfig,
  margin = 40,
): Viewport {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return viewport;
  if (size.width <= 0 || size.height <= 0) return viewport;
  const scale = Math.min(
    (size.width - margin * 2) / bounds.width,
    (size.height - margin * 2) / bounds.height,
  );
  const zoom = clampZoom(scale, limits);
  return {
    zoom,
    x: bounds.x + bounds.width / 2 - size.width / 2 / zoom,
    y: bounds.y + bounds.height / 2 - size.height / 2 / zoom,
  };
}

/** The world rectangle currently on screen. Culling and the minimap both read
 *  it. */
export function visibleWorldRect(viewport: Viewport, size: ViewportSize): Rect {
  return {
    x: viewport.x,
    y: viewport.y,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  };
}

/** The zoom readout, in the forms PRD §12.1 draws: `68%` and `100%`. */
export function zoomReadout(viewport: Viewport): string {
  return `${Math.round(viewport.zoom * 100)}%`;
}
