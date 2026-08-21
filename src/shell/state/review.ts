/**
 * The frontend half of review notes.
 *
 * Mirrors `src-tauri/src/review/`. One-shot calls and no subscription, for a
 * stronger version of `git.ts`'s reason: these change only when somebody types
 * into the panel. `list` re-reads the file every time, which is what lets
 * another window's notes turn up without an event to carry them.
 *
 * Thin, like `worktreeControl`: every decision worth making is Rust's, and a
 * frontend that made one again would be a second answer that could disagree.
 */
import {
  reviewCommentAdd,
  reviewCommentRemove,
  reviewCommentResolve,
  reviewCommentUpdate,
  reviewComments,
  reviewCommentsMarkSent,
} from "../../bindings";
import type { ReviewControl } from "../contract";

export const reviewControl: ReviewControl = {
  list(clusterId) {
    return reviewComments(clusterId);
  },

  add(clusterId, draft) {
    return reviewCommentAdd(clusterId, draft);
  },

  update(clusterId, id, body) {
    return reviewCommentUpdate(clusterId, id, body);
  },

  resolve(clusterId, id, resolved) {
    return reviewCommentResolve(clusterId, id, resolved);
  },

  remove(clusterId, id) {
    return reviewCommentRemove(clusterId, id);
  },

  markSent(clusterId, ids) {
    return reviewCommentsMarkSent(clusterId, ids);
  },
};

/**
 * Put text on the system clipboard.
 *
 * `navigator.clipboard.writeText`, not `@tauri-apps/plugin-clipboard-manager`:
 * clipboard **write** already works in this webview and the Files context
 * menu's "Copy path" already depends on it (`docs/design-notes/shell-chrome.md`
 * has why write is unaffected by the permission problem that killed menu
 * Paste). A plugin would mean an npm dependency, a crate and a new
 * `capabilities/default.json` entry to buy a call the platform already answers.
 *
 * Here rather than in `bindings.ts` because it is not a command — nothing in
 * `commands.rs` mirrors it — and `state/` is the verb layer (§1.2).
 */
export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
