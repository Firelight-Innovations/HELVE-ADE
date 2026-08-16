/**
 * The handful of things the shell asks of the window it is drawn in.
 *
 * `@tauri-apps/api` is safe to import in a plain browser — nothing at module
 * scope talks to the runtime. It is only *calling* `getCurrentWindow()` or its
 * methods that needs the Tauri internals to exist, which is why `isTauri` is
 * checked immediately before each one rather than once at load. Same posture as
 * `titlebar/WindowControls.tsx`, which is where this pattern started; that file
 * now imports `isTauri` from here rather than keeping a second copy of it.
 *
 * Every function here is a no-op in a plain browser, and the menu items that
 * reach them are disabled there rather than silently doing nothing — see
 * `ViewMenuHandlers.zoomBlocked`.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Close this window. The same call `WindowControls`' × makes. */
export function closeWindow(): void {
  if (!isTauri()) return;
  void getCurrentWindow().close();
}

/** Whether this window is full screen. `false` when there is no window to ask. */
export async function isFullscreen(): Promise<boolean> {
  if (!isTauri()) return false;
  return getCurrentWindow().isFullscreen();
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (!isTauri()) return;
  return getCurrentWindow().setFullscreen(on);
}

/**
 * The zoom ladder, and why it is a ladder.
 *
 * Browsers step zoom through named stops rather than multiplying by a constant,
 * because a multiplier accumulates rounding and because the stops people
 * recognise — 125%, 150% — are not powers of anything. These are Chromium's own
 * levels, trimmed at both ends to what a desktop tool window stays usable at.
 */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5] as const;

/** The next stop above or below `current`, clamped at the ends of the ladder. */
export function nextZoom(current: number, direction: 1 | -1): number {
  // `indexOf` rather than a search: every value this is ever called with came
  // out of this same array, because nothing else sets the zoom.
  const at = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number]);
  const from = at === -1 ? ZOOM_STEPS.indexOf(1) : at;
  const to = Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction));
  return ZOOM_STEPS[to];
}

/**
 * Scale the whole webview.
 *
 * The whole one, deliberately: the title bar, the switcher, the panel and every
 * app iframe scale together, because they are one interface and zooming only
 * the document a file happens to be in would leave the chrome around it the
 * wrong size. An editor-only zoom is a different feature and belongs to the
 * editor.
 */
export async function setZoom(factor: number): Promise<void> {
  if (!isTauri()) return;
  return getCurrentWebview().setZoom(factor);
}
