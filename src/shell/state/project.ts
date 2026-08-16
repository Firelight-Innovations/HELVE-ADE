/**
 * Which project a cluster is working on, for the shell itself.
 *
 * The shell has never needed this before — a project was something the apps
 * knew about, reached over transport B, and Rust broadcast `project:changed`
 * only so `ToolWindow` could relay it into the app frames. The title bar names
 * the project now, so the shell has become a subscriber in its own right and
 * needs its own read of the same two things: the current value, and every
 * change after it.
 *
 * **Per cluster, and that is what makes the title bar work at all.** A project
 * belongs to a cluster, so "which project" is not a question the process can
 * answer — two windows on two monitors are meant to name two different ones at
 * the same time. The bar asks about whichever cluster its own window is
 * showing, which is why this takes an id rather than reading an ambient value.
 *
 * The initial read goes through the `cluster_project` command. It used to go
 * through Home's `home/state`, borrowed because the shell had no command of its
 * own; that stopped being possible when the answer became scoped, since Home's
 * method reports the *calling surface's* cluster and the bar is not a surface.
 * The comment that used to sit here said "if a `project/state` command is ever
 * added for its own reasons, this is the one line that changes" — this is that
 * change.
 *
 * There is no watcher behind any of it. A project renamed on disk while HELVE
 * is running keeps its old name in the bar until something opens it again, and
 * that is the same staleness `ProjectInfo.name` has everywhere else.
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { clusterProject } from "../../bindings";

/** The part of Rust's `ProjectInfo` anything in the shell reads. */
export interface OpenProject {
  name: string;
  path: string;
}

/**
 * The project `clusterId` is pointed at.
 *
 * `null` for "this cluster has no project", for "this window has no cluster"
 * (`clusterId` itself `null`), and for "not answered yet" alike — the title bar
 * draws the same thing for all three, and a further distinction would be one
 * with nowhere to show.
 *
 * Re-fetched when the cluster changes, because switching chips changes the
 * answer without any event firing: nothing about the *project* moved. The
 * subscription covers the other half, a project opening or closing under a
 * cluster that is already on screen.
 */
export function useClusterProject(clusterId: string | null): OpenProject | null {
  const [open, setOpen] = useState<OpenProject | null>(null);

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | undefined;

    // Cleared rather than left showing the previous cluster's project while the
    // fetch is in flight. A stale name in the title bar for a frame or two is
    // the one wrong answer this hook can give that looks entirely plausible.
    setOpen(null);

    void clusterProject(clusterId)
      .then((info) => live && setOpen(info))
      // Left as "no project" rather than surfaced. The bar's answer to a failed
      // read and to nothing being open is the same drawing, and there is no
      // slot in a title for an error — the console is where this belongs.
      .catch((err: unknown) => console.error("helve: could not read the cluster's project:", err));

    // `listen` is async and a cleanup must be returned synchronously, so the
    // subscription is set up in the background and `live` covers the gap.
    void (async () => {
      const stop = await listen<unknown>("project:changed", (e) => {
        // Only this cluster's. The event reaches every window in the process,
        // and a switch in the cluster on the other monitor must not rename the
        // one in front of you — which is the whole point of the feature, so a
        // title bar that ignored the stamp would undo it in the most visible
        // place there is.
        if (!live || clusterOf(e.payload) !== clusterId) return;
        setOpen(openOf(e.payload));
      });
      if (!live) return stop();
      unlisten = stop;
    })();

    return () => {
      live = false;
      unlisten?.();
    };
  }, [clusterId]);

  return open;
}

/**
 * Pull the changed cluster's id out of a `project:changed` payload, or `null`
 * from anything that isn't one.
 *
 * Defensive for the reason `openOf` below is: the payload is `unknown` here,
 * relayed from Rust without ever being typed. A malformed event matches no
 * cluster and is therefore ignored, which is the safe direction — the bar keeps
 * saying what it already said instead of being renamed by a message it could
 * not read.
 */
function clusterOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { clusterId } = payload as { clusterId?: unknown };
  return typeof clusterId === "string" ? clusterId : null;
}

/**
 * Pull the open project out of a `project:changed` payload, or `null` from
 * anything that isn't one.
 *
 * Defensive because the input is `unknown` at this boundary: the event payload
 * is relayed without ever being typed. A shape check here costs nothing and
 * keeps a malformed payload from putting `undefined` in the window title.
 */
function openOf(payload: unknown): OpenProject | null {
  const value = (payload as { open?: unknown } | null)?.open;
  if (typeof value !== "object" || value === null) return null;

  const { name, path } = value as { name?: unknown; path?: unknown };
  if (typeof name !== "string" || typeof path !== "string") return null;
  return { name, path };
}
