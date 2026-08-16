/**
 * The tree's git decoration: what changed, reshaped for `TreeRow` and for the
 * directories that hold a change without showing it.
 *
 * `GitChangeKind`, `GIT_KIND_TOKEN` and `GIT_KIND_LETTER` restate
 * `src/shell/contract.ts`'s source-control panel exactly rather than
 * importing it — see `rpc.ts`'s header for why an app under `apps/` never
 * reaches into `src/`. If the values below drift from that file, that file is
 * the one to trust; this is a copy, not a second decision.
 */
import { invoke } from "@helve/bridge";
import { useEffect, useMemo, useState } from "react";

export type GitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

interface GitChange {
  /** Absolute, already resolved by the backend — matches `Entry.path`, so
   *  this can be looked up directly with no prefix-joining on this side. */
  path: string;
  kind: GitChangeKind;
  staged: boolean;
}

interface GitStatusResult {
  branch: string;
  changes: GitChange[];
}

/**
 * The colour token for each kind, matching VS Code's own convention: modified
 * and renamed read as "changed", added and untracked as "new", deleted as
 * "gone", conflicted as the error it is. Every value is one of the ten named
 * tokens in `src/tokens.css` — never a hex added here.
 */
export const GIT_KIND_TOKEN: Record<GitChangeKind, string> = {
  modified: "var(--warn)",
  added: "var(--ok)",
  deleted: "var(--err)",
  renamed: "var(--warn)",
  untracked: "var(--text-dim-3)",
  conflicted: "var(--err)",
};

/**
 * The single letter git itself prints in a status short-format. `untracked`
 * is `?` rather than `U` — `U` is already git's letter for an unmerged path,
 * and `conflicted` needs it more than a file nobody has added yet does.
 */
export const GIT_KIND_LETTER: Record<GitChangeKind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflicted: "U",
};

/**
 * Highest to lowest. A directory that holds more than one kind of change
 * below it can only tint its name one colour, so this decides which change a
 * reader gets pointed at first: a conflict always wins, and an untracked file
 * is the least alarming thing a folder can contain.
 */
const KIND_RANK: readonly GitChangeKind[] = [
  "conflicted",
  "deleted",
  "modified",
  "renamed",
  "added",
  "untracked",
];

export interface GitDecoration {
  /** A path with a change of its own — a file, or (git reports these whole
   *  rather than file-by-file) an untracked directory. */
  direct: ReadonlyMap<string, GitChangeKind>;
  /** A directory with no change of its own but a change *somewhere* below
   *  it, open or not. The value is the highest-ranked kind found in its
   *  subtree, which is what its tint shows. */
  rollup: ReadonlyMap<string, GitChangeKind>;
}

/**
 * Fetch `files/git-status` and shape it for the tree.
 *
 * Refetches on mount and whenever `reloadNonce` changes — the same signal
 * `useTree` re-lists on, from the same refresh button and the same "the
 * project changed underneath us" cases. There is no push from the backend:
 * like every other read in this app, this is asked again rather than
 * subscribed to.
 *
 * Resolves to `null` for "no project" or "not a repository" (what the RPC
 * itself returns) and also for a call that failed outright — both mean the
 * tree should draw exactly as it does with no git support at all, and a
 * caller checking one is checking the other for free.
 */
export function useGitStatus(reloadNonce: number): GitDecoration | null {
  const [result, setResult] = useState<GitStatusResult | null>(null);

  useEffect(() => {
    let live = true;
    void invoke<GitStatusResult | null>("files/git-status")
      .then((status) => {
        if (live) setResult(status);
      })
      .catch(() => {
        if (live) setResult(null);
      });
    return () => {
      live = false;
    };
  }, [reloadNonce]);

  return useMemo(() => {
    if (!result) return null;

    const direct = new Map<string, GitChangeKind>();
    // Unstaged entries land after staged ones in the backend's own array (see
    // `git_status` in `files.rs`), so setting every entry in order — letting
    // a later one overwrite an earlier one at the same key — leaves the more
    // recent change in place for a path that appears on both sides.
    for (const change of result.changes) direct.set(change.path, change.kind);

    // Derived from the change paths themselves, not by walking the tree: most
    // of the tree is not loaded (it is lazy), and this has to work for a
    // directory nobody has opened yet.
    const rollup = new Map<string, GitChangeKind>();
    for (const change of result.changes) {
      let path = change.path;
      let cut = lastSeparator(path);
      while (cut > 0) {
        const dir = path.slice(0, cut);
        const current = rollup.get(dir);
        if (!current || rank(change.kind) < rank(current)) rollup.set(dir, change.kind);
        path = dir;
        cut = lastSeparator(path);
      }
    }

    return { direct, rollup };
  }, [result]);
}

/** Both separators, exactly like `baseName` in `rpc.ts` — the backend returns
 *  whatever `Display` produced, which is backslash on Windows. */
function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
}

function rank(kind: GitChangeKind): number {
  return KIND_RANK.indexOf(kind);
}
