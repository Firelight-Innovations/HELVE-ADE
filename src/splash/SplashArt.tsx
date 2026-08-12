/**
 * The splash window's art slot.
 *
 * SWAP POINT: this is where art from a real design/animation library goes
 * once one is chosen. To keep that swap a one-file change:
 *   - No props. `Splash.tsx` renders `<SplashArt />` with nothing passed in,
 *     so a replacement only has to keep that same no-argument shape.
 *   - No external dependencies right now. Whatever eventually replaces this
 *     must be added as a real `package.json` dependency (`pnpm add ...`),
 *     never a CDN `<script>` tag — the app has no network access at runtime,
 *     and a splash screen silently failing to load its own art because a
 *     request timed out would be a uniquely bad first impression.
 *
 * Until then: a hand-rolled, animated SVG anvil-and-spark mark in the
 * product's accent colour. The pulse animation lives in splash.css, under
 * `.splash-art__spark`, so it can be retuned without touching this file.
 */
export default function SplashArt() {
  return (
    <svg
      className="splash-art"
      viewBox="0 0 120 120"
      width="96"
      height="96"
      role="img"
      aria-label="Helve"
    >
      <g fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        {/* Anvil base and horn */}
        <path d="M24 82 H88 M32 82 V92 H44 V82 M80 82 V92 H68 V82" />
        <path d="M34 82 V66 Q34 58 42 58 H92 Q98 58 98 64 V70" />
        {/* Falling hammer, mid-strike */}
        <path d="M50 46 V32" />
        <path d="M42 32 H58 L54 22 H46 Z" />
      </g>
      {/* The strike spark — animated in splash.css */}
      <circle className="splash-art__spark" cx="50" cy="56" r="5" fill="var(--accent)" />
    </svg>
  );
}
