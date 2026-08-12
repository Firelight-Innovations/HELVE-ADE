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
import type { EngineState } from "../contract";
import { isFake, fakeShellState } from "./fakeBackend";

/** Mirrors `shell_state::WindowPlacement`. */
export interface WindowPlacement {
  label: string;
  toolIds: string[];
  activeToolId: string | null;
}

/** Mirrors `shell_state::TerminalSession`. */
export interface TerminalSessionState {
  id: string;
  title: string;
  windowLabel: string;
  agentFinished: boolean;
}

/** Mirrors `shell_state::ShellSnapshot`. */
export interface ShellSnapshot {
  windows: WindowPlacement[];
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
      setSnapshot(fakeShellState());
      return;
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

export function setDockedTools(label: string, toolIds: string[]): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("set_docked_tools", { label, toolIds });
}

export function setActiveTool(label: string, toolId: string | null): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("set_active_tool", { label, toolId });
}

/** Drag a tab clear of the switcher bar. The only way a tool detaches. */
export function detachTool(toolId: string): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("detach_tool", { toolId });
}

export function createTerminal(label: string): Promise<string> {
  if (isFake()) return Promise.resolve("term-fake");
  return invoke<string>("create_terminal", { label });
}

export function closeTerminal(id: string): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("close_terminal", { id });
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

/** Drop a terminal into any HELVE window's panel, including this one. */
export function moveTerminal(id: string, toLabel: string): Promise<void> {
  if (isFake()) return Promise.resolve();
  return invoke("move_terminal", { id, toLabel });
}
