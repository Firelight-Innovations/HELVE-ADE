/**
 * Fake `WorktreeSource`s, for the worktree tab to run against before real git
 * integration exists.
 *
 * `stubWorktreeSource` reproduces the handoff's "Worktree tab selected" crop
 * verbatim (docs/handoffs/shell-spec.html, ~lines 223-228): branch
 * `feat/forger-mount` and its three changed files, in the order drawn —
 * modified, added, deleted. That crop draws no ahead/behind counts; the only
 * place the handoff pairs them with a branch name is the status bar's
 * `main · ↑1 ↓0` crop (line 200), so `ahead`/`behind` are seeded with those
 * same numbers — 1 and 0 — rather than invented ones.
 *
 * `stubNoWorktreeSource` is the empty-state fixture: it always reports
 * `null`, matching the "Worktree tab, repository with no worktree" crop
 * (lines 234-248). Both are exported so a dev harness can exercise either
 * state of `WorktreeView` (src/shell/worktree/WorktreeView.tsx).
 */
import type { Worktree, WorktreeSource } from "../contract";

const FIXTURE: Worktree = {
  branch: "feat/forger-mount",
  ahead: 1,
  behind: 0,
  changes: [
    { kind: "M", file: "styles.css", dir: "orchestrator/src" },
    { kind: "A", file: "shell.tsx", dir: "orchestrator/src" },
    { kind: "D", file: "legacy-bar.tsx", dir: "orchestrator/src" },
  ],
};

export const stubWorktreeSource: WorktreeSource = {
  subscribe(cb) {
    cb(FIXTURE);
    return () => {};
  },
};

export const stubNoWorktreeSource: WorktreeSource = {
  subscribe(cb) {
    cb(null);
    return () => {};
  },
};
