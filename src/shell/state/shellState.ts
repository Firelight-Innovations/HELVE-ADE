/**
 * The frontend half of the shared shell state.
 *
 * Mirrors `src-tauri/src/shell_state.rs`. Placement and terminal sessions are
 * owned by the backend because more than one window has to agree on them; this
 * is how a window subscribes to that agreement.
 *
 * Deliberately not a store. Every window is a projection of one broadcast
 * object, so there is nothing to reconcile and nothing to merge — the last
 * `shell:state` event is the truth, and `useShellState` just re-renders with
 * it.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Cluster, EngineState, SplitDir, SurfaceInstance } from "../contract";
// `fakeLayout` is the no-backend stand-in for every mutation below. It is a
// real, mutating model rather than a set of no-ops, and that matters more here
// than it sounds: browser verification has been unreachable in this
// environment, so `?fake=1` is the only way any of this layout work can be
// clicked through at all. `fakeBackend`'s own comments record what a fixture
// that merely *looked* right once cost — a hardcoded dock list that disagreed
// with `ShellState::default` hid an empty-switcher bug for the fixture's whole
// life.
import { isFake, subscribeFakeShellState, fakeLayout as fake } from "./fakeBackend";

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
  /**
   * Which terminal this window's panel is showing.
   *
   * The window's, not any cluster's, because the panel does not change when you
   * switch clusters. Rust re-establishes after every mutation that this names
   * one of this window's panel terminals and never one that has been dragged
   * into a pane tree, so the frontend can render it without re-checking.
   */
  activeTerminal: string | null;
  geometry: WindowGeometry | null;
}

/**
 * Mirrors `shell_state::TerminalSession`.
 *
 * `windowLabel`, not a cluster id: the panel belongs to the window, so a
 * terminal opened in it stays there whichever cluster is on screen above it.
 * That is what makes a terminal useful across clusters — orchestrating, or
 * working between worktrees — instead of disappearing with the tab you happened
 * to have open when you pressed `+`.
 *
 * It says where the terminal lives *in a panel*. A terminal dragged into a
 * cluster's pane tree is drawn there instead and the panel stops listing it;
 * this still records which window's panel it would return to.
 */
export interface TerminalSessionState {
  id: string;
  title: string;
  windowLabel: string;
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
    if (isFake()) {
      // A subscription, not a one-shot read — `state/terminals.ts`'s fake
      // control functions mutate the fake terminal list on create/split/
      // close, and this is what makes that show up here instead of sitting
      // invisible until a remount.
      return subscribeFakeShellState(setSnapshot);
    }

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
 * lands in; omitted, it falls back to the active cluster's first pane. That
 * distinction is the change: this used to say "omitted means the first pane,
 * which is what the Apps menu wants — someone asking for another Files has no
 * opinion about which pane receives it", and the Apps menu now very much has
 * one. Opening puts the new surface in a pane of its *own*, splitting the
 * focused one, because dropping it in as another tab looked on screen like it
 * had replaced what was there.
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
  if (isFake()) return fake.openInstance(label, appId, paneId, dir);
  return invoke<string>("open_instance", {
    label,
    appId,
    paneId: paneId ?? null,
    dir: dir ?? null,
  });
}

export function closeInstance(instanceId: string): Promise<void> {
  if (isFake()) return fake.closeInstance(instanceId);
  return invoke("close_instance", { instanceId });
}

export function activateInstance(instanceId: string): Promise<void> {
  if (isFake()) return fake.activateInstance(instanceId);
  return invoke("activate_instance", { instanceId });
}

/** Reorder within a strip, or move a tab into another pane or window. */
export function moveInstance(
  instanceId: string,
  clusterId: string,
  paneId: string,
  index: number | null,
): Promise<void> {
  if (isFake()) return fake.moveInstance(instanceId, clusterId, paneId, index);
  return invoke("move_instance", { instanceId, clusterId, paneId, index });
}

/** Drop a tab on a pane's edge: split there, and put it in the new half. */
export function splitPane(
  paneId: string,
  dir: SplitDir,
  instanceId: string,
  before: boolean,
): Promise<void> {
  if (isFake()) return fake.splitPane(paneId, dir, instanceId, before);
  return invoke("split_pane", { paneId, dir, instanceId, before });
}

/** What a divider drag commits on release. Weights, not pixels. */
export function setPaneSizes(splitId: string, sizes: number[]): Promise<void> {
  if (isFake()) return fake.setPaneSizes(splitId, sizes);
  return invoke("set_pane_sizes", { splitId, sizes });
}

// --- clusters ---------------------------------------------------------------

export function addCluster(label: string, name: string): Promise<string | null> {
  if (isFake()) return fake.addCluster(label, name);
  return invoke<string | null>("add_cluster", { label, name });
}

export function setActiveCluster(label: string, clusterId: string | null): Promise<void> {
  if (isFake()) return fake.setActiveCluster(label, clusterId);
  return invoke("set_active_cluster", { label, clusterId });
}

export function renameCluster(clusterId: string, name: string): Promise<void> {
  if (isFake()) return fake.renameCluster(clusterId, name);
  return invoke("rename_cluster", { clusterId, name });
}

export function closeCluster(clusterId: string): Promise<void> {
  if (isFake()) return fake.closeCluster(clusterId);
  return invoke("close_cluster", { clusterId });
}

// --- windows ----------------------------------------------------------------

/** Drag a tab clear of its window. The gesture that makes a second window. */
export function detachInstance(instanceId: string): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("detach_instance", { instanceId });
}

/**
 * Move a whole cluster — its chip and its entire pane tree — to another window.
 *
 * `toLabel` names a window that is already open; `null` asks for a new one.
 * That distinction is the caller's because only the caller knows what the drop
 * meant: `windowAtCursor` answering with *this* window is a release over the
 * window the cluster is already in, which is a request for a new window and not
 * a request to move it where it already is.
 *
 * A cluster can be moved into another window where a single tab cannot, and the
 * asymmetry is deliberate — see `commitCluster` in `drag/useDrag.tsx`.
 *
 * The last cluster in a window may be moved out, leaving that window with none
 * and drawing `NoClustersState` beside a terminal panel that is untouched — the
 * panel belongs to the window rather than to any cluster. This was refused until
 * recently, on both sides, which meant the bar hid the chip's drag handle
 * whenever a window held one cluster and the gesture went missing exactly where
 * someone would reach for it. See `move_cluster_pure` in `shell_state.rs`.
 *
 * Rejects when no window holds `clusterId` — it was closed between the release
 * and this call. The drag layer reports that rather than dropping it; a detach
 * that quietly does nothing is the hardest failure here to see from outside.
 */
export function detachCluster(clusterId: string, toLabel: string | null): Promise<void> {
  if (isFake()) return fake.detachCluster(clusterId, toLabel);
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
  if (isFake()) return Promise.resolve();
  return invoke("close_window", { label });
}

/**
 * Open a new, empty window.
 *
 * Distinct from `detachInstance`, which makes a window by *moving* a tab into
 * it. This one takes nothing from the window you are in, which is what File >
 * New Window has always claimed to do and could not until window labels stopped
 * being derived from the surface inside them.
 */
export function newWindow(): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("new_window");
}

export function setWindowGeometry(label: string, geometry: WindowGeometry): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("set_window_geometry", { label, geometry });
}

/**
 * Which HELVE window the cursor is over, or `null` if it is over none of them.
 *
 * The drag layer calls this on drop, to find out which window's panel a
 * terminal was released over. It has to be a backend call: every window is a
 * separate webview with its own DOM, so the page holding the drag can see
 * neither another window's geometry nor the cursor once it leaves its own
 * edge. Only the process that owns all the windows can hit-test across them.
 *
 * Under `?fake=1` there is one window and no backend, so this answers with
 * this window's own label — which exercises the same-window drop path rather
 * than pretending a second window exists.
 */
export function windowAtCursor(): Promise<string | null> {
  if (isFake()) return Promise.resolve(windowLabel());
  return invoke<string | null>("window_at_cursor");
}

/**
 * Drop a terminal into any HELVE window's panel, including this one.
 *
 * Named by *window*, because a window is the only thing `windowAtCursor` can
 * identify — it hit-tests screen rectangles, and a panel has none. That is also
 * what a panel belongs to now, so there is nothing left to resolve: the label is
 * the destination.
 *
 * Dropping onto the panel it is already in is not a no-op. A terminal dragged
 * out of a pane and back onto the panel takes this path, and leaving the tree is
 * the half of the move that matters.
 */
export function moveTerminal(id: string, toLabel: string): Promise<void> {
  if (isFake()) return fake.moveTerminal(id, toLabel);
  return invoke("move_terminal", { id, toLabel });
}

/** Which terminal a window's panel is showing. */
export function setActiveTerminal(label: string, id: string | null): Promise<void> {
  if (isFake()) return fake.setActiveTerminal(label, id);
  return invoke("set_active_terminal", { label, id });
}

/** An app naming its own tab — "Files" becoming `client.ts`. */
export function setInstanceTitle(instanceId: string, title: string): Promise<void> {
  if (isFake()) return fake.setInstanceTitle(instanceId, title);
  return invoke("set_instance_title", { instanceId, title });
}
