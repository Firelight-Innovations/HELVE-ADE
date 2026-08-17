/**
 * The frontend half of the shared shell state.
 *
 * Mirrors `src-tauri/src/shell_state.rs`. Placement and terminal sessions are
 * owned by the backend because more than one window has to agree on them; this
 * is how a window subscribes to that agreement.
 *
 * Deliberately not a store. Every window is a projection of one broadcast
 * object, so there is nothing to reconcile and nothing to merge — the last
 * `shell:state` event is the truth, and `useShellState` re-renders with it.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Cluster, EngineState, SplitDir, SurfaceInstance } from "../contract";

/** Mirrors `shell_state::WindowGeometry`. Physical pixels. */
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors `shell_state::WindowPlacement`. */
export interface WindowPlacement {
  label: string;
  clusters: Cluster[];
  activeClusterId: string | null;
  geometry: WindowGeometry | null;
}

/**
 * Mirrors `shell_state::TerminalSession`.
 *
 * `clusterId`, not a window label. The terminal band is drawn inside the
 * cluster's half of the window, so a terminal belongs to the cluster it is
 * drawn under, spawns in that cluster's project, and closes with it. See
 * `shell_state`'s module doc for what that replaced and what the change costs.
 *
 * It says where the terminal lives *in a band*. A terminal dragged into a pane
 * tree is drawn there instead and the band stops listing it; this still records
 * which band it would return to.
 */
export interface TerminalSessionState {
  id: string;
  title: string;
  clusterId: string;
  agentFinished: boolean;
  groupId: string | null;
}

/** Mirrors `shell_state::ShellSnapshot`. */
export interface ShellSnapshot {
  windows: WindowPlacement[];
  /**
   * Every live app and tool surface, flat. The pane trees hold ids; this is
   * what they resolve against. Flat rather than nested in the trees so a title
   * change does not mean rewriting a tree.
   */
  instances: SurfaceInstance[];
  terminals: TerminalSessionState[];
  engine: EngineState;
}

export const SHELL_STATE_EVENT = "shell:state";

/**
 * Subscribe to the shared state.
 *
 * Subscribe first, then fetch — the same ordering the splash window uses for
 * `boot:status`, and for the same reason. Tauri events have no replay buffer,
 * so a window that fetched first would miss anything broadcast between the
 * fetch returning and the listener being registered. Doing it this way the
 * only risk is the opposite one, a stale fetch landing after a fresh event,
 * which the `settled` flag below discards.
 */
export function useShellState(): ShellSnapshot | null {
  const [snapshot, setSnapshot] = useState<ShellSnapshot | null>(null);

  useEffect(() => {
    let live = true;
    let settled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      unlisten = await listen<ShellSnapshot>(SHELL_STATE_EVENT, (e) => {
        if (!live) return;
        settled = true;
        setSnapshot(e.payload);
      });

      const initial = await invoke<ShellSnapshot>("shell_state");
      // An event already arrived while that round-trip was in flight, and it is
      // newer than what we just asked for. Dropping this is the whole point of
      // the flag.
      if (live && !settled) setSnapshot(initial);
    })();

    return () => {
      live = false;
      unlisten?.();
    };
  }, []);

  return snapshot;
}

/**
 * One-shot read of the shared state, for a caller with no component to hang
 * `useShellState`'s subscription on.
 *
 * `search/openHit.ts` is the reason this exists: resolving where a search
 * hit's Enter keystroke should open into happens outside any render, so there
 * is no hook to call and no subscription worth keeping open for a single
 * answer. Every other reader of this state is a component and should still
 * prefer `useShellState` — polling on every keystroke would be the wrong
 * answer for a screen that is already told the moment something changes.
 */
export function fetchShellState(): Promise<ShellSnapshot> {
  return invoke<ShellSnapshot>("shell_state");
}

/** This window's own label, from the URL it was opened with. */
export function windowLabel(): string {
  return new URLSearchParams(window.location.search).get("window") ?? "main";
}

// --- mutations --------------------------------------------------------------
//
// Every one of these broadcasts on the Rust side, so there is no local state to
// update optimistically and no chance of a window applying a change its
// siblings never hear about. Fire and let the event come back.

// --- instances --------------------------------------------------------------

/**
 * Open a new instance of an app. Resolves to its *instance* id.
 *
 * `paneId` names the pane the open is **relative to**, not the pane the surface
 * lands in; omitted, it falls back to the active cluster's first pane. Opening
 * puts the new surface in a pane of its *own*, splitting the focused one,
 * because arriving as another tab looked on screen like it had replaced what
 * was there.
 *
 * `dir` is the axis to split that pane along, measured from the rendered
 * rectangle by `panes/splitOnOpen.ts` — Rust stores fractions and cannot work it
 * out. Omitted, nothing splits and the surface arrives as a tab, which is what
 * the callers with nothing on screen to measure want. The rules that decline a
 * split even when a direction is given live in `PaneNode::open_into`.
 */
export function openInstance(
  label: string,
  appId: string,
  paneId?: string,
  dir?: SplitDir,
): Promise<string> {
  return invoke<string>("open_instance", {
    label,
    appId,
    paneId: paneId ?? null,
    dir: dir ?? null,
  });
}

export function closeInstance(instanceId: string): Promise<void> {
  return invoke("close_instance", { instanceId });
}

export function activateInstance(instanceId: string): Promise<void> {
  return invoke("activate_instance", { instanceId });
}

/** Reorder within a strip, or move a tab into another pane or window. */
export function moveInstance(
  instanceId: string,
  clusterId: string,
  paneId: string,
  index: number | null,
): Promise<void> {
  return invoke("move_instance", { instanceId, clusterId, paneId, index });
}

/** Drop a tab on a pane's edge: split there, and put it in the new half. */
export function splitPane(
  paneId: string,
  dir: SplitDir,
  instanceId: string,
  before: boolean,
): Promise<void> {
  return invoke("split_pane", { paneId, dir, instanceId, before });
}

/** What a divider drag commits on release. Weights, not pixels. */
export function setPaneSizes(splitId: string, sizes: number[]): Promise<void> {
  return invoke("set_pane_sizes", { splitId, sizes });
}

// --- clusters ---------------------------------------------------------------

export function addCluster(label: string, name: string): Promise<string | null> {
  return invoke<string | null>("add_cluster", { label, name });
}

export function setActiveCluster(label: string, clusterId: string | null): Promise<void> {
  return invoke("set_active_cluster", { label, clusterId });
}

export function renameCluster(clusterId: string, name: string): Promise<void> {
  return invoke("rename_cluster", { clusterId, name });
}

export function closeCluster(clusterId: string): Promise<void> {
  return invoke("close_cluster", { clusterId });
}

// --- windows ----------------------------------------------------------------

/** Drag a tab clear of its window. The gesture that makes a second window. */
export function detachInstance(instanceId: string): Promise<void> {
  return invoke("detach_instance", { instanceId });
}

/**
 * Move a whole cluster — its chip and its entire pane tree — to another window.
 *
 * `toLabel` names a window that is already open; `null` asks for a new one. That
 * distinction is the caller's because only the caller knows what the drop meant:
 * `windowAtCursor` answering with *this* window is a release over the window the
 * cluster is already in, which asks for a new one rather than a move to itself.
 *
 * A cluster can be moved into another window where a single tab cannot, and the
 * asymmetry is deliberate — see `commitCluster` in `drag/useDrag.tsx`.
 *
 * The last cluster in a window may be moved out, leaving that window with none
 * and drawing `NoClustersState` beside an untouched terminal panel — the panel
 * belongs to the window, not to any cluster. Refusing this hid the chip's drag
 * handle exactly where someone reaches for it; see `move_cluster_pure`.
 *
 * Rejects when no window holds `clusterId` — it was closed between the release
 * and this call. The drag layer reports that rather than dropping it; a detach
 * that quietly does nothing is the hardest failure here to see from outside.
 */
export function detachCluster(clusterId: string, toLabel: string | null): Promise<void> {
  return invoke("detach_cluster", { clusterId, toLabel });
}

/**
 * Close this window on purpose.
 *
 * Goes through the backend rather than calling `getCurrentWindow().close()`,
 * and that indirection is load-bearing: it is the only thing separating a
 * deliberate close from the application shutting down. `Destroyed` fires for
 * every window at shutdown, so without the announcement HELVE would fold every
 * window into `main` on the way out and save that as the layout to restore.
 */
export function closeWindow(label: string): Promise<void> {
  return invoke("close_window", { label });
}

/**
 * Open a new, empty window.
 *
 * Distinct from `detachInstance`, which makes a window by *moving* a tab into
 * it. This one takes nothing from the window you are in — what File > New Window
 * always claimed to do, and could not until labels stopped naming a surface.
 */
export function newWindow(): Promise<void> {
  return invoke("new_window");
}

export function setWindowGeometry(label: string, geometry: WindowGeometry): Promise<void> {
  return invoke("set_window_geometry", { label, geometry });
}

/**
 * Which HELVE window the cursor is over, or `null` if it is over none of them.
 *
 * The drag layer calls this on drop, to find out which window's panel a terminal
 * was released over. It has to be a backend call: every window is a separate
 * webview with its own DOM, so the page holding the drag can see neither another
 * window's geometry nor the cursor once it leaves its own edge.
 */
export function windowAtCursor(): Promise<string | null> {
  return invoke<string | null>("window_at_cursor");
}

/**
 * Drop a terminal into any HELVE window's terminal band, including this one.
 *
 * Still named by *window*, because a window is the only thing `windowAtCursor`
 * can identify — it hit-tests screen rectangles, and a cluster has none. Rust
 * resolves the label to whatever cluster that window is showing, under the same
 * lock as the move, so this cannot act on a stale answer.
 *
 * Dropping onto the band it is already in is not a no-op. A terminal dragged
 * out of a pane and back onto the band takes this path, and leaving the tree is
 * the half of the move that matters.
 */
export function moveTerminal(id: string, toLabel: string): Promise<void> {
  return invoke("move_terminal", { id, toLabel });
}

/** Which terminal a cluster's band is showing. */
export function setActiveTerminal(clusterId: string, id: string | null): Promise<void> {
  return invoke("set_active_terminal", { clusterId, id });
}

/** An app naming its own tab — "Files" becoming `client.ts`. */
export function setInstanceTitle(instanceId: string, title: string): Promise<void> {
  return invoke("set_instance_title", { instanceId, title });
}
