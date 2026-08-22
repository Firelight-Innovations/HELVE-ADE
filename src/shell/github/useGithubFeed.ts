/**
 * Fetching the GitHub feed, and keeping the panel from acting on a stale one.
 *
 * Modelled on `worktree/useGitStatus.ts` — a handle with the data, a flag, and
 * a `refresh` — because the panel has the same shape of problem: a one-shot RPC
 * re-asked on a cluster switch, with no watcher behind it.
 *
 * Two things here that `useGitStatus` does not need.
 *
 * A fetch is keyed on the cluster *and* the fetch scope, and a scope change is
 * something the user causes by typing, so two requests are easily in flight at
 * once and can finish in the wrong order. Every reply is checked against the
 * request that is current before it is allowed to land.
 *
 * And nothing is fetched while the panel is not on screen. `git status` costs a
 * process spawn against the local disk; this costs two requests against a quota
 * that is sixty an hour for a signed-out user, so a cluster switch behind a
 * hidden tab must not spend any of it. `useLibrary` gates on `active` for a
 * milder version of the same reason.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GithubControl, GithubFeed, GithubScope } from "../contract";

export interface GithubFeedHandle {
  /** `null` until the first reply. Distinct from a `notGithub` feed, which is
   *  an answer — this is not having asked yet, and stays `null` for as long as
   *  the panel is hidden. */
  feed: GithubFeed | null;
  /** True while a request is out, including a refresh over an existing feed, so
   *  the panel can dim rather than blank what it is already showing. */
  loading: boolean;
  refresh: () => void;
}

/**
 * The feed for one cluster at one scope, fetched only while `active`.
 *
 * `null` for `clusterId` is "no cluster is active": no request goes out and the
 * feed stays `null`, which is the rule every other region follows for an unset
 * cluster. `active: false` behaves the same way and keeps whatever was last
 * fetched, so switching away from the panel and back does not re-ask.
 */
export function useGithubFeed(
  control: GithubControl,
  clusterId: string | null,
  scope: GithubScope,
  active: boolean,
): GithubFeedHandle {
  const [feed, setFeed] = useState<GithubFeed | null>(null);
  const [loading, setLoading] = useState(false);

  // Bumped by every fetch and captured by each one, so a reply can tell whether
  // it is still the answer to the question being asked. A boolean "cancelled"
  // set from the effect's cleanup would not do: `refresh` fires without the
  // effect re-running, and there is no cleanup on that path to trip.
  const generation = useRef(0);

  const fetchFeed = useCallback(() => {
    if (clusterId === null) {
      setFeed(null);
      setLoading(false);
      return;
    }
    // Not an early `return` that leaves `loading` true: a panel switched away
    // from mid-request would come back saying it was still loading forever.
    if (!active) {
      setLoading(false);
      return;
    }
    const mine = ++generation.current;
    setLoading(true);
    void control
      .feed(clusterId, scope)
      .then((next) => {
        if (generation.current !== mine) return;
        setFeed(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (generation.current !== mine) return;
        // Only the IPC call itself can reject — every GitHub failure arrives as
        // a `GithubFeed` variant. So this is a bug or a shutdown rather than a
        // network problem, and it still has to become something drawable: an
        // empty panel with no explanation is the state this whole feature is
        // built to avoid, and it would be worse here than anywhere.
        setFeed({
          state: "unavailable",
          repo: null,
          trouble: { kind: "unreachable", reason: String(err) },
        });
        setLoading(false);
      });
  }, [control, clusterId, scope, active]);

  useEffect(fetchFeed, [fetchFeed]);

  // `fetchFeed` is already the whole of refreshing: it bumps the generation on
  // the way in, so a slow earlier reply is invalidated rather than allowed to
  // land on top of the answer somebody just asked for.
  return { feed, loading, refresh: fetchFeed };
}
