/**
 * Turning `GitFileChange.insertions`/`deletions` into the `+12 −3` a row draws.
 *
 * Its own module because one rule here is counter-intuitive enough to be worth
 * a test file: an absent count is not a zero count. `git.rs` writes both fields
 * `null` together for a change it cannot count lines in — a binary file, an
 * untracked file over its size cap, a conflict — and `+0 −0` claims something
 * else entirely, that a file was staged unchanged.
 */
import type { GitFileChange } from "../contract";

/** What a section header adds up over its rows. `uncounted` is how many had
 *  nothing to contribute, so a header can say `+40 −2` over eight files without
 *  implying it covered the ninth. */
export interface LineTotals {
  insertions: number;
  deletions: number;
  uncounted: number;
}

/** Sum one list's counts, skipping the changes that have none. Only
 *  `insertions` is tested for absence — the backend writes the pair together,
 *  and reading `deletions` separately would invent a third state neither side
 *  has. */
export function sumLineCounts(changes: GitFileChange[]): LineTotals {
  let insertions = 0;
  let deletions = 0;
  let uncounted = 0;

  for (const change of changes) {
    if (change.insertions === null) {
      uncounted += 1;
      continue;
    }
    insertions += change.insertions;
    deletions += change.deletions ?? 0;
  }

  return { insertions, deletions, uncounted };
}

/**
 * The two strings a row or header prints, or `null` for nothing to print.
 *
 * `null` covers two cases on purpose, because they draw identically: a change
 * with no counts, and one whose counts are both zero — a file staged with its
 * content unchanged, or a mode change. Neither earns a `+0 −0` beside a name.
 *
 * A minus sign (U+2212), not a hyphen: only one of the two lines up under a
 * plus, and these columns are read as a pair.
 */
export function formatLineCounts(
  insertions: number | null,
  deletions: number | null,
): { added: string; removed: string } | null {
  const added = insertions ?? 0;
  const removed = deletions ?? 0;
  if (insertions === null || (added === 0 && removed === 0)) return null;
  return { added: `+${added}`, removed: `−${removed}` };
}

/** The same counts as one sentence, for a `title` and an accessible name — the
 *  two columns read as "+12 −3" to a sighted person and as nothing useful to a
 *  screen reader. `null` wherever `formatLineCounts` is `null`. */
export function describeLineCounts(
  insertions: number | null,
  deletions: number | null,
): string | null {
  if (formatLineCounts(insertions, deletions) === null) return null;
  const added = insertions ?? 0;
  const removed = deletions ?? 0;
  return `${added} ${added === 1 ? "line" : "lines"} added, ${removed} ${
    removed === 1 ? "line" : "lines"
  } removed`;
}
