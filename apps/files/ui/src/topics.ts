/** What this app says to the File Viewer, and what it listens for back.
 *  Restated from `apps/viewer/ui/src/topics.ts` rather than shared, and shorter
 *  than it. Both arguments: `docs/design-notes/files-app.md`. */

/** Which file the Viewer is showing, so the tree can mark that row open. */
export const ACTIVE_PATH = "files/active-path";

/** Which open files hold unsaved work, so a delete can say what it will cost. */
export const DIRTY_PATHS = "files/dirty";

/** The last thing that happened to the tree on disk. Both apps publish it. */
export const TREE_CHANGE = "files/tree-change";

/** A file was written. Only the git decoration listens — the tree's shape is
 *  unchanged by a save. Its payload carries a path and a counter, and the
 *  counter is load-bearing; `apps/viewer/ui/src/topics.ts` has the note. */
export const FILE_SAVED = "files/saved";

/** The path out of a `FILE_SAVED` payload, or `null` if it does not look like
 *  one. The decoration re-asks git about the whole checkout either way; the one
 *  path it cares about is a `.gitignore`, the only save that can change what is
 *  greyed out. */
export function asSavedPath(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const path = (value as { path?: unknown }).path;
  return typeof path === "string" ? path : null;
}

/** What `TREE_CHANGE` carries. */
export type TreeChange =
  { kind: "renamed"; from: string; to: string } | { kind: "deleted"; path: string };

/** Narrow an `ACTIVE_PATH` payload, which arrives as `unknown`. */
export function asActivePath(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Narrow a `DIRTY_PATHS` payload, dropping anything that is not a string. */
export function asDirtyPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Whether `path` is `root` itself or something inside it.
 *  The separator check is what keeps this from being a plain `startsWith`:
 *  without it `src` would claim `src-generated` as a child, and a delete
 *  confirmation would warn about unsaved work in a folder nobody is deleting.
 *  Both separators are accepted because a Windows path can contain either and
 *  the backend returns whatever `Display` produced. This is a third copy of the
 *  same predicate; `docs/design-notes/files-app.md` says whose and why. */
export function isAtOrUnder(path: string, root: string): boolean {
  if (path === root) return true;
  if (!path.startsWith(root)) return false;
  const next = path.charAt(root.length);
  return next === "\\" || next === "/";
}
