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

/** Mirrors `apps::OpenableKind`. How the shell opens the thing, in one word. */
export type OpenableKind = "app" | "terminal";

/**
 * Mirrors `apps::Openable` — one row in the Apps menu.
 *
 * **Note what is missing next to `AppInfo`: a `url`.** That absence is the
 * entire reason this is a separate type, and it is load-bearing rather than
 * tidy. A terminal has no frontend — no Vite entry point, no iframe, no origin —
 * it is an xterm canvas the shell draws itself, bound to a pty by id. And
 * `state/toolFrontend.ts` resolves a *mountable URL* by looking an id up in the
 * `AppInfo` list, so a terminal in that list with an empty `url` would mount a
 * blank iframe over every terminal in the window.
 *
 * So the two lists stay apart: `AppInfo` is "things with a frontend", this is
 * "things you can open". `kind` is what the caller routes on.
 */
export interface Openable {
  id: string;
  name: string;
  description: string;
  kind: OpenableKind;
}

/**
 * Everything the Apps menu offers: every app, then a terminal. Compiled in, so
 * — like `listApps` — this is worth asking exactly once.
 */
export function listOpenables(): Promise<Openable[]> {
  return invoke<Openable[]>("list_openables");
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
export function appCall(
  id: string,
  method: string,
  params?: unknown,
  scope?: CallScope,
): Promise<unknown> {
  return invoke<unknown>("app_call", {
    id,
    instanceId: scope?.instanceId ?? null,
    clusterId: scope?.clusterId ?? null,
    method,
    params,
  });
}

/**
 * Which surface a call is on behalf of — mirrors `apps::CallContext`'s two
 * inputs.
 *
 * `id` above names the app, which is the code that answers. This names *where*
 * it is answered: Rust resolves the instance to the cluster whose pane tree
 * holds it, and that cluster to its project. Two Files in two clusters are
 * indistinguishable without it, and both would root at whichever project
 * answered first.
 *
 * `instanceId` is what `ToolWindow` passes, and it is the trustworthy one — the
 * shell resolves it from `event.source` against its own map of mounted iframes,
 * never from anything a frame asserts about itself.
 *
 * `clusterId` is for the shell's own calls, which are not a frame's request at
 * all: File > Open… is a title-bar menu item with no instance behind it, and
 * the window it was clicked in knows perfectly well which cluster it is
 * showing. It loses to a resolved instance where both are given.
 */
export interface CallScope {
  instanceId?: string;
  clusterId?: string;
}

/**
 * Mirrors `project::ProjectInfo` — one project, as the shell needs to see it.
 *
 * Only the fields the shell itself reads. Home's own frontend takes the whole
 * thing over transport B and has its own copy of the shape; this is the title
 * bar's much smaller need.
 */
export interface ProjectInfo {
  name: string;
  path: string;
}

/**
 * One cluster's project, for the title bar.
 *
 * The shell's own read, where it used to borrow Home's `home/state`. That
 * method answers the *calling surface's* cluster, which is the wrong scope
 * here: the bar names whichever cluster the window is showing, and that changes
 * with a click on a chip rather than with anything a frame does.
 *
 * `null` for a cluster with no project, for a `clusterId` naming nothing, and
 * for a window showing no cluster at all. The bar draws the same thing for all
 * three, so a richer answer would be a distinction with nowhere to show.
 */
export function clusterProject(clusterId: string | null): Promise<ProjectInfo | null> {
  return invoke<ProjectInfo | null>("cluster_project", { clusterId });
}

/**
 * Point a cluster at a project, or at nothing, without going through Home.
 *
 * The primitive under Home's methods, which are the ones a person reaches —
 * those raise a picker, touch the Recent list, and initialize a folder that
 * needs it. Nothing in the shell calls this today; it is registered because
 * the layout has to be able to say so on its own, and because a cluster's
 * project being settable only from inside an app frame would be a strange
 * place for the authority to live.
 */
export function setClusterProject(clusterId: string, path: string | null): Promise<void> {
  return invoke("set_cluster_project", { clusterId, path });
}

/**
 * Where a cluster's work is happening on disk. Mirrors `shell_state::
 * WorktreeRef`.
 *
 * The *binding* — a pointer a cluster stores at a checkout — as distinct from
 * [`GitWorktree`], which is what git reports about the checkout itself. A
 * worktree exists whether or not a cluster is pointed at it, and a cluster
 * holding this is claiming one of them, not describing it.
 *
 * Re-exported from `shell/contract.ts`, which is where the shell reads it; it
 * is declared here because this is the file that mirrors Rust, and `contract`
 * imports from `bindings` rather than the other way round.
 */
export interface WorktreeRef {
  path: string;
  /** `null` for a detached HEAD — a state HELVE never creates but can find. */
  branch: string | null;
}

/**
 * One entry from `git worktree list`. Mirrors `git::GitWorktree`.
 *
 * See [`WorktreeRef`] for the distinction between this and what a cluster
 * stores.
 */
export interface GitWorktree {
  /** Absolute, in the form git prints it — forward slashes, even on Windows. */
  path: string;
  /** Short name, `refs/heads/` already stripped. `null` for a detached HEAD. */
  branch: string | null;
  head: string;
  /** The primary checkout — the project folder itself, which git lists first. */
  isMain: boolean;
  locked: boolean;
}

/**
 * One commit, as the graph draws it. Mirrors `git::GitCommit`.
 *
 * `parents` is what makes this a graph rather than a list — the frontend works
 * out lanes and connectors from it, because where a line bends is a layout
 * question and answering it in Rust would push a rendering decision through the
 * IPC boundary.
 */
export interface GitCommit {
  sha: string;
  /** Git's own abbreviation, length-adjusted per repository to stay unambiguous. */
  short: string;
  summary: string;
  author: string;
  /** Author time, Unix **seconds** — not milliseconds. Multiply before `new Date`. */
  when: number;
  /** Empty for a root commit, one normally, two or more for a merge. */
  parents: string[];
  /** Local branch names pointing here, `refs/heads/` already stripped. */
  refs: string[];
}

/**
 * The repository's local branches as one graph, newest first.
 *
 * Local only: remote-tracking refs would multiply the rows to draw history
 * nobody in this window is working on, and the drift that does matter already
 * shows as ahead/behind on the status. An empty array covers "no project", "not
 * a repository" and "no commits yet" alike.
 *
 * `limit` is a hard row cap rather than a page size — there is no cursor here,
 * and a graph is a thing you scan rather than page through.
 */
export function gitGraph(clusterId: string, limit: number): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_graph", { clusterId, limit });
}

/**
 * Every worktree of a cluster's repository, the project's own checkout first.
 *
 * Cluster-scoped rather than path-scoped for the same reason the source control
 * commands are tool-scoped: the frontend never names a directory for the
 * backend to run `git` in. An empty array covers all three of "no project",
 * "project is not a repository", and "a repository with no extra worktrees" —
 * the graph draws the same thing for each, so separating them would be a
 * distinction with nowhere to show.
 */
export function gitWorktrees(clusterId: string): Promise<GitWorktree[]> {
  return invoke<GitWorktree[]>("git_worktrees", { clusterId });
}

/**
 * Cut a branch from the current HEAD, check it out into a new worktree beside
 * the project, and point the cluster at it.
 *
 * Rejects rather than overwrites when the name is taken, so a caller can offer
 * the error verbatim — the backend's messages are written to be read by whoever
 * typed the name.
 */
export function gitWorktreeCreate(clusterId: string, name: string): Promise<WorktreeRef> {
  return invoke<WorktreeRef>("git_worktree_create", { clusterId, name });
}

/**
 * Discard a cluster's worktree and return it to working in its project. The
 * branch and its commits survive; only the checkout on disk goes.
 *
 * `force` overrides git's refusal to remove a worktree holding uncommitted
 * changes. Do not pass `true` without having asked the user: that refusal is
 * the last thing between a click and work that exists in no other copy.
 */
export function gitWorktreeRemove(clusterId: string, force: boolean): Promise<void> {
  return invoke("git_worktree_remove", { clusterId, force });
}

/**
 * Drop a cluster's worktree binding if the checkout behind it is gone, and
 * report what it is bound to afterwards.
 *
 * Worth calling on a cluster switch and after anything that could have removed
 * a directory from outside HELVE. Cheap — a `is_dir` check, and a git spawn
 * only in the case where the answer turns out to be "gone".
 */
export function gitWorktreeReconcile(clusterId: string): Promise<WorktreeRef | null> {
  return invoke<WorktreeRef | null>("git_worktree_reconcile", { clusterId });
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
