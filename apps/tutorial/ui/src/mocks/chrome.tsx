/**
 * The primitives every mock is built from, and nothing else.
 *
 * Sixteen mockups get drawn by different passes over this codebase, and the
 * thing that keeps them reading as one product instead of sixteen guesses at
 * one is that none of them may touch a colour, a border or a font directly.
 * They compose these sixteen small components, which compose `mocks.css`,
 * which composes `src/tokens.css`. A mock file that reaches around this layer
 * is a mock that can quietly drift from the interface it is supposed to be a
 * picture of.
 *
 * Every mock is decorative. Nothing here takes a click handler, a `tabIndex`,
 * or any other affordance that would let a reader mistake a picture of a
 * button for a button.
 */
import type { ReactNode } from "react";
import "./mocks.css";

/** Joins class names, dropping falsy ones — the one helper every primitive needs. */
function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "ok" | "warn" | "err" | "accent";
export type Gap = "xs" | "sm" | "md" | "lg";
export type Dir = "left" | "right" | "up" | "down";

const GAP_PX: Record<Gap, number> = { xs: 4, sm: 8, md: 12, lg: 16 };

/** A bordered outer frame — a window, a panel, a titled box. */
export function MockWindow({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("tut__mock-window", className)}>
      {title !== undefined && <div className="tut__mock-window-title">{title}</div>}
      <div className="tut__mock-window-body">{children}</div>
    </div>
  );
}

/** A horizontal strip — the shape a title bar, switcher bar, or status bar draws as. */
export function Band({
  tone = "surface",
  className,
  children,
}: {
  tone?: "surface" | "bg";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("tut__mock-band", `tut__mock-band--${tone}`, className)}>{children}</div>
  );
}

/** A row of children with a gap. `align` and `justify` default to how flexbox already behaves. */
export function Row({
  gap = "sm",
  align,
  justify,
  wrap,
  className,
  children,
}: {
  gap?: Gap;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "between";
  wrap?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx("tut__mock-row", className)}
      style={{
        gap: GAP_PX[gap],
        alignItems: align && FLEX_ALIGN[align],
        justifyContent: justify && FLEX_JUSTIFY[justify],
        flexWrap: wrap ? "wrap" : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** A column of children with a gap — `Row` turned on its side. */
export function Col({
  gap = "sm",
  align,
  className,
  children,
}: {
  gap?: Gap;
  align?: "start" | "center" | "stretch";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx("tut__mock-col", className)}
      style={{ gap: GAP_PX[gap], alignItems: align && FLEX_ALIGN[align] }}
    >
      {children}
    </div>
  );
}

const FLEX_ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const FLEX_JUSTIFY = { start: "flex-start", center: "center", between: "space-between" };

const ARROW_GLYPH: Record<Dir, string> = { left: "←", right: "→", up: "↑", down: "↓" };

/** A standalone arrow glyph, for a `flow` block or anywhere a callout is too much. */
export function Arrow({ dir, className }: { dir: Dir; className?: string }) {
  return (
    <span className={cx("tut__mock-arrow", className)} aria-hidden="true">
      {ARROW_GLYPH[dir]}
    </span>
  );
}

/**
 * A labelled arrow pointing at something — the primitive `window-bands`,
 * `pane-split` and `mcp-toggle` all lean on to name a part of the picture
 * without a line drawn across it.
 *
 * Reading order carries the direction rather than a transform: pointing left
 * or up puts the glyph before the label, right or down puts it after — so
 * "Title bar →" and "← Title bar" both read the way the arrow points.
 */
export function ArrowCallout({
  dir,
  label,
  className,
}: {
  dir: Dir;
  label: string;
  className?: string;
}) {
  const glyph = <Arrow dir={dir} />;
  const text = <span className="tut__mock-callout-label">{label}</span>;
  const vertical = dir === "up" || dir === "down";
  const leading = dir === "left" || dir === "up";

  return (
    <span className={cx("tut__mock-callout", vertical && "tut__mock-callout--vertical", className)}>
      {leading ? glyph : text}
      {leading ? text : glyph}
    </span>
  );
}

/** A small pill, toned like the product tones its status text: the fill never
 *  changes, only the label's colour does — see `GIT_KIND_TOKEN` in `contract.ts`. */
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("tut__mock-chip", `tut__mock-chip--${tone}`)}>{children}</span>;
}

/** A grey rounded bar standing in for a line of text nobody needs spelled out. */
export function SkeletonText({ width = "70%", className }: { width?: string; className?: string }) {
  return (
    <span className={cx("tut__mock-skeleton", className)} style={{ width }} aria-hidden="true" />
  );
}

/** One tab, with a selected state — the shape the switcher bar and every tab strip share. */
export function MockTab({
  label,
  selected,
  className,
}: {
  label: string;
  selected?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("tut__mock-tab", selected && "tut__mock-tab--selected", className)}>
      {label}
    </span>
  );
}

/** One row of a file tree, indented by depth and optionally toned like a git status letter. */
export function MockTreeRow({
  depth,
  label,
  tone,
  selected,
  className,
}: {
  depth: number;
  label: string;
  tone?: Tone;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx("tut__mock-treerow", selected && "tut__mock-treerow--selected", className)}
      style={{ paddingLeft: depth * 14 + 6 }}
    >
      <span className={cx("tut__mock-treerow-label", tone && `tut__mock-treerow-label--${tone}`)}>
        {label}
      </span>
    </div>
  );
}
