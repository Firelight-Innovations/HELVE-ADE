/**
 * One git status, fetched once, read by two regions.
 *
 * This sits in `WindowRoot` rather than inside `SourceControlView` for the
 * reason the old `stubWorktreeSource` wiring gave: the status bar and the
 * source-control tab both name the checked-out branch, and two independent
 * fetches would be two chances to disagree about it. It also outlives the tab
 * — `SecondaryPanel` only mounts `worktreeView` while that tab is selected, so
 * a hook owned by the view would take the status bar's branch away every time
 * the user looked at a terminal.
 *
 * There is no watcher behind `GitControl`, so nothing here can push. `refresh`
 * is what the panel calls after every mutation, and a change of `toolId` is
 * the only other thing that re-asks.
 */
import { useCallback, useEffect, useState } from "react";
import type { GitControl, GitStatus } from "../contract";

export interface GitStatusHandle {
  /** `null` for "no tool", "not a repo", or "the last fetch failed". */
  status: GitStatus | null;
  /** True while a fetch is outstanding — the empty state waits for this so it
   *  doesn't flash between a tool being chosen and its status arriving. */
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGitStatus(control: GitControl, toolId: string | null): GitStatusHandle {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(toolId !== null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (toolId === null) {
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Guards against the answer to a superseded question landing last: switch
    // tools twice quickly and the first request can still resolve after the
    // second, which would leave the panel showing the wrong repo.
    let live = true;
    setLoading(true);

    control.status(toolId).then(
      (next) => {
        if (!live) return;
        setStatus(next);
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!live) return;
        setStatus(null);
        setError(gitMessage(reason));
        setLoading(false);
      },
    );

    return () => {
      live = false;
    };
  }, [control, toolId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { status, loading, error, refresh };
}

/**
 * What a rejected `GitControl` call is carrying.
 *
 * Tauri serialises `AppError` across the bridge, so a rejection here is
 * usually already the `Display` string ("git commit failed: nothing to
 * commit…") rather than an `Error`. Both shapes are handled because only one
 * of them survives the boundary and the other is what the fake backend and any
 * genuine frontend bug would throw.
 */
export function gitMessage(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
