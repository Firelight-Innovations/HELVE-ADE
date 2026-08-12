/**
 * Typed bridge to the Rust backend.
 *
 * These types mirror the `#[derive(Serialize)]` structs in `src-tauri/src/`.
 * They are hand-maintained: change a Rust struct, change it here too. (If that
 * ever gets tedious, `tauri-specta` can generate this file from the Rust types
 * instead — worth adopting once the command surface stops moving.)
 *
 * Everything below crosses the IPC boundary as JSON, so keep it to plain data.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrors `tool::ToolKind`. */
export type ToolKind = "runtime" | "dev-tool";

/**
 * Mirrors `tool::ToolStatus`.
 *
 * Rust serializes this enum with an internal `state` tag, which lands here as a
 * discriminated union — narrow on `status.state` and TypeScript gives you the
 * right extra fields.
 */
export type ToolStatus =
  | { state: "ready"; version: string }
  | { state: "mismatch"; expected: string; found: string }
  | { state: "unversioned" }
  | { state: "missing" };

/** Mirrors `tool::ResolvedTool` (with `ToolSpec` flattened into it). */
export interface ResolvedTool {
  id: string;
  name: string;
  kind: ToolKind;
  repo: string;
  /** The version pinned in helve.toml. */
  version: string;
  description: string;
  path: string | null;
  status: ToolStatus;
  checkoutPath: string;
  isGitRepo: boolean;
}

/** Mirrors `discovery::StackSnapshot`. */
export interface StackSnapshot {
  stackName: string;
  stackVersion: string;
  manifestPath: string;
  checkoutRoot: string;
  tools: ResolvedTool[];
}

/** Re-read helve.toml and re-scan the disk. Also serves as "refresh". */
export function loadStack(): Promise<StackSnapshot> {
  return invoke<StackSnapshot>("load_stack");
}

/** The last snapshot, without touching the disk. Null before the first load. */
export function cachedStack(): Promise<StackSnapshot | null> {
  return invoke<StackSnapshot | null>("cached_stack");
}

/** Show a tool's checkout in the OS file manager. */
export function revealTool(id: string): Promise<void> {
  return invoke<void>("reveal_tool", { id });
}

/**
 * Mirrors `boot::BootStatus`.
 *
 * Same internally tagged shape as `ToolStatus` above, but keyed on `phase`
 * instead of `state` — this describes a phase of the whole app's startup,
 * not a single tool's discovery result, so it gets its own tag name. `Ready`
 * carries no fields: the snapshot it represents is fetched separately with
 * `cachedStack`, not sent again over the event.
 */
export type BootStatus =
  | { phase: "working"; step: number; total: number; label: string }
  | { phase: "ready" }
  | { phase: "failed"; message: string };

/**
 * Subscribe to boot progress events emitted from the Rust side while the
 * splash window is up. `listen` itself resolves to an "unlisten" function
 * rather than unsubscribing via some separate call, so this hands that
 * function straight back — callers stash it and invoke it from a React
 * `useEffect` cleanup to stop listening on unmount.
 */
export function onBootStatus(cb: (status: BootStatus) => void): Promise<UnlistenFn> {
  return listen<BootStatus>("boot:status", (event) => cb(event.payload));
}

/**
 * Show the main window and close the splash. Safe to call more than once —
 * see `boot::finish` on the Rust side for why.
 */
export function finishBoot(): Promise<void> {
  return invoke<void>("finish_boot");
}

/**
 * The latest boot status, fetched directly instead of waited for over
 * `onBootStatus`. Tauri events have no replay buffer, so a listener
 * registered after boot already emitted something simply never sees that
 * event — the splash window's own load (webview init, React mount, the
 * effect that calls `listen`) is routinely slower than the backend's
 * filesystem work, so this gap is the common case, not an edge case. Call
 * this once on mount, *after* `onBootStatus` has already subscribed, to
 * catch up on whatever was missed. See `Splash.tsx` for how the two are
 * reconciled without trading that race for the opposite one (a late poll
 * response overwriting a newer event).
 */
export function bootStatus(): Promise<BootStatus> {
  return invoke<BootStatus>("boot_status");
}
