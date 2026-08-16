/**
 * The frontend half of source control.
 *
 * Mirrors `src-tauri/src/git.rs`. One-shot calls and no subscription: there is
 * no filesystem watcher behind this, so nothing here can push. The panel
 * re-asks for status after every mutation and whenever the shown tool changes,
 * and that is the entire update model — deliberately unlike `shellState.ts`,
 * where more than one window has to agree and so the backend broadcasts.
 *
 * Two interfaces, split by *subject* rather than by scope — both take a cluster
 * id. `gitControl` is the index: what has changed, what is staged, commit it.
 * `worktreeControl` is the checkout a cluster has been given of its own: which
 * worktrees exist, the repository's history, how far this one has diverged.
 * Ids rather than paths in both, and for the same reason: resolving one to a
 * directory is Rust's job, which keeps checkout paths out of the interface
 * entirely — `contract.ts` says the shell never learns one, and this is where
 * that would otherwise leak.
 *
 * `gitControl` took a *tool* id until the source-control view was found to be
 * showing an error in place of every change list. Rust resolved that id against
 * `StackSnapshot.tools`, which `discovery.rs`'s `ENABLED_TOOLS = &[]` leaves
 * empty for every project, so the call could only ever fail; see the note on
 * `git_cluster_status` in `git.rs` for the whole story. Both interfaces now
 * name the same subject, which is also the one the user thinks in.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  gitGraph,
  gitWorktreeCreate,
  gitWorktreeReconcile,
  gitWorktreeRemove,
  gitWorktrees,
} from "../../bindings";
import type {
  GitControl,
  GitDiff,
  GitDivergence,
  GitStatus,
  WorktreeControl,
} from "../contract";
import { fakeGitControl, fakeWorktreeControl, isFake } from "./fakeBackend";

export const gitControl: GitControl = {
  status(clusterId) {
    if (isFake()) return fakeGitControl.status(clusterId);
    // Rust answers `Option<GitStatus>`, which arrives as the value or `null`.
    // No mapping needed — `null` already means "no repo here, draw the empty
    // state".
    return invoke<GitStatus | null>("git_cluster_status", { clusterId });
  },

  diff(clusterId, path, staged) {
    if (isFake()) return fakeGitControl.diff(clusterId, path, staged);
    return invoke<GitDiff>("git_cluster_diff", { clusterId, path, staged });
  },

  stage(clusterId, paths) {
    if (isFake()) return fakeGitControl.stage(clusterId, paths);
    return invoke("git_cluster_stage", { clusterId, paths });
  },

  unstage(clusterId, paths) {
    if (isFake()) return fakeGitControl.unstage(clusterId, paths);
    return invoke("git_cluster_unstage", { clusterId, paths });
  },

  commit(clusterId, message) {
    if (isFake()) return fakeGitControl.commit(clusterId, message);
    return invoke("git_cluster_commit", { clusterId, message });
  },
};

/**
 * The frontend half of a cluster's own checkout.
 *
 * Separate from `gitControl` above, and the split is the scope rather than the
 * subject. Source control answers about whichever tool is on screen; these
 * answer about a *cluster*, which is the thing that can be moved onto a
 * worktree. Keeping them apart means neither interface has to carry an id whose
 * meaning depends on which method you called.
 *
 * Thin by design — every one of these goes straight to a binding, because the
 * decisions worth making (where a worktree is placed, whether a name is usable,
 * whether a binding still points at anything) are all made in Rust where the
 * filesystem is. A frontend that recomputed any of them would be a second
 * answer that could disagree.
 */
export const worktreeControl: WorktreeControl = {
  list(clusterId) {
    if (isFake()) return fakeWorktreeControl.list(clusterId);
    return gitWorktrees(clusterId);
  },

  graph(clusterId, limit) {
    if (isFake()) return fakeWorktreeControl.graph(clusterId, limit);
    return gitGraph(clusterId, limit);
  },

  divergence(clusterId) {
    if (isFake()) return fakeWorktreeControl.divergence(clusterId);
    // Straight `invoke` rather than a `bindings.ts` wrapper, and deliberately:
    // `GitDivergence` holds `GitFileChange`, which lives in `contract.ts`, and
    // `bindings` cannot import from `contract` without a cycle. The same reason
    // `git_status` is called this way a few lines above.
    return invoke<GitDivergence | null>("git_divergence", { clusterId });
  },

  divergenceDiff(clusterId, path, mergeBase) {
    if (isFake()) return fakeWorktreeControl.divergenceDiff(clusterId, path, mergeBase);
    return invoke<GitDiff>("git_divergence_diff", { clusterId, path, mergeBase });
  },

  create(clusterId, name) {
    if (isFake()) return fakeWorktreeControl.create(clusterId, name);
    return gitWorktreeCreate(clusterId, name);
  },

  remove(clusterId, force) {
    if (isFake()) return fakeWorktreeControl.remove(clusterId, force);
    return gitWorktreeRemove(clusterId, force);
  },
};

/**
 * Drop a cluster's worktree binding when the checkout behind it has been
 * deleted from outside HELVE.
 *
 * Not on `WorktreeControl` because it is not something a user does — it is
 * housekeeping the shell runs on a cluster switch, and putting it on the
 * interface would invite a component to call it as though it were an action.
 * The backend clears the binding itself and broadcasts `shell:state`, so the
 * return value is only for a caller that wants to know without waiting for the
 * round trip.
 */
export function reconcileWorktree(clusterId: string) {
  if (isFake()) return fakeWorktreeControl.reconcile(clusterId);
  return gitWorktreeReconcile(clusterId);
}
