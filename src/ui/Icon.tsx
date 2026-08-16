/**
 * Every glyph in the shell.
 *
 * The paths are copied out of `docs/handoffs/shell-spec.html` rather than
 * pulled from an icon package. The handoff draws its icons at specific stroke
 * weights inside specific viewBoxes, and those drawings *are* the spec — a
 * package's version of "search" would be a different shape at a different
 * weight, which is the one thing this pass is not allowed to introduce. Where a
 * glyph the shell needs later isn't drawn in the handoff, take it from Tabler
 * outline at 1.5–2px and add it here.
 *
 * Every icon strokes `currentColor`, so colour comes from the CSS token on the
 * parent. No icon hardcodes a hex.
 */

interface IconProps {
  size?: number;
  className?: string;
}

/**
 * The 24×24 outline base. `strokeWidth` defaults to 2 because that is what the
 * handoff uses for nearly everything at bar scale; the two exceptions pass
 * their own.
 */
function Outline({
  size = 24,
  strokeWidth = 2,
  className,
  children,
  linejoin,
}: IconProps & {
  strokeWidth?: number;
  children: React.ReactNode;
  linejoin?: "round";
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin={linejoin}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/**
 * The HELVE mark: a capital H whose crossbar cants and tapers, reading as
 * the grip of a hafted tool. Filled, not stroked — the path comes straight
 * out of `assets/helve-mark.svg` in the brand packet, which draws it as one
 * continuous 14-point outline so there are no subpath seams to hairline at
 * small sizes. Also serves — at a larger size — as the placeholder every
 * tool shares, per the handoff's note that tool icons are placeholders
 * until each tool earns its own.
 */
export function BrandGlyph({ size = 15, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M6 3h2.5v9l7-3V3H20v16l-2 2h-2.5v-7l-7 2v5H4V5z" />
    </svg>
  );
}

export function WarningTriangle({ size = 12, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
    </Outline>
  );
}

export function Search({ size = 14, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </Outline>
  );
}

export function Plus({ size = 13, className }: IconProps) {
  return (
    <Outline size={size} className={className}>
      <path d="M12 5v14M5 12h14" />
    </Outline>
  );
}

/** Marks the worktree tab, and heads the branch row inside it. */
export function GitBranch({
  size = 13,
  strokeWidth = 2,
  className,
}: IconProps & { strokeWidth?: number }) {
  return (
    <Outline size={size} strokeWidth={strokeWidth} className={className}>
      <circle cx="7" cy="6" r="2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="9" r="2" />
      <path d="M7 8v8M17 11v1a3 3 0 0 1-3 3H8" />
    </Outline>
  );
}

/** Collapses the secondary panel. */
export function ChevronRight({ size = 13, className }: IconProps) {
  return (
    <Outline size={size} className={className} linejoin="round">
      <path d="M9 6l6 6-6 6" />
    </Outline>
  );
}

/** Restores it from the collapsed strip. */
export function ChevronLeft({ size = 13, className }: IconProps) {
  return (
    <Outline size={size} className={className} linejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </Outline>
  );
}

/**
 * Closes a terminal tab. Sits in the same slot as the agent-finished dot and
 * replaces it on hover/keyboard focus rather than appearing beside it, so it
 * is drawn small and centred like the dot it stands in for.
 */
export function Close({ size = 9, className }: IconProps) {
  return (
    <Outline size={size} strokeWidth={2} className={className}>
      <path d="M5 5l14 14M19 5L5 19" />
    </Outline>
  );
}

/**
 * Settings, at the trailing edge of the status bar — sliders, not a cog. The
 * knob circles are filled with the surface behind them so the rules appear to
 * pass under rather than through, which means the fill has to be told what it
 * is sitting on.
 */
export function Sliders({
  size = 14,
  knobFill = "var(--surface)",
  className,
}: IconProps & { knobFill?: string }) {
  return (
    <Outline size={size} className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2.2" fill={knobFill} />
      <circle cx="15" cy="12" r="2.2" fill={knobFill} />
      <circle cx="8" cy="18" r="2.2" fill={knobFill} />
    </Outline>
  );
}

/** The checked box in the search type filter. Heavier stroke, small viewport. */
export function Check({ size = 9, className }: IconProps) {
  return (
    <Outline size={size} strokeWidth={3.5} className={className} linejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Outline>
  );
}

/**
 * The boot spinner: a full circle in the line colour with a quarter arc in the
 * accent laid over it. Only the arc rotates, so this returns both and the
 * caller animates the group.
 */
export function BootArc({ size = 28, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="var(--line)" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--accent)" />
    </svg>
  );
}

/* --- window controls -------------------------------------------------------
   Drawn in a 10×10 box at 1.2px, not the 24×24 outline set. They are OS
   furniture rather than application iconography, and the handoff draws them
   noticeably lighter than everything else in the title bar. */

function Control({ size = 10, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function WindowMinimise(props: IconProps) {
  return (
    <Control {...props}>
      <path d="M1 5h8" />
    </Control>
  );
}

export function WindowMaximise(props: IconProps) {
  return (
    <Control {...props}>
      <rect x="1.6" y="1.6" width="6.8" height="6.8" />
    </Control>
  );
}

export function WindowClose(props: IconProps) {
  return (
    <Control {...props}>
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
    </Control>
  );
}
