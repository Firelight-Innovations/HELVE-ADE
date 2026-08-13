/**
 * The frontend half of source control.
 *
 * Mirrors `src-tauri/src/git.rs`. Five one-shot calls and no subscription: there
 * is no filesystem watcher behind this, so nothing here can push. The panel
 * re-asks for status after every mutation and whenever the shown tool changes,
 * and that is the entire update model — deliberately unlike `shellState.ts`,
 * where more than one window has to agree and so the backend broadcasts.
 *
 * Every method takes a tool id rather than a path. Resolving that id to a
 * checkout is Rust's job (the same `snapshot.tools.find` every other tool
 * command does), which keeps checkout paths out of the interface entirely —
 * `contract.ts` says the shell never learns one, and this is where that would
 * otherwise leak.
 */
import { invoke } from "@tauri-apps/api/core";
import type { GitControl, GitDiff, GitStatus } from "../contract";
import { fakeGitControl, isFake } from "./fakeBackend";

export const gitControl: GitControl = {
  status(toolId) {
    if (isFake()) return fakeGitControl.status(toolId);
    // Rust answers `Option<GitStatus>`, which arrives as the value or `null`.
    // No mapping needed — `null` already means "no repo here, draw the empty
    // state".
    return invoke<GitStatus | null>("git_status", { id: toolId });
  },

  diff(toolId, path, staged) {
    if (isFake()) return fakeGitControl.diff(toolId, path, staged);
    return invoke<GitDiff>("git_diff", { id: toolId, path, staged });
  },

  stage(toolId, paths) {
    if (isFake()) return fakeGitControl.stage(toolId, paths);
    return invoke("git_stage", { id: toolId, paths });
  },

  unstage(toolId, paths) {
    if (isFake()) return fakeGitControl.unstage(toolId, paths);
    return invoke("git_unstage", { id: toolId, paths });
  },

  commit(toolId, message) {
    if (isFake()) return fakeGitControl.commit(toolId, message);
    return invoke("git_commit", { id: toolId, message });
  },
};
