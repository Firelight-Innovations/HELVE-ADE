/**
 * What this app says to the File Explorer, and what it listens for back.
 *
 * Three strings and two shapes. They are **restated** in
 * `apps/files/ui/src/topics.ts` rather than imported from one place, which is
 * the same trade `commands.ts` makes for the menu ids and `rpc.ts` makes for
 * the backend's reply shapes: an app's only coupling to anything outside itself
 * is `@helve/bridge` and the shape of what crosses it. A module the two apps
 * shared would be a third thing that has to move with either of them, and it
 * would make one app's refactor able to break the other's build — the failure
 * this boundary exists to prevent.
 *
 * What catches a drift is not `tsc`, then. It is that both files are short,
 * both name the other in this comment, and a mismatch shows up the first time
 * anyone clicks a file.
 */

/**
 * Which file this app is showing. Published by File Viewer, read by File
 * Explorer to put the "open" treatment on a row.
 *
 * `null` is a real value and is published as one — a Viewer with no tab open
 * is saying something true, and leaving the last path retained instead would
 * leave a row highlighted under a closed editor.
 */
export const ACTIVE_PATH = "files/active-path";

/**
 * Which open files have unsaved work, by path. Published by File Viewer, read
 * by File Explorer so a delete confirmation can still name what is about to be
 * lost.
 *
 * This is the one piece of the old single-app Files that the split genuinely
 * took away: `App.tsx` used to be able to ask the tab model directly. Now the
 * question crosses a process-shaped boundary, and the answer is a fact one app
 * has to volunteer. Retained and replayed, so an Explorer that mounts second
 * is not briefly willing to delete unsaved work without saying so.
 */
export const DIRTY_PATHS = "files/dirty";

/**
 * The last thing that happened to the tree on disk. Published by whichever app
 * did it, read by both.
 *
 * A rename started in the Explorer has to move this app's tabs; a delete
 * confirmed in this app has to make the Explorer re-list. Both directions, one
 * topic.
 *
 * **Retained like any other topic, and that is safe here because both
 * operations are idempotent.** A rename replayed to a frame that has already
 * applied it finds no tab at the old path and does nothing; a delete replayed
 * finds no tab under the path and does nothing. So a late-mounting Viewer being
 * told about a rename that happened before it existed costs a no-op, where the
 * alternative — a transient broadcast the shell does not retain — would have
 * meant a third verb on the protocol for the sake of it.
 */
export const TREE_CHANGE = "files/tree-change";

/**
 * A file was written to disk.
 *
 * Separate from `TREE_CHANGE` because it is not one: saving a file leaves the
 * tree's *shape* exactly as it was, and the Explorer would be re-listing every
 * open folder to learn something none of them can tell it. What it does change
 * is what git says about that path, which is the one thing the Explorer
 * refetches on this.
 */
export const FILE_SAVED = "files/saved";

/**
 * What `FILE_SAVED` carries — and why it carries a counter.
 *
 * `publish` does not re-send a value equal to the last one it sent on that
 * topic (`client.test.ts` pins this: "sends a publish, and does not re-send an
 * unchanged value"). That is right for the topics it was built for, which are
 * *state* — which file is active, which buffers are dirty — where re-announcing
 * an unchanged answer is pure noise.
 *
 * This one is an *event*, and saving the same file twice in a row is the most
 * ordinary thing a person does in an editor. With the path alone the second
 * save would be silently dropped and the tree would stop keeping up. The
 * counter is what makes each save a distinct value, so the dedup that is
 * correct for state cannot swallow an event.
 */
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
