/**
 * The file tree: a header, a filter, and a windowed list of rows.
 *
 * Rooted on the open project and unable to leave it. There is no "up" button
 * and no breadcrumb, because `files/root` is the boundary the backend enforces
 * anyway — offering a way out of it would only be offering an error.
 *
 * This file owns the parts that need to see the whole tree at once: where the
 * keyboard is, what the filter says, and which row was right-clicked. The tree's
 * contents are `useTree.ts`, which slice of them is in the DOM is
 * `useVirtualRows.ts`, and a row's markup is `TreeRow.tsx`.
 *
 * What it deliberately does not own: which file is open. That is `App.tsx`'s,
 * arriving as `selectedPath` and leaving as `onOpenFile`. The tree can be
 * driven from the tab strip for free as a result, and clicking a row does not
 * have to know what a tab is.
 *
 * No motion on anything in the list — see `TreeRow.tsx`'s header, and
 * `src/shell/worktree/WorktreeView.tsx` for the rule both inherit. framer-motion
 * appears here for exactly one thing: the pane's own width, which the splitter
 * writes to during a drag.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, type MotionStyle, type MotionValue } from "framer-motion";
import ContextMenu, { type MenuTarget } from "./ContextMenu";
import TreeRow from "./TreeRow";
import { useTree, type Row } from "./useTree";
import { ROW_HEIGHT, scrollRowIntoView, useVirtualRows } from "./useVirtualRows";
import type { Root } from "../rpc";
import "./explorer.css";

export default function Explorer({
  root,
  width,
  reloadNonce,
  selectedPath,
  onRefresh,
  onOpenFile,
}: {
  root: Root | null;
  /** Written directly by `Splitter`; never React state. See `Splitter.tsx`. */
  width: MotionValue<number>;
  /** A change means "drop the cache and re-list whatever is open". */
  reloadNonce: number;
  /** The file showing in the viewer, which may have been opened from a tab. */
  selectedPath: string | null;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [filter, setFilter] = useState("");
  /**
   * Where the keyboard is. Separate from `selectedPath` because the two are
   * different facts: the cursor can sit on a directory, or on a file nobody
   * has opened yet, and moving it must not open anything.
   */
  const [cursor, setCursor] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const tree = useTree(root, reloadNonce, filter);
  const { rows, expand, collapse } = tree;
  const port = useVirtualRows(scrollRef, rows.length);

  // Opening a file anywhere — a tab, a jump — brings the cursor with it, so
  // ↓ continues from what is on screen rather than from wherever it last was.
  useEffect(() => {
    if (selectedPath) setCursor(selectedPath);
  }, [selectedPath]);

  // A changed filter re-flattens from the top, so the old scroll offset points
  // at a row that is no longer there. Going back to the top is both the honest
  // answer and what keeps the window from briefly resolving past the new end.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filter]);

  const cursorIndex = useMemo(
    () => (cursor === null ? -1 : rows.findIndex((row) => row.entry.path === cursor)),
    [rows, cursor],
  );

  const moveTo = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      setCursor(row.entry.path);
      scrollRowIntoView(scrollRef.current, index);
    },
    [rows],
  );

  /** Click, and Enter: a directory opens or closes, a file opens. */
  const activate = useCallback(
    (row: Row) => {
      setCursor(row.entry.path);
      if (row.entry.kind === "dir") {
        // The row's own flag, not the collapse set — under a filter those are
        // allowed to differ, and what the chevron shows is what a click owes.
        if (row.expanded) collapse(row.entry.path);
        else expand(row.entry.path);
      } else if (row.entry.kind === "file") {
        onOpenFile(row.entry.path);
      }
      // A pipe or a socket is listed and can be pointed at, but there is
      // nothing to show, so it does nothing here.
    },
    [collapse, expand, onOpenFile],
  );

  const closeMenu = useCallback(() => {
    setMenu(null);
    // The menu took focus when it opened; without this, Escape would leave the
    // keyboard on the document and the next arrow key would scroll nothing.
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = cursorIndex;
    const row = index >= 0 ? rows[index] : null;

    switch (event.key) {
      case "ArrowDown":
        // From nowhere, ↓ lands on the first row: -1 + 1.
        moveTo(index + 1);
        break;
      case "ArrowUp":
        if (index > 0) moveTo(index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "ArrowRight":
        // A closed directory opens; an open one descends into its first child,
        // which is the next row by construction of the flat array. A file has
        // nowhere to go.
        if (!row) moveTo(0);
        else if (row.entry.kind === "dir") {
          if (row.expanded) moveTo(index + 1);
          else expand(row.entry.path);
        }
        break;
      case "ArrowLeft":
        if (row && row.entry.kind === "dir" && row.expanded) {
          collapse(row.entry.path);
        } else if (row) {
          // Ascend. A depth-0 row's parent is the root, which has no row of
          // its own, so this finds nothing and the cursor stays put.
          const parent = rows.findIndex((other) => other.entry.path === row.parent);
          if (parent >= 0) moveTo(parent);
        }
        break;
      case "Enter":
        if (row) activate(row);
        break;
      default:
        // Anything else is not ours — leave the browser's default alone.
        return;
    }
    // Everything above is a key the tree handled, including the ones that
    // decided to do nothing. Not preventing here would let ↑/↓ scroll the
    // scrollport out from under the selection they just moved.
    event.preventDefault();
  };

  const note = emptyNote(tree.rootError, tree.ready, rows.length, filter);

  return (
    <motion.div
      className="explorer"
      // The row height reaches CSS from the one place it is written down, so
      // `explorer.css` and the windowing arithmetic cannot drift apart.
      style={{ width, "--explorer-row": `${ROW_HEIGHT}px` } as MotionStyle}
    >
      <div className="explorer__head">
        <span className="app__label explorer__root">{root ? root.name : "No project"}</span>
        <button
          type="button"
          className="explorer__refresh"
          onClick={onRefresh}
          title="Re-read the folders that are open"
          aria-label="Refresh the file tree"
        >
          <Refresh />
        </button>
      </div>

      <input
        className="explorer__filter"
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter"
        aria-label="Filter the loaded folders"
        spellCheck={false}
        autoComplete="off"
      />

      {/* Outside the tree, not inside it: a `role="tree"` may only contain
          tree items, and an empty tree with a paragraph in it is neither. */}
      {note && <p className={`${note.className} explorer__note`}>{note.text}</p>}

      <div
        ref={scrollRef}
        className="explorer__scroll"
        role="tree"
        aria-label={root ? `${root.name} files` : "Files"}
        // One tab stop for the whole tree. 4,000 rows must not be 4,000 of
        // them, which is the entire reason this is `aria-activedescendant`
        // rather than a roving `tabindex`.
        tabIndex={0}
        // Points at a row that is only in the DOM while it is inside the
        // window. Scrolling far away from the cursor leaves it dangling for as
        // long as that is true — inherent to windowing, and every keyboard
        // move scrolls the row it names back into view.
        aria-activedescendant={cursorIndex >= 0 ? rowId(cursorIndex) : undefined}
        onKeyDown={onKeyDown}
      >
        {/* Two spacers standing in for the rows that are not mounted. Plain
            height, so the scrollbar is the size it would have been. */}
        <div style={{ height: port.padTop }} />

        {rows.slice(port.start, port.end).map((row, offset) => (
          <TreeRow
            key={row.entry.path}
            row={row}
            id={rowId(port.start + offset)}
            cursor={row.entry.path === cursor}
            open={row.entry.path === selectedPath}
            onActivate={activate}
            onContextMenu={(target, event) => {
              event.preventDefault();
              setCursor(target.entry.path);
              setMenu({ path: target.entry.path, x: event.clientX, y: event.clientY });
            }}
          />
        ))}

        <div style={{ height: port.padBottom }} />
      </div>

      {menu && root && <ContextMenu target={menu} rootPath={root.path} onClose={closeMenu} />}
    </motion.div>
  );
}

/** Index-based rather than path-based: a path is not a legal `id`, and the
 *  flat array's index is what both ends of `aria-activedescendant` have. */
const rowId = (index: number) => `explorer-row-${index}`;

/**
 * What to say when the tree draws nothing, and nothing while it draws rows.
 *
 * The filtered case is deliberately not "no results". The tree is lazy, so a
 * folder nobody has opened has nothing to match against; saying anything
 * shorter would be claiming a whole-project search, which means a recursive
 * `files/search` this app does not have yet.
 */
function emptyNote(
  rootError: string | null,
  ready: boolean,
  rowCount: number,
  filter: string,
): { className: string; text: string } | null {
  if (rootError) return { className: "app__error", text: rootError };
  if (rowCount > 0 || !ready) return null;
  if (filter.trim()) {
    return { className: "app__note", text: "No match in the folders loaded so far." };
  }
  return { className: "app__note", text: "This folder is empty." };
}

/**
 * Re-read the open folders.
 *
 * Tabler's outline "refresh" at 2px in a 24×24 box, per the rule in
 * `src/ui/Icon.tsx` for a glyph the handoff never drew. Authored here rather
 * than imported for the reason given on `TreeRow.tsx`'s chevron: an app does
 * not reach into `src/`.
 */
function Refresh() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
    </svg>
  );
}
