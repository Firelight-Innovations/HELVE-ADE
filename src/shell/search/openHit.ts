/**
 * Opening a search hit: Enter on the focused result, or a double-click on any
 * row, puts that file on screen in the Files app, in the cluster the search was
 * run against. Why this is a plain function rather than a hook or a component,
 * why both gestures hand over a finished path, and what it deliberately does
 * not do (focus, closing the overlay, revealing the file in Files' tree) are
 * all in `docs/design-notes/shell-search.md`.
 */
import type { Cluster, SurfaceInstance } from "../contract";
import { paneTabs } from "../contract";
import { activateInstance, fetchShellState, openInstance, windowLabel } from "../state/shellState";
import { toolWindowBridge } from "../toolWindowRegistry";

/** The event this module pushes into a mounted Files frame. Colon-separated,
 *  like the shell's other push event (`project:changed`) — never
 *  `files/open-path`, which would read as an RPC method Files answers rather
 *  than an instruction the shell pushes at it. Listener: Files' `App.tsx`. */
const OPEN_PATH_EVENT = "files:open-path";

/** Open `path` in the Files app showing `clusterId`, bringing that Files
 *  forward if another surface is showing and opening a new Files if the
 *  cluster has none. A `null` `clusterId` means no cluster — `PreviewPane.tsx`'s
 *  convention here — so there is nothing to open into and this resolves as an
 *  explicit no-op; see the design note for why it is not left implicit. */
export async function openHitInFiles(path: string, clusterId: string | null): Promise<void> {
  if (clusterId === null) return;

  const label = windowLabel();
  const snapshot = await fetchShellState();
  const placement = snapshot.windows.find((w) => w.label === label);
  const cluster = placement?.clusters.find((c) => c.id === clusterId);
  // The cluster closed, or moved to another window, between the keystroke and
  // this call landing. Nothing left to open into.
  if (!cluster) return;

  const instances = new Map(snapshot.instances.map((i) => [i.id, i]));
  const existing = findFilesInstance(cluster, instances);

  let instanceId: string;
  if (existing) {
    instanceId = existing.id;
    // Bring it forward rather than opening a second one — the same rule
    // `onOpenRecent` in `WindowRoot.tsx` applies to Home.
    void activateInstance(instanceId);
  } else {
    // No `activePaneId` to aim at (that is `WindowRoot.tsx`'s local state), so
    // a first Files opens as a tab in the active cluster's first pane rather
    // than splitting toward where the user was last looking — see the note.
    instanceId = await openInstance(label, "files");
  }

  // The frame may not exist yet: `openInstance` resolves before `ToolWindow`
  // has mounted the iframe, and the existing-instance branch races a Files
  // still booting. `sendEventWhenReady` queues across that gap and delivers
  // when the frame says ready (see `ToolWindow.tsx`); no registered bridge at
  // all is a race no keystroke can land inside — see the design note.
  toolWindowBridge(label)?.sendEventWhenReady(instanceId, OPEN_PATH_EVENT, { path });
}

/** The cluster's own Files instance, if it has one — walking its tree's tabs
 *  in layout order and resolving each against the flat instance list, the
 *  same two steps `WindowRoot.tsx`'s `onOpenRecent` uses to find Home. */
function findFilesInstance(
  cluster: Cluster,
  instances: Map<string, SurfaceInstance>,
): SurfaceInstance | undefined {
  for (const id of paneTabs(cluster.tree)) {
    const instance = instances.get(id);
    if (instance?.appId === "files") return instance;
  }
  return undefined;
}
