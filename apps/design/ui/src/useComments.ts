/**
 * The comment list, kept in step with a store two things write to.
 *
 * This app is not the only author. An agent resolves a comment or asks a
 * question over `mcp::servers::design`, in another process entirely, and the
 * panel has to notice. Nothing pushes that: an app frontend receives host events
 * through the bridge, and the backend has no channel that reaches an app frame
 * off its own back — so this **polls**, which is the honest version of what a
 * one-call-per-few-seconds read of an in-memory list costs.
 *
 * Rejected: adding an event topic from Rust into the app bridge for this one
 * store. It is the right answer eventually and it is a change to the app
 * protocol, which is a larger decision than a comment panel gets to make on its
 * own. When it lands, {@link REFRESH_MS} and the interval below are the whole of
 * what it replaces.
 *
 * Polling stops while the tab is hidden, because a Design Mode nobody is looking
 * at should cost nothing at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "./comments";
import type { PickedElement } from "./probe";
import {
  addComment,
  deleteComment,
  listComments,
  reasonFor,
  replyToComment,
  resolveComment,
} from "./rpc";

/** How often the list is re-read while the tab is visible. Slow enough to be
 *  invisible in a profile, fast enough that an agent's reply lands while
 *  somebody is still looking at the comment it answers. */
export const REFRESH_MS = 3000;

export interface CommentBook {
  comments: Comment[];
  /** Why the last write failed, for showing beside the box that failed. Cleared
   *  by the next attempt. */
  problem: string | null;
  refresh: () => void;
  leave: (picked: PickedElement, request: string, shot: string | null) => Promise<boolean>;
  reply: (id: string, text: string) => Promise<boolean>;
  resolve: (id: string, text: string) => Promise<boolean>;
  forget: (id: string) => Promise<boolean>;
}

export function useComments(): CommentBook {
  const [comments, setComments] = useState<Comment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  /** Set once the component is gone, so a request already in flight does not
   *  set state on it when it lands. */
  const dropped = useRef(false);

  const refresh = useCallback(() => {
    void listComments()
      .then((list) => {
        if (!dropped.current) setComments(list);
      })
      // Deliberately silent. A failed *read* repeats in three seconds and a
      // notice that appears and disappears on its own teaches nothing; a failed
      // write is the one worth reporting, and `run` below does.
      .catch(() => {});
  }, []);

  useEffect(() => {
    dropped.current = false;
    refresh();

    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);

    // A tab that was hidden through several ticks is a tab whose list is stale
    // the moment it comes back, and waiting a further interval to correct it is
    // exactly when somebody is looking.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      dropped.current = true;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** Every write goes through here: clear the last complaint, do it, re-read.
   *  The re-read rather than a local edit, because the backend prunes, renames
   *  nothing and is the only thing that knows what the record became. */
  const run = useCallback(
    async (work: () => Promise<unknown>): Promise<boolean> => {
      setProblem(null);
      try {
        await work();
        refresh();
        return true;
      } catch (err) {
        if (!dropped.current) setProblem(reasonFor(err));
        return false;
      }
    },
    [refresh],
  );

  return {
    comments,
    problem,
    refresh,
    leave: useCallback(
      (picked: PickedElement, request: string, shot: string | null) =>
        run(() => addComment(picked, request, shot)),
      [run],
    ),
    reply: useCallback((id: string, text: string) => run(() => replyToComment(id, text)), [run]),
    resolve: useCallback((id: string, text: string) => run(() => resolveComment(id, text)), [run]),
    forget: useCallback((id: string) => run(() => deleteComment(id)), [run]),
  };
}
