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
 * Mirrors `apps::AppInfo` — one first-party app, as the switcher needs it.
 *
 * Note what an app has that a tool doesn't, and vice versa. There is a `url`
 * here because an app's frontend is built by this repo and its address is known
 * without asking the filesystem anything; a tool's has to be resolved on demand
 * (`tool_frontend`) because its dev server can come and go. There is no
 * `status` here because an app ships in the binary — it cannot be missing, and
 * it cannot disagree with a pinned version it doesn't have.
 */
export interface AppInfo {
  id: string;
  name: string;
  description: string;
  /** Root-relative, so it resolves against whatever origin the shell is on. */
  url: string;
}

/**
 * Every app this build ships. Compiled into the binary, so unlike `loadStack`
 * this answers the same thing every time and is worth asking exactly once.
 */
export function listApps(): Promise<AppInfo[]> {
  return invoke<AppInfo[]>("list_apps");
}

/**
 * Forward one `invoke` from an app's iframe to that app's Rust half.
 *
 * Called by `ToolWindow`, which is the only thing that knows which mounted
 * frame a message came from, and never by an app itself — an app calls
 * `invoke` from `@helve/bridge` and the shell relays it here. A rejection
 * carries `{ code, message, data? }`, the JSON-RPC error object the bridge
 * turns back into a `HelveRpcError`.
 */
export function appCall(id: string, method: string, params?: unknown): Promise<unknown> {
  return invoke<unknown>("app_call", { id, method, params });
}

/**
 * Tell the backend that a first-party app's UI has drawn its first meaningful
 * frame.
 *
 * Called by `ToolWindow` when an app frame sends `helve/painted`, and by
 * nothing else: the id is the one the shell resolved from the frame the message
 * arrived on, never one an app named for itself. Boot holds the splash window
 * until every app has reported (`src-tauri/src/boot.rs`), so this is what
 * decides that the first frame after the splash is the real Home rather than
 * the boot overlay laid over it.
 */
export function appPainted(id: string): Promise<void> {
  return invoke<void>("app_painted", { id });
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
