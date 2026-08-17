/**
 * What this app says to the File Explorer, and what it listens for back.
 *
 * Three strings and two shapes, **restated** in `apps/files/ui/src/topics.ts`
 * rather than shared from one place — the same trade `commands.ts` makes for
 * the menu ids and `rpc.ts` for the backend's reply shapes. That argument, and
 * the case for each topic below, is in `docs/design-notes/viewer-app.md`.
 */

/** Which file this app is showing; `null` when nothing is open, published as a
 *  real value. Read by File Explorer to mark a row open. */
export const ACTIVE_PATH = "files/active-path";

/** Which open files have unsaved work, by path. Retained and replayed, so an
 *  Explorer that mounts second can still name what a delete would lose. */
export const DIRTY_PATHS = "files/dirty";

/** The last rename or delete on disk, published by whichever app did it and
 *  read by both. Retained, which is safe because both are idempotent. */
export const TREE_CHANGE = "files/tree-change";

/** A file was written to disk. Not a `TREE_CHANGE`: a save leaves the tree's
 *  shape alone, and only git's answer for that path moves. */
export const FILE_SAVED = "files/saved";

/** What `FILE_SAVED` carries. The counter is what stops `publish`'s dedup —
 *  right for state, wrong for an event — swallowing a second save. */
export interface FileSaved {
  path: string;
  /** Monotonic within one Viewer. Not meaningful across apps, and not meant
   *  to be read — only to differ. */
  seq: number;
}

/** What `TREE_CHANGE` carries. */
export type TreeChange =
  { kind: "renamed"; from: string; to: string } | { kind: "deleted"; path: string };

/** Narrow a `TREE_CHANGE` payload, which arrives as `unknown`. */
export function asTreeChange(value: unknown): TreeChange | null {
  if (typeof value !== "object" || value === null) return null;
  const change = value as { kind?: unknown; from?: unknown; to?: unknown; path?: unknown };
  if (
    change.kind === "renamed" &&
    typeof change.from === "string" &&
    typeof change.to === "string"
  ) {
    return { kind: "renamed", from: change.from, to: change.to };
  }
  if (change.kind === "deleted" && typeof change.path === "string") {
    return { kind: "deleted", path: change.path };
  }
  return null;
}
