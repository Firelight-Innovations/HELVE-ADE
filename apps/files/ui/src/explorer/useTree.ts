/**
 * The tree's shape: what is loaded, what is open, and the flat row list that
 * falls out of the two.
 *
 * Everything the explorer draws comes out of `rows` — one array, one entry per
 * visible line, already in order. That is not just convenient for the
 * windowing in `useVirtualRows.ts`; it is what makes keyboard navigation
 * arithmetic instead of a recursive walk, and what lets "the row after this
 * one" mean the same thing to the ↓ key and to the scrollbar.
 *
 * What it deliberately does not do:
 *
 * - **Sort.** `files/list` already returns directories first, then
 *   case-insensitively by name. A second ordering here could only manage to be
 *   wrong in a different way than the backend, and the two would diverge the
 *   first time either changed.
 * - **Walk the filesystem.** A directory is listed once, when it is first
 *   opened. Nothing pre-fetches, nothing recurses on the backend's behalf, and
 *   nothing watches for changes — a reload is `reloadNonce` changing, and that
 *   is the whole of the story.
 * - **Search.** The filter narrows what is already loaded. Reaching an
 *   unexpanded folder means a recursive `files/search`, which is a different
 *   call this app does not yet have.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describe, list, type Entry, type Root } from "../rpc";

export interface Row {
  entry: Entry;
  /** 0 for the root's own children. Drives the indent and `aria-level`. */
  depth: number;
  /**
   * Whether this row's children are showing. For a directory under an active
   * filter that is not the same thing as the user's collapse state — see the
   * note on `flatten` — which is why the row carries it rather than callers
   * asking `isExpanded`.
   */
  expanded: boolean;
  /** The directory this row was listed from. What ← ascends to. */
  parent: string;
  /** Why this directory shows nothing, when that is a failure and not an
   *  empty folder. `null` on every row that listed cleanly. */
  error: string | null;
}

export interface Tree {
  rows: Row[];
  /** The root itself could not be listed. Nothing else is worth drawing. */
  rootError: string | null;
  /** The root listing has come back — tells "empty folder" from "not yet". */
  ready: boolean;
  /**
   * Open a directory, listing it if this is the first time. There is no
   * `toggle`: what a row is *currently* showing is on the row itself, and a
   * caller that asked this hook instead would get the collapse state, which
   * under a filter is a different answer.
   */
  expand: (path: string) => void;
  collapse: (path: string) => void;
  /**
   * Re-read one directory, because something inside it changed.
   *
   * The narrow half of `reloadNonce`: that drops the whole cache and re-lists
   * every open folder, which is right for "the project changed underneath us"
   * and absurd for "a file was just created in this folder" — with
   * `node_modules` open it is tens of thousands of rows re-fetched to show one
   * new row. Nothing is invalidated first; the listing that comes back replaces
   * what was there, so a directory that has not changed is not visibly
   * re-listed either.
   */
  relist: (path: string) => void;
}

export function useTree(root: Root | null, reloadNonce: number, filter: string): Tree {
  /** Path → its immediate children. The root's own listing is in here too,
   *  keyed by `root.path`, so the walk below has no special first case. */
  const [children, setChildren] = useState<ReadonlyMap<string, Entry[]>>(() => new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Bumped on every reload. An in-flight `files/list` started before the bump
   * belongs to a tree that no longer exists, and writing its entries into the
   * new cache would resurrect a directory the reload was meant to re-read.
   */
  const generation = useRef(0);
  /** Paths with a request out, so a double-click doesn't list twice. Replaced
   *  wholesale on reload rather than cleared, so a stale request's cleanup
   *  cannot reach into the live set — see the captured `queue` below. */
  const inFlight = useRef(new Set<string>());

  const load = useCallback((path: string) => {
    const queue = inFlight.current;
    if (queue.has(path)) return;
    queue.add(path);
    const mine = generation.current;

    void list(path)
      .then((listing) => {
        if (generation.current !== mine) return;
        setChildren((prev) => new Map(prev).set(path, listing.entries));
        setErrors((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Map(prev);
          next.delete(path);
          return next;
        });
      })
      .catch((err: unknown) => {
        if (generation.current !== mine) return;
        setErrors((prev) => new Map(prev).set(path, describe("files/list", err)));
      })
      .finally(() => queue.delete(path));
  }, []);

  /**
   * A new root, or a reload of the one we have.
   *
   * The cache is dropped but the *open* set is not: someone who refreshes
   * after creating a file expects to be looking at the same folders they were
   * looking at before, so everything open is re-listed rather than collapsed.
   * `expanded` is read without being a dependency on purpose — an effect
   * closes over the render that scheduled it, so this is the current set, and
   * listing it as a dependency would re-list the world on every expand.
   */
  useEffect(() => {
    generation.current += 1;
    inFlight.current = new Set();
    setChildren(new Map());
    setErrors(new Map());
    if (!root) return;
    load(root.path);
    for (const path of expanded) load(path);
  }, [root, reloadNonce, load]);

  const expand = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      // Collapsing keeps the cache, so re-opening a folder is free.
      if (!children.has(path)) load(path);
    },
    [children, load],
  );

  const collapse = useCallback((path: string) => {
    setExpanded((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const rows = useMemo(
    () => (root ? flatten(root.path, children, errors, expanded, filter.trim().toLowerCase()) : []),
    [root, children, errors, expanded, filter],
  );

  return {
    rows,
    rootError: root ? (errors.get(root.path) ?? null) : null,
    ready: root ? children.has(root.path) : false,
    expand,
    collapse,
    // `load` already replaces whatever it finds under that key, and it is
    // already guarded against listing the same directory twice at once, so
    // there is nothing for this to add beyond a name that says why it is being
    // called.
    relist: load,
  };
}

/**
 * The expanded tree, depth-first, as one array.
 *
 * ## What the filter does
 *
 * With no `needle` this is the obvious walk: emit a row, and if it is an open
 * directory, emit its children after it.
 *
 * With one, two rules apply and they point in opposite directions:
 *
 * - **Upward.** A directory survives if any loaded descendant matches, so a hit
 *   six levels down still has a path leading to it. That is why the parent's
 *   row is *reserved* before its children are walked and dropped afterwards if
 *   nothing came back — the parent's fate is decided by its subtree.
 * - **Downward.** A directory that matches on its own name shows its whole
 *   loaded subtree (`covered`). Without this, filtering on a folder's name
 *   would show that folder and then nothing inside it when you opened it,
 *   which reads as an empty directory rather than as a filter.
 *
 * While filtering, recursion follows the *cache* rather than the open set: a
 * folder that was expanded, then collapsed, still has its children loaded, and
 * hiding matches inside it would make the filter's reach depend on invisible
 * history. Such a directory is reported `expanded` for the duration and snaps
 * back to its real state when the filter clears.
 *
 * A folder that was never opened has nothing to match against, and this does
 * not go and find out. `Explorer` says so in the empty state.
 */
function flatten(
  rootPath: string,
  children: ReadonlyMap<string, Entry[]>,
  errors: ReadonlyMap<string, string>,
  expanded: ReadonlySet<string>,
  needle: string,
): Row[] {
  const rows: Row[] = [];

  // Returns whether this directory contributed anything, which is what the
  // caller needs to decide about its own row. Rows are pushed into the shared
  // array and truncated back off it rather than returned and concatenated —
  // an expanded `node_modules` is tens of thousands of rows, and building it
  // out of per-level arrays would allocate the tree several times over.
  const walk = (dir: string, depth: number, covered: boolean): boolean => {
    const entries = children.get(dir);
    if (!entries) return false;

    let emitted = false;
    for (const entry of entries) {
      const isDir = entry.kind === "dir";
      const self = covered || !needle || entry.name.toLowerCase().includes(needle);
      const open = isDir && (needle ? children.has(entry.path) : expanded.has(entry.path));

      const mark = rows.length;
      rows.push(PLACEHOLDER); // Reserve this row's slot; its children go after it.
      const kids = open ? walk(entry.path, depth + 1, self) : false;

      if (!self && !kids) {
        rows.length = mark; // Neither this row nor anything under it survived.
        continue;
      }

      rows[mark] = {
        entry,
        depth,
        expanded: open && (kids || !needle),
        parent: dir,
        error: errors.get(entry.path) ?? null,
      };
      emitted = true;
    }
    return emitted;
  };

  walk(rootPath, 0, false);
  return rows;
}

/** Stands in a reserved slot for the instant before the real row overwrites
 *  it. Never rendered: every slot is either filled or truncated away. */
const PLACEHOLDER: Row = {
  entry: { name: "", path: "", kind: "other", size: null, mtime: null },
  depth: 0,
  expanded: false,
  parent: "",
  error: null,
};
