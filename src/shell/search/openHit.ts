/**
 * Opening a search hit: Enter on the focused result, or a double-click on any
 * row, puts that file on screen in the Files app, in the cluster the search was
 * run against.
 *
 * Both gestures land here through the same one-argument call, which is why the
 * two can disagree about *which* row without this module having to care — the
 * keyboard resolves its row from the cursor, the pointer resolves its row from
 * itself, and both hand over a finished path. See `SearchOverlayProps.onOpen`
 * for why that distinction is load-bearing rather than tidy.
 *
 * Deliberately not a hook and not a component — the overlay's key handling is
 * someone else's code (see `SearchOverlay.tsx`), and this module exists
 * precisely so that code can call one function without importing the tool
 * window's internals to do it. That is also why the two things this needs —
 * "which window am I" and "which frame belongs to that window" — are both
 * resolved from module-scope lookups (`windowLabel()`, `toolWindowBridge()`)
 * rather than taken as parameters: a caller with no props to lean on can
 * still say what it means, because both sides already agree on the address.
 *
 * ## What this does not do
 *
 * It does not focus the pane Files ends up in, or the search overlay's own
 * closing — both are the caller's job, and both need state (`activePaneId`,
 * `searchExpanded`) that lives in `WindowRoot.tsx` and has no business being
 * threaded through here.
 *
 * It reveals the file in Files' tree only as far as that tree already reaches
 * on its own: opening a tab sets `activePath`, which `App.tsx` passes to
 * `Explorer` as `selectedPath`, and `Explorer` puts the keyboard cursor there
 * and gives the row the "open" treatment — but only if the row already exists,
 * which means every ancestor folder between the project root and this file has
 * already been expanded. A folder nobody has browsed to has no rows loaded for
 * it at all (`explorer/useTree.ts` is lazy on purpose), so revealing a file
 * under a folder nobody has opened would mean walking every ancestor and
 * awaiting a `files/list` at each level before the leaf row exists to put a
 * cursor on — real work, and none of the machinery for it exists on either
 * side of the app boundary today. Opening the tab is the whole of what this
 * does; see the handoff summary for the trade.
 */
import type { Cluster, SurfaceInstance } from "../contract";
import { paneTabs } from "../contract";
import { activateInstance, fetchShellState, openInstance, windowLabel } from "../state/shellState";
import { toolWindowBridge } from "../toolwindow/toolWindowRegistry";

/**
 * The event this module pushes into a mounted Files frame. Colon-separated,
 * like the shell's other push event (`project:changed`) — never
 * `files/open-path`, which would read as an RPC method Files answers rather
 * than an instruction the shell is pushing at it unprompted. The one listener
 * is `apps/files/ui/src/App.tsx`.
 */
const OPEN_PATH_EVENT = "files:open-path";

/**
 * Open `path` in the Files app showing `clusterId`, bringing that Files
 * forward if another surface is showing instead and opening a new Files if
 * the cluster has none.
 *
 * `clusterId` mirrors `PreviewPane.tsx`'s own convention in this directory:
 * `null` means no cluster rather than an absent one, and there is nothing
 * sensible to open into, so this resolves without doing anything. That is not
 * a case the overlay should ever produce — a hit only exists because a search
 * ran against some cluster's project — but it costs nothing to make the
 * no-op explicit rather than let a `null` reach `paneTabs` further down as an
 * unexplained early return.
 */
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
    // No pane or split axis to aim at: this call has no `activePaneId` to
    // measure from (that is `WindowRoot.tsx`'s local state, not something a
    // standalone module can reach), so a first Files opens as a tab in the
    // active cluster's first pane rather than splitting toward wherever the
    // user was last looking. Reasonable for what is, today, a single
    // deliberate open rather than a habitual one.
    instanceId = await openInstance(label, "files");
  }

  // The frame this instance mounts into may not exist yet — `openInstance`
  // above resolves before `ToolWindow` has mounted the iframe or completed its
  // hello/ready handshake, and even the *existing*-instance branch races a
  // Files that is still booting from a previous open. `sendEventWhenReady`
  // queues across that gap and delivers the moment the frame says ready; see
  // `ToolWindow.tsx`. If this window's `ToolWindow` has not registered a
  // bridge at all yet, there is nothing to queue into — a race no keystroke
  // can actually land inside, since there is no overlay to press Enter in
  // until the window holding it has painted once.
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
