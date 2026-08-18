import { Suspense, lazy, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import LocatorTree from "./LocatorTree";
import { searchOverlay, searchOverlayBody } from "../motion";
import { KIND_LABEL } from "./kinds";
import type { SearchSession } from "./useSearchSession";
import type { ResultRow, SearchHit, SearchMatch } from "./types";
import "./searchOverlay.css";

/**
 * The search overlay: everything below the search field, while search is open.
 *
 * Search is not a place in the layout, it is a mode the window is in. A pane
 * would compete with the tool window for room, be draggable and splittable,
 * and stay open behind other work — all wrong for something you enter, use,
 * and leave in a few seconds. Covering the split row leaves the layout
 * underneath untouched and still there when the overlay closes, and no drag
 * or resize code has to learn about it.
 *
 * It covers the split row and not the whole window because the field lives up
 * in the switcher bar and has to stay visible and focused — you are typing
 * into it — and the status bar keeps reporting while search is open, which is
 * what every other transient surface in this shell does.
 */

/** Monaco is heavy enough that it must not sit in the startup bundle, and the
 *  overlay itself is not — so the lazy boundary goes here, around the preview
 *  alone. Opening search draws instantly and the editor arrives a moment later:
 *  the right trade when the field is empty on open and nothing to preview. */
const PreviewPane = lazy(() => import("./PreviewPane"));

export interface SearchOverlayProps {
  session: SearchSession;
  /** The active cluster's directory. Null when no project is open. */
  root: string | null;
  clusterId: string | null;
  /**
   * Open one result in the Files app and close search.
   *
   * Takes the path rather than reading the focused row itself, and that is not
   * ceremony: focus follows `mouseenter`, so a pointer that has been sitting
   * still over one row while the arrow keys moved the cursor to another has
   * fired no new `mouseenter` — the row under the pointer and the focused row
   * genuinely disagree. A double-click means *this* row, so this row says which
   * one it is.
   */
  onOpen: (path: string) => void;
}

export default function SearchOverlay({ session, root, clusterId, onOpen }: SearchOverlayProps) {
  const { rows, searching, parsed, activeIndex, setActiveIndex, focus } = session;

  return (
    /* Two nested motion elements, because the reveal is two things: the outer
       box's clip uncovering downward, and the contents catching up as it does.
       They could not be one element — a clip and a transform on the same node
       would move the clip along with the content and cancel the parallax that
       makes this read as a panel coming down rather than a wipe. Both take
       their timing from `../motion`; see the search block there. */
    <motion.div
      className="search-overlay"
      data-region="search-overlay"
      role="region"
      aria-label="Search"
      variants={searchOverlay}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div className="search-overlay__body" variants={searchOverlayBody}>
        <div className="search-overlay__results">
          <ResultsRegion
            rows={rows}
            searching={searching}
            // The needle, not the raw field text. A field holding only filters
            // (`*.md`) has nothing to search *for* yet, and saying "no results"
            // would blame the filter for a term that was never given.
            needle={parsed.needle}
            root={root}
            activeIndex={activeIndex}
            onFocusIndex={setActiveIndex}
            onOpen={onOpen}
          />
        </div>

        {/* Results across the top, then a lower half split into the locator
            tree and the preview. The split is horizontal rather than the
            results sitting beside them because a result row is wide and short
            — a path plus a name — while both lower panes want height.

            The lower half answers two different questions about the same
            hovered row, which is why it is two panes and not one. The locator
            says *where* the file is, which is what tells two identically-named
            files apart. The preview says *what is in it*, which confirms it is
            the one you meant. Neither alone is enough to pick between
            `src/index.ts` and `dist/index.ts`. */}
        <div className="search-overlay__lower">
          <div className="search-overlay__locator">
            <LocatorTree root={root} clusterId={clusterId} focus={focus} />
          </div>

          <div className="search-overlay__preview">
            {/* No spinner in the fallback. The pane already has a "nothing
                focused" state, and flashing a loader in the same box for the
                few hundred milliseconds Monaco takes reads as a fault rather
                than as progress. */}
            <Suspense fallback={<div className="search-overlay__preview-loading" />}>
              <PreviewPane clusterId={clusterId} focus={focus} />
            </Suspense>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The results list, and the only interactive region the overlay has.
 *
 * Focus follows the pointer, and both lower panes follow the focused row.
 * Nothing below the results is interactive: the locator cannot be expanded and
 * the preview cannot be edited. That is the whole design — you move down the
 * list and the two panes narrate what you are passing over, with no state to
 * manage and nothing to undo.
 */
function ResultsRegion({
  rows,
  searching,
  needle,
  root,
  activeIndex,
  onFocusIndex,
  onOpen,
}: {
  rows: ResultRow[];
  searching: boolean;
  needle: string;
  root: string | null;
  activeIndex: number;
  onFocusIndex: (index: number) => void;
  onOpen: (path: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keyboard movement happens in the field, which never loses focus, so the
  // active row can travel outside the scrolled view without the pointer ever
  // being involved. Following it here is what keeps arrow-key movement and
  // hover movement showing the same thing.
  useEffect(() => {
    const container = scrollRef.current;
    const row = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !row) return;

    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < container.scrollTop) {
      container.scrollTop = rowTop;
    } else if (rowBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = rowBottom - container.clientHeight;
    }
  }, [activeIndex, rows]);

  if (root === null) return <Empty title="No project open in this cluster" />;
  if (needle.trim() === "") return <Empty title="Search this project" />;
  if (rows.length === 0) return <Empty title={searching ? "Searching…" : "No results"} />;

  return (
    <div className="search-overlay__list" ref={scrollRef}>
      {rows.map((row, index) =>
        row.row === "file" ? (
          <FileRow
            // Path alone is not unique across the flat list — a file row and
            // its matches all share one — so every key carries the row's kind
            // and, for a match, its position in the file.
            key={`f:${row.hit.path}`}
            hit={row.hit}
            root={root}
            active={index === activeIndex}
            onFocus={() => onFocusIndex(index)}
            onOpen={() => onOpen(row.hit.path)}
          />
        ) : (
          <MatchRow
            key={`m:${row.hit.path}:${row.ordinal}`}
            match={row.match}
            active={index === activeIndex}
            onFocus={() => onFocusIndex(index)}
            // A match row opens the file the match is in — the same file its
            // header two rows up would open. Which line is not carried across
            // yet; see the note on `MatchRow`.
            onOpen={() => onOpen(row.hit.path)}
          />
        ),
      )}
    </div>
  );
}

/**
 * The header for one file: what it is, what it is called, where it lives, and
 * how many times the query is inside it.
 *
 * Focus follows the pointer and single-clicking does nothing, so a row is not a
 * button and must not announce itself as one — it is a listing of what was
 * found, and the panes below narrate it. `option` rather than `button` says
 * exactly that.
 *
 * Double-click opens the file, matching the gesture every file list in the
 * product already uses for the same meaning. Enter does the same thing from the
 * keyboard, so neither input is the only way in.
 */
function FileRow({
  hit,
  root,
  active,
  onFocus,
  onOpen,
}: {
  hit: SearchHit;
  root: string;
  active: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="search-overlay__row search-overlay__row--file"
      data-active={active || undefined}
      onMouseEnter={onFocus}
      onDoubleClick={onOpen}
      role="option"
      aria-selected={active}
    >
      <span className="search-overlay__row-kind">{KIND_LABEL[hit.kind]}</span>
      <span className="search-overlay__row-name">{hit.name}</span>
      <span className="search-overlay__row-path">{relativeTo(root, hit.path)}</span>
      {/* Absent rather than "0" for a name-only hit: there is no count to
          report, and a zero next to a file that genuinely matched reads as a
          contradiction. */}
      {hit.matches.length > 0 && (
        <span className="search-overlay__row-count">{hit.matches.length}</span>
      )}
    </div>
  );
}

/**
 * One match inside the file above it.
 *
 * Draws the matched line rather than the file's name — the name is already on
 * the header two rows up, and repeating it per match would bury the only thing
 * that distinguishes these rows from each other. The line number is what
 * locates it; the text is what identifies it.
 *
 * Double-click opens the file, like the header does. It does **not** yet land
 * on this match's line: `files:open-path` carries a path and nothing else, and
 * teaching it a line means a payload change in `openHit.ts`, a listener change
 * in Files' `App.tsx`, and a way to reach the mounted Monaco's `revealLine`
 * from there — three files across the app boundary, none of which the "open it"
 * gesture needs to work. Worth doing; not smuggled in behind this.
 */
function MatchRow({
  match,
  active,
  onFocus,
  onOpen,
}: {
  match: SearchMatch;
  active: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="search-overlay__row search-overlay__row--match"
      data-active={active || undefined}
      onMouseEnter={onFocus}
      onDoubleClick={onOpen}
      role="option"
      aria-selected={active}
    >
      <span className="search-overlay__row-line">{match.line}</span>
      {/* Trimmed for the row only. `match.column` still indexes the untrimmed
          line, which is what the preview pane highlights against — the two must
          not be reconciled here or the highlight lands in the wrong place. */}
      <span className="search-overlay__row-snippet">{match.text.trim()}</span>
    </div>
  );
}

/**
 * One line, and nothing else.
 *
 * There used to be a sentence of explanation under the title and a "Close
 * search / Esc" button under that. Both are gone by design rather than by
 * trimming: the explanation described behaviour the overlay demonstrates the
 * moment you type, and the button offered a second way to do what Esc already
 * does — a dismiss control on a surface you leave by pressing the key it names
 * is a button that exists to teach, and this one taught it four times over
 * (every state below routes through here).
 */
function Empty({ title }: { title: string }) {
  return (
    <div className="search-overlay__empty">
      <p className="search-overlay__empty-title">{title}</p>
    </div>
  );
}

/**
 * The path to show on a row: relative to the search root, without the file's
 * own name, since the name already has its own column.
 *
 * Falls back to the absolute path if the hit somehow sits outside the root.
 * That should not happen — the walk starts at the root — but a row that
 * silently showed the wrong folder would be worse than an ugly one.
 */
function relativeTo(root: string, path: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");

  if (!normalizedPath.startsWith(normalizedRoot + "/")) return normalizedPath;

  const rest = normalizedPath.slice(normalizedRoot.length + 1);
  const cut = rest.lastIndexOf("/");
  return cut === -1 ? "" : rest.slice(0, cut);
}
