/**
 * The internal shapes the search overlay is built from.
 *
 * These are deliberately *not* in `contract.ts` yet. `contract.ts` is the
 * shell's shared surface — the other agent working this branch owns the git
 * region of it — and everything here is still moving. Once the overlay's shape
 * settles, `SearchHit` and `SearchKind` graduate into the search block of
 * `contract.ts` and `SearchIndex` is rewritten around them; until then the
 * churn stays local to this directory.
 *
 * The existing `SearchType`/`SearchResult`/`SearchIndex` trio in `contract.ts`
 * still backs the collapsed slot's stub list. It is untouched here on purpose:
 * the collapsed field and its ⌘K entry point are unchanged, and only what
 * happens after it expands is new.
 */

/**
 * What a hit *is*, which is a coarser question than its file extension.
 *
 * The five-way `SearchType` in `contract.ts` was drawn from the handoff crop
 * and mixes two different axes — three file kinds alongside "terminal output"
 * and "tool settings", which are not files at all. This is the file axis only,
 * pending Braden's call on whether the non-file types survive.
 */
export type SearchKind = "script" | "data" | "content" | "helve";

/**
 * One row in the results region.
 *
 * `path` is absolute, because every consumer needs it absolute: the locator
 * tree walks it back to the search root, and the preview pane hands it
 * straight to `files/read`. Relative display is a rendering concern, computed
 * against the root at draw time rather than stored.
 */
export interface SearchHit {
  /** Absolute path to the file this hit is in. */
  path: string;
  /** Basename, precomputed only because every row draws it. */
  name: string;
  kind: SearchKind;
  /**
   * Every place inside the file the query matched, in file order.
   *
   * Empty for a hit that matched on its *name* only, which is a real and
   * common case: search matches names and contents both, and a file whose
   * name matches has nothing inside it to point at. The results list draws
   * such a hit as a single row with nothing nested under it.
   *
   * A list rather than one match because find-and-replace made it one: a
   * replace steps through matches, not files, so a file with nine of them owes
   * the user nine stops. That is also what the results region nests — a file
   * row with its matches under it — and what makes "417 results in 32 files"
   * a number this shape can actually produce.
   */
  matches: SearchMatch[];
}

export interface SearchMatch {
  /** 1-based, matching what Monaco's `revealLineInCenter` expects. */
  line: number;
  /** 1-based column of the first matched character. */
  column: number;
  /** The matched line's full text, for the row's preview snippet. */
  text: string;
  /** Length of the match within `text`, so the row can mark it. */
  length: number;
}

/**
 * The results region flattened to what it actually draws: one entry per row.
 *
 * The region is a nested list — a file, then its matches — but it is rendered
 * and navigated as a flat one, because the arrow keys have to step through
 * *matches* and a nested structure makes "the next row" a tree walk. Flattening
 * once, here, is the same trick `LocatorTree` plays for the same reason, and it
 * is what lets the cursor be a single integer.
 *
 * A file whose name matched but whose contents did not contributes one `file`
 * row and no `match` rows, so it is a stop on the way past rather than a header
 * over nothing.
 */
export type ResultRow =
  | { row: "file"; hit: SearchHit }
  | {
      row: "match";
      hit: SearchHit;
      match: SearchMatch;
      /** 1-based position within this file's matches, for "3 of 9". */
      ordinal: number;
    };

/**
 * A node in the locator tree — the read-only explorer in the lower left.
 *
 * Mirrors the `Entry` shape `files/list` returns rather than inventing a new
 * one, so a listing maps onto it without translation. `kind` drops Files'
 * `"other"` case into `"file"`: the locator only ever draws a folder or a
 * leaf, and a socket or symlink drawn as a leaf is correct enough for a pane
 * whose only job is showing you where something sits.
 */
export interface LocatorNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  depth: number;
  /** Directories only. A leaf is never expanded. */
  expanded: boolean;
  /**
   * True for the node that is the hovered hit itself, as opposed to one of the
   * ancestor directories revealed to get to it. Drawn differently — the point
   * of the pane is answering "where is this", so the "this" has to stand out
   * from the path taken to reach it.
   */
  isTarget: boolean;
}

/** What the overlay is currently pointing at, and why. */
export interface LocatorFocus {
  /** Absolute path of the file to reveal and preview. */
  path: string;
  /** Carried through so the preview can scroll to the hit, when there is one. */
  match: SearchMatch | null;
}
