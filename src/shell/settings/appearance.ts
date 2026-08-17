/**
 * The three appearance settings, applied to the live document.
 *
 * A layer *over* `src/tokens.css`, never an edit to it. That file is the decoded
 * handoff and says nothing in it is a choice; a user's accent is a choice. These
 * write the same custom properties onto `document.documentElement`, where an
 * inline style beats the `:root` rule underneath by ordinary cascade — so the
 * spec's values stay in the file as what the interface falls back to.
 */
import { useEffect } from "react";
import type { SettingsSession } from "./useSettings";

const ACCENT_KEY = "appearance.accentColor";
const SANS_KEY = "appearance.interfaceFontFamily";
const MONO_KEY = "appearance.monoFontFamily";

/**
 * What stays behind whatever the user names. Mirrors `tokens.css`.
 *
 * Behind, not instead of: a font this machine lacks has to degrade rather than
 * break, and the field says "interface font", not "interface font stack".
 */
const SANS_FALLBACK = `system-ui, -apple-system, "Segoe UI", sans-serif`;
const MONO_FALLBACK = `ui-monospace, "Cascadia Mono", Consolas, monospace`;

/**
 * The alphas `tokens.css` draws each accent relative at.
 *
 * Derived rather than picked, because `--accent` has five relatives and five
 * colours would mean thirty hand-chosen values that all have to stay in the same
 * relationship — or drop targets stop matching focus rings. One decision, one
 * stored hex. `color-mix()` would do this in CSS and is not used: it would put
 * the same five relationships in a second language.
 */
const WASHES: Array<[property: string, alpha: number]> = [
  ["--accent-line", 0.45],
  ["--accent-line-strong", 0.7],
  ["--accent-wash", 0.08],
  ["--accent-wash-faint", 0.05],
];
/** A ratio, not an alpha: `--accent-dim` is opaque in the spec, because it is a
 *  hint drawn inside a filled accent button. 0.64 reproduces `#8a6431`. */
const DIM_RATIO = 0.64;

/**
 * Keep the document in step with the appearance settings.
 *
 * Called once, from `App.tsx`, above the window — not from the settings screen.
 * The screen is where these are *changed*, but a window whose settings screen
 * has never been opened still has to be drawn in the accent the person chose.
 */
export function useAppearance(session: SettingsSession): void {
  useEffect(() => {
    if (!session.ready) return;
    const root = document.documentElement;
    const settings = session.groups.flatMap((group) => group.settings);
    const read = (key: string): string | null => {
      const setting = settings.find((s) => s.key === key);
      if (setting === undefined) return null;
      const value = session.valueOf(setting);
      return typeof value === "string" ? value : null;
    };

    const accent = read(ACCENT_KEY);
    if (accent !== null) {
      root.style.setProperty("--accent", accent);
      for (const [property, alpha] of WASHES) {
        root.style.setProperty(property, rgba(accent, alpha));
      }
      root.style.setProperty("--accent-dim", darken(accent, DIM_RATIO));
    }

    const sans = read(SANS_KEY);
    if (sans !== null) root.style.setProperty("--sans", `"${sans}", ${SANS_FALLBACK}`);

    const mono = read(MONO_KEY);
    if (mono !== null) root.style.setProperty("--mono", `"${mono}", ${MONO_FALLBACK}`);
  }, [session]);
}

/** `#d98a3f` and 0.45 to `rgba(217, 138, 63, 0.45)`. */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The same hue at `ratio` of its brightness, still opaque. */
function darken(hex: string, ratio: number): string {
  const [r, g, b] = channels(hex).map((c) => Math.round(c * ratio));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The three channels of a `#rrggbb`.
 *
 * Falls back to the spec's own accent for anything that is not one. The value
 * can only come from a `select` whose options Rust validates against, so this
 * is unreachable — but a colour parser that returned `NaN` would paint the
 * whole interface transparent, and that is a bad way to find out.
 */
function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (match === null) return [217, 138, 63];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}
