/**
 * Home's glyphs.
 *
 * App-local rather than imported from the shell's `src/ui/Icon.tsx`, and that is
 * the same rule the types in `App.tsx` follow: an app reaches its host through
 * `@helve-ade/bridge` and nothing else. Reaching into the shell's source for a
 * component would make this pane a piece of the shell that happens to live in a
 * folder, and the point of `apps/` is that it isn't.
 *
 * Drawn to the shell's convention all the same — 24×24, 2px stroke, Tabler
 * outline, `currentColor` — because looking like a different product would be a
 * worse outcome than a little duplication. Colour comes from the CSS token on
 * the parent; no icon here hardcodes a hex.
 */

import { MARK_PATH, MARK_VIEW_BOX } from "./branding.generated";

interface IconProps {
  size?: number;
  className?: string;
}

function Outline({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/**
 * The product's mark, for the lockup at the top of the page.
 *
 * The one glyph here that is not an outline: it is the identity, not an icon,
 * and the brand packet draws it filled as a single continuous path so there are
 * no subpath seams to hairline at small sizes.
 *
 * The geometry comes from this directory's own `branding.generated.ts`, not the
 * shell's — the rule at the top of this file, applied to the identity as well
 * as to the icons. `scripts/generate-branding.mjs` emits one module per bundle
 * for that reason, and a generated file inside the app's own tree is the only
 * form that survives this directory becoming its own repository.
 *
 * `size` is the mark's *height* in the packet's sense: the lockup's other
 * measurements are ratios of the 24×24 box, not of the 18-unit ink inside it.
 * The packet sets 16px as the floor for the bare mark; below that it wants the
 * container icon, which Home has no use for.
 */
export function Mark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEW_BOX}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={MARK_PATH} />
    </svg>
  );
}

/** New Project — a folder with a plus. */
export function FolderPlus(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </Outline>
  );
}

/** Open Project. */
export function FolderOpen(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2" />
    </Outline>
  );
}

/** Clone Project — a git branch. */
export function GitBranch(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M7 8v8" />
      <path d="M9 18h6a2 2 0 0 0 2 -2v-5" />
    </Outline>
  );
}

/** Install App. A box with a plus, which reads as "add one of these" the way
 *  `FolderPlus` does — a package rather than a folder, because that is the one
 *  thing distinguishing this action from the project rows beside it. */
export function PackagePlus(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 21.5l-8 -4.5v-9l8 -4.5l8 4.5v4.5" />
      <path d="M12 12l8 -4.5" />
      <path d="M12 12v9.5" />
      <path d="M12 12l-8 -4.5" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </Outline>
  );
}

/** A tutorial card's mark. */
export function Book(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
      <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
      <path d="M3 6l0 13" />
      <path d="M12 6l0 13" />
      <path d="M21 6l0 13" />
    </Outline>
  );
}

/** Drop a project from the Recent list. */
export function Close(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </Outline>
  );
}
