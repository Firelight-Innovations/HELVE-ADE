/**
 * Which row the source-control panel has open, as three pure rules — previously
 * an object literal, a boolean expression and an `if`, in three components that
 * all had to agree about what identifies a row.
 *
 * The runner has no DOM (STANDARDS.md §8.3) and cannot press a button, but it
 * can hold the layer underneath one: `selectionFor` writes the value and
 * `isRowSelected` reads it, so a disagreement between them — the exact shape of
 * "a click sets state and the pane draws nothing" — is now a failing test.
 */
import type { GitFileChange } from "../contract";

/** Which row is open. The pair, not just the path: a path can be in both lists
 *  at once — staged and then edited again — and those are two different diffs. */
export interface Selection {
  path: string;
  staged: boolean;
}

/** What clicking `change` opens. The only writer, so a row's shape cannot drift
 *  from what the readers below expect. */
export function selectionFor(change: GitFileChange): Selection {
  return { path: change.path, staged: change.staged };
}

/** Whether `change`'s row is the open one. Both fields, for `Selection`'s
 *  reason: on `path` alone this would highlight the row in both lists. */
export function isRowSelected(selection: Selection | null, change: GitFileChange): boolean {
  if (selection === null) return false;
  return selection.path === change.path && selection.staged === change.staged;
}

/** Where an open diff goes when its row is staged or unstaged: the same file on
 *  the other side, or `selection` untouched. Never `null` — closing cost a
 *  second click in this panel's commonest sequence, read a diff, stage it, look
 *  again. `staged` is the side the paths were on *before* the move, so a
 *  selection on the other side is left alone rather than dragged along. */
export function followAcrossIndex(
  selection: Selection | null,
  paths: string[],
  staged: boolean,
): Selection | null {
  if (selection === null) return null;
  if (selection.staged !== staged) return selection;
  if (!paths.includes(selection.path)) return selection;
  return { path: selection.path, staged: !staged };
}
