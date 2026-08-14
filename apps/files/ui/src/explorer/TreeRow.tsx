/**
 * One line of the tree: indent, chevron, icon, name.
 *
 * A plain `<div>`, and deliberately so. `src/shell/worktree/WorktreeView.tsx`
 * states the rule this list inherits — a long list stays at native scroll
 * speed, which means no `motion.*`, no `layout`, no `AnimatePresence` and no
 * transition on anything a row draws. There are 22 pixels and up to 30,000 of
 * them; the cheapest possible element is the correct one.
 *
 * Not a `<button>` either, and not focusable. `Explorer` holds one tab stop for
 * the whole tree and points `aria-activedescendant` at the current row, which
 * is the ARIA pattern for a tree and the only one that does not turn a large
 * folder into thousands of tab stops. So this carries `role="treeitem"` and
 * lets its container own the keyboard.
 *
 * What it deliberately does not do: decide anything. Whether the row is open,
 * how deep it sits, and whether it is the cursor are all told to it. It has no
 * state and reads nothing beyond its props, so a row rendering wrong is always
 * a question about `useTree.ts`.
 */
import type { Row } from "./useTree";
import { fileIconUrl, folderIconUrl } from "../icons/materialIcons";

/** Pixels of indent per level. Small: the chevron and icon already read as
 *  structure, and VS Code's tree earns its density by not over-stepping.
 *
 *  Exported for `DraftRow`, which is a row in every visual respect and must
 *  line up with its siblings to the pixel — a second copy of these two numbers
 *  is a second thing to keep in step, and the failure is a row that sits
 *  visibly wrong. */
export const INDENT = 8;
/** Where depth 0 starts, leaving the selection rule at the pane's edge room. */
export const GUTTER = 6;

export default function TreeRow({
  row,
  id,
  cursor,
  open,
  onActivate,
  onKeep,
  onContextMenu,
}: {
  row: Row;
  /** Referenced by the tree's `aria-activedescendant`; see `Explorer`. */
  id: string;
  /** The keyboard is on this row. */
  cursor: boolean;
  /** This row's file is the one showing in the viewer. */
  open: boolean;
  onActivate: (row: Row) => void;
  /**
   * The user double-clicked a file: it stops being a preview and stays. Not
   * offered for a directory — the two clicks underneath have already expanded
   * and collapsed it, and there is nothing sensible left to add.
   */
  onKeep: (row: Row) => void;
  onContextMenu: (row: Row, event: React.MouseEvent) => void;
}) {
  const isDir = row.entry.kind === "dir";

  return (
    <div
      id={id}
      role="treeitem"
      className="explorer__row"
      // `aria-level` counts from 1, and the root itself is not a row.
      aria-level={row.depth + 1}
      aria-expanded={isDir ? row.expanded : undefined}
      aria-selected={cursor}
      data-cursor={cursor || undefined}
      data-open={open || undefined}
      style={{ paddingLeft: GUTTER + row.depth * INDENT }}
      onClick={() => onActivate(row)}
      onDoubleClick={() => {
        if (row.entry.kind === "file") onKeep(row);
      }}
      onContextMenu={(event) => onContextMenu(row, event)}
      // The pane is narrow and names ellipsize; the full path is the thing
      // worth having on hover, and the failure displaces it when there is one.
      title={row.error ?? row.entry.path}
    >
      {isDir ? (
        <Chevron />
      ) : (
        // A file has no chevron but still owes the column its width, or every
        // name in a folder of files sits one glyph left of its sibling
        // directories and the text edge goes ragged.
        <span className="explorer__chevron explorer__chevron--none" aria-hidden="true" />
      )}

      <img
        className="explorer__icon"
        src={isDir ? folderIconUrl(row.entry.name, row.expanded) : fileIconUrl(row.entry.name)}
        // The name beside it says everything the icon does. Announcing the
        // glyph as well would read every row twice.
        alt=""
        draggable={false}
      />

      <span className="explorer__name">{row.entry.name}</span>

      {/* A directory that would not list. Said on the row rather than as a
          line of its own, so the flat array stays one entry per tree node and
          the keyboard never lands on something it cannot open. */}
      {row.error && <span className="explorer__tag">unreadable</span>}
    </div>
  );
}

/**
 * The disclosure triangle, drawn here rather than imported.
 *
 * `src/ui/Icon.tsx` is the shell's, and an app may not reach into `src/` — the
 * whole point of `apps/` is that this directory could be lifted into a
 * repository of its own tomorrow. So the shape is re-authored to that file's
 * conventions instead: 24×24 box, no fill, `currentColor` at 2px, round caps,
 * `aria-hidden`. It is the same path as its `ChevronRight`.
 *
 * One path, rotated by CSS when the row opens, rather than two drawings —
 * pointing right and pointing down are the same triangle, and a second path
 * would be a second thing to keep at the same weight. No transition on the
 * rotation: see this file's header.
 */
function Chevron() {
  return (
    <svg
      className="explorer__chevron"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
