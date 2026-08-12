/**
 * The one glyph the handoff does not draw.
 *
 * Everything else in the title bar is lifted straight out of
 * `docs/handoffs/shell-spec.html` — this one has no crop to copy, because the
 * responsive collapse is a written rule ("collapse the eight menu items into a
 * single hamburger button"), not a drawn state. Built to match the rest of the
 * icon set instead: a 24×24 outline box, `currentColor` stroke, weight inside
 * the handoff's stated 1.5–2px range (see `ICONS` on the spec's cover section).
 */
export default function Hamburger({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
