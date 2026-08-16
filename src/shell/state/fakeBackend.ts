/**
 * The shell, running with no Tauri underneath it.
 *
 * `pnpm dev` in a plain browser has no `invoke` and no event system, so every
 * backend call throws and the shell renders nothing. That matters more than it
 * sounds: the verification pass measures real geometry with
 * `getBoundingClientRect`, and it cannot measure a window it cannot open.
 * Driving the packaged Tauri app instead is not an option here — `tauri dev`
 * orphans the Vite server on port 1420 when it exits.
 *
 * So: `?fake=1` swaps every backend read for a fixture and every write for a
 * no-op. The fixtures are the handoff's own screens — six tools with Turner
 * needing an update and Wright not installed, which is exactly the state that
 * produces the warning badge's "2".
 *
 * This is a development and verification affordance, not a demo mode. Nothing
 * in the shipped app reads it: `isFake()` is false unless the query is present,
 * and a packaged build has no way to set it.
 */
import type { AppInfo, CallScope, Openable, ResolvedTool, StackSnapshot } from "../../bindings";
import type {
  Cluster,
  GitControl,
  GitFileChange,
  GitStatus,
  LayoutPreset,
  PaneNode,
  PresetNode,
  PresetSlot,
  SplitDir,
  SurfaceInstance,
} from "../contract";
// The error-code table, by relative path for the same reason `ToolWindow`
// reaches for it that way: the shell must not import the bridge's *client*,
// which is the tool half of transport B and touches `window.parent` at module
// load. A table of numbers has no such side effect.
import { HelveErrorCode } from "../../../packages/bridge/src/errors";
import type { ShellSnapshot, TerminalSessionState, WindowPlacement } from "./shellState";

let cached: boolean | null = null;

export function isFake(): boolean {
  if (cached === null) {
    cached = new URLSearchParams(window.location.search).get("fake") === "1";
  }
  return cached;
}

/**
 * The six dev-tools from helve.toml, in manifest order, with two of them
 * unhealthy — matching the handoff's default screen. `engine` is included
 * because the real snapshot includes it; the switcher filters it out, and this
 * fixture would hide a bug in that filter if it left it out too.
 */
export function fakeStack(): StackSnapshot {
  const tool = (
    id: string,
    name: string,
    description: string,
    status: ResolvedTool["status"],
    kind: ResolvedTool["kind"] = "dev-tool",
  ): ResolvedTool => ({
    id,
    name,
    kind,
    repo: `https://github.com/Firelight-Innovations/helve-${id}`,
    version: "0.1.0",
    description,
    path: null,
    status,
    checkoutPath: `../${id}`,
    isGitRepo: true,
  });

  return {
    stackName: "Helve",
    stackVersion: "0.1.0",
    manifestPath: "helve.toml",
    checkoutRoot: "..",
    tools: [
      tool(
        "engine",
        "Helve Engine",
        "Runtime core — lighting, audio playback, spatial audio built in.",
        { state: "ready", version: "0.1.0" },
        "runtime",
      ),
      tool("forger", "Forger", "Technical design software — specs out the stack and its boundaries.", {
        state: "ready",
        version: "0.1.0",
      }),
      tool("journeyman", "Journeyman", "Game design software — design prototyping, rough playable systems.", {
        state: "ready",
        version: "0.1.0",
      }),
      // "needs update" in the health list.
      tool("turner", "Turner", "Procedural art system — generates art from an artist's rough shape.", {
        state: "mismatch",
        expected: "0.1.0",
        found: "0.0.9",
      }),
      tool("scrivener", "Scrivener", "Narrative and dialogue authoring tool.", {
        state: "ready",
        version: "0.1.0",
      }),
      tool("quickener", "Quickener", "NPC behavior and AI tooling.", { state: "ready", version: "0.1.0" }),
      // "not installed" — renders dim and inert.
      tool("wright", "Wright", "Audio authoring and composition tooling.", { state: "missing" }),
    ],
  };
}

/**
 * The apps `apps::REGISTRY` compiles in, restated.
 *
 * Unlike the tool fixture above, these are not stand-ins. The URLs are the real
 * ones, they point at the real app entry points, and Vite serves them in a plain
 * browser exactly as Tauri's asset host does in the packaged app — so `?fake=1`
 * mounts the actual Home and Files frontends and runs their actual handshake.
 * Only their `invoke` calls have no backend to reach; `callApp` answers those
 * with an error, and the apps render their failure path.
 *
 * This list is the one thing here that can drift from Rust without anything
 * noticing, since it is a copy of a table in another language. Kept to id, name
 * and description on purpose — the smallest thing the switcher needs — so that
 * when it does drift, what is stale is a label rather than behaviour.
 */
export function fakeApps(): AppInfo[] {
  return [
    {
      id: "home",
      name: "Home",
      description: "Where a session starts — the stack at a glance.",
      url: "/apps/home/ui/index.html",
    },
    {
      id: "files",
      name: "Files",
      description: "Browse and read the files of the open checkout.",
      url: "/apps/files/ui/index.html",
    },
  ];
}

/**
 * `apps::openables`, restated — every app, then a terminal.
 *
 * A separate fixture from `fakeApps` because it is a separate list in Rust, for
 * the reason `bindings.ts`'s `Openable` sets out: an app has a frontend URL and
 * a terminal has none, and the shell resolves a *mountable* address by looking
 * an id up in the app list. A fixture that merged the two here would mount a
 * blank iframe over every terminal under `?fake=1` and nowhere else, which is
 * the worst kind of disagreement — one that only shows up in the packaged app.
 *
 * Derived from `fakeApps()` rather than written out again, so the one list that
 * *is* a copy of a Rust table stays the only one.
 */
export function fakeOpenables(): Openable[] {
  return [
    ...fakeApps().map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      kind: "app" as const,
    })),
    {
      id: "terminal",
      name: "Terminal",
      description: "A shell in a pane of this cluster, rather than in the panel.",
      kind: "terminal" as const,
    },
  ];
}

// --- the fake project store --------------------------------------------------
//
// Home is the first app worth answering under `?fake=1`. It is what the shell
// opens on, its layout is the thing most worth measuring in a browser, and every
// state it can be in — a project open, none open, a recent whose folder has gone
// — is a *layout*, which is exactly what this fixture exists to make reachable.
//
// **A project belongs to a cluster here exactly as it does in Rust.** The open
// project is not a variable in this section; it is `Cluster.project` on the
// windows further down, read and written through the two helpers below. That is
// not fidelity for its own sake: the whole feature is that two clusters hold two
// projects, and a fixture with one global would make the one thing worth
// clicking through unclickable while still rendering something plausible. This
// file's own history is the argument — a hardcoded dock list that *looked* right
// hid a real empty-switcher bug for as long as it existed.
//
// Every method below therefore takes the same `scope` the real `app_call` takes,
// and resolves it the way `apps::CallContext::resolve` does: an instance id
// wins, resolved against the pane trees; an explicit cluster id is the fallback
// for the shell's own calls; neither means no cluster, and no cluster means the
// same refusals Rust gives.
//
// Files used to be left rejecting, on the argument that a fake filesystem is a
// much larger lie than a fake list of four projects — it would have to invent
// sizes, nesting and read errors, none of which the pane's geometry depended on.
// That was true until the pane grew a tree, a splitter, tabs, a filter, an icon
// resolver and five viewers, every one of them frontend and none of them
// reachable without a filesystem to point at. It is answered now, from the
// section further down; that section's own note says what the lie still is.
//
// The three actions that open a *native folder picker* are not faked either.
// There is no picker in a browser, and inventing a folder the user did not
// choose would make this fixture disagree with the backend in the direction of
// looking healthier — the exact failure that hid the empty switcher bar. They
// reject, and Home draws the error path it would draw for any other refusal.

/**
 * Where the file tree further down says each project starts.
 *
 * Declared here, above the Recent list that names them, rather than beside the
 * tree they describe — a `const` is not hoisted, and the list is a top-level
 * array evaluated at module load.
 *
 * **There are two, and the second exists for one reason.** A project belongs to
 * a cluster now, so the thing worth being able to see is two Files side by side
 * rooted at two different folders — and that is not visible in a fixture with
 * one tree in it, however faithfully every other rule is copied. `borealis` is
 * deliberately small: its job is to be unmistakably *not* aurora at a glance,
 * not to exercise the viewers a second time.
 */
const AURORA_ROOT = "C:\\projects\\aurora";
const BOREALIS_ROOT = "C:\\projects\\borealis";

interface FakeProject {
  name: string;
  path: string;
  id: string | null;
  initialized: boolean;
  exists: boolean;
  lastOpened: number | null;
  modified: number | null;
}

const HOUR = 3_600_000;

let fakeProjects: FakeProject[] = [
  // The two with a file tree behind them (see `AURORA_ROOT` and
  // `BOREALIS_ROOT`). They are first in the list because they are the two rows
  // worth clicking: open one into each cluster and the two Files beside each
  // other root at two different trees, which is the whole feature and is
  // otherwise not visible in a browser at all. Every other row below exercises
  // a *Home* state and has no tree, which `fakeDefaultRoot` explains.
  {
    name: "Aurora",
    path: AURORA_ROOT,
    id: "0000000000000001a1b2c3d4e5f60001",
    initialized: true,
    exists: true,
    lastOpened: Date.now() - 2 * HOUR,
    modified: Date.now() - HOUR,
  },
  {
    name: "Borealis",
    path: BOREALIS_ROOT,
    id: "0000000000000002a1b2c3d4e5f60002",
    initialized: true,
    exists: true,
    lastOpened: Date.now() - 5 * HOUR,
    modified: Date.now() - 3 * HOUR,
  },
  {
    name: "Torn Apart",
    path: "C:\\Users\\bjsea\\Documents\\games\\Torn Apart",
    id: "0000000000000003a1b2c3d4e5f60003",
    initialized: true,
    exists: true,
    lastOpened: Date.now() - 3 * 24 * HOUR,
    modified: Date.now() - 4 * 24 * HOUR,
  },
  // A folder HELVE was pointed at that was never set up — the "adopt" path.
  {
    name: "prototype-scratch",
    path: "C:\\Users\\bjsea\\Documents\\games\\prototype-scratch",
    id: null,
    initialized: false,
    exists: true,
    lastOpened: Date.now() - 9 * 24 * HOUR,
    modified: Date.now() - 9 * 24 * HOUR,
  },
  // A project whose folder has since moved or been deleted.
  {
    name: "Old Jam Entry",
    path: "D:\\jam\\Old Jam Entry",
    id: "0000000000000005a1b2c3d4e5f60005",
    initialized: false,
    exists: false,
    lastOpened: Date.now() - 200 * 24 * HOUR,
    modified: null,
  },
];

/**
 * Which cluster a call is on behalf of. Mirrors `apps::CallContext::resolve`,
 * including the precedence.
 *
 * The instance wins because in Rust it is the trustworthy input — the shell
 * resolved it from `event.source` against its own map of mounted iframes, where
 * an explicit cluster id is something a caller stated. Faking the precedence
 * the other way round would let this fixture succeed on calls the backend
 * answers differently, which is the direction of disagreement this file is
 * least willing to have.
 */
function fakeClusterOf(scope?: CallScope): string | null {
  const fromInstance = scope?.instanceId
    ? (fakeWindows
        .flatMap((w) => w.clusters)
        .find((c) => paneTabsOf(c.tree).includes(scope.instanceId as string))?.id ?? null)
    : null;
  return fromInstance ?? scope?.clusterId ?? null;
}

/** The path a cluster is pointed at. `null` for no cluster and for a cluster
 *  with no project alike, which is what `project::cluster_path` answers too. */
function fakeClusterProjectPath(clusterId: string | null): string | null {
  if (clusterId === null) return null;
  return fakeWindows.flatMap((w) => w.clusters).find((c) => c.id === clusterId)?.project ?? null;
}

/** Point a cluster at a project, or at nothing — `ShellState::
 *  set_cluster_project`, and it republishes both broadcasts for the same
 *  reason Rust emits `shell:state` *and* `project:changed`: the layout changed
 *  and so did the project on it. */
function setFakeClusterProject(clusterId: string, path: string | null): void {
  fakeWindows = fakeWindows.map((w) => ({
    ...w,
    clusters: w.clusters.map((c) => (c.id === clusterId ? { ...c, project: path } : c)),
  }));
  publishFakeShellState();
  publishFakeProject(clusterId);
}

/**
 * `home/state`'s payload for one cluster: that cluster's project as `open`, and
 * everyone's history as `recents`. The two scopes the real model has.
 */
function fakeProjectState(clusterId: string | null) {
  const path = fakeClusterProjectPath(clusterId);
  return {
    open: fakeProjects.find((p) => p.path === path) ?? null,
    recents: fakeProjects,
  };
}

// The real backend emits `project:changed` on every open and close, stamped
// with the cluster it is about, and the title bar is a subscriber to it
// (`state/project.ts`). A browser has no Tauri event system, so this is the
// same stand-in the fake shell state uses: a subscriber list, published from the
// mutating cases below.
//
// Without it the bar would name whatever was open when the window mounted —
// which under `?fake=1` is nothing — and stay that way however many projects
// were opened from Home. That is a fixture disagreeing with the backend in the
// direction of looking *emptier* rather than healthier, but it is still the
// kind of disagreement that makes a real regression unnoticeable here.
//
// **Each subscriber names the cluster it cares about, and hears about no
// other.** That is the filter Rust puts on the wire and `ToolWindow` and the
// title bar both apply; a fixture that told every subscriber about every change
// would make the one bug this feature exists to prevent — a switch in cluster A
// renaming the bar that is showing cluster B — invisible in the only place it
// can be clicked through.
type FakeProjectListener = (open: { name: string; path: string } | null) => void;
const fakeProjectListeners = new Map<FakeProjectListener, string | null>();

function publishFakeProject(clusterId: string) {
  for (const [cb, watching] of fakeProjectListeners) {
    if (watching !== clusterId) continue;
    const open = fakeProjectState(clusterId).open;
    cb(open ? { name: open.name, path: open.path } : null);
  }
}

/**
 * Mirrors a `project:changed` subscription scoped to one cluster, plus the
 * initial `cluster_project` read — one call covers both, because in a fixture
 * they cannot disagree.
 *
 * A `null` cluster subscribes to nothing and reports nothing, which is a window
 * with no clusters: there is no project to name, and no event that could ever
 * be about it.
 */
export function subscribeFakeClusterProject(
  clusterId: string | null,
  cb: FakeProjectListener,
): () => void {
  fakeProjectListeners.set(cb, clusterId);
  const open = fakeProjectState(clusterId).open;
  cb(open ? { name: open.name, path: open.path } : null);
  return () => {
    fakeProjectListeners.delete(cb);
  };
}

/**
 * How long a fixture takes to answer.
 *
 * Non-zero on purpose, and applied to every answer here rather than to the
 * newer ones only. `Promise.resolve(fixture)` settles in a microtask, which is
 * before the browser paints: a spinner would be code that cannot run under
 * `?fake=1`, and no call would ever still be in flight when the thing that
 * asked for it went away — so a viewer that sets state after unmounting, or a
 * tree that answers with the previous directory's children, would both look
 * correct here and be wrong against Rust. Thirty milliseconds is long enough
 * for a frame to be drawn in and short enough that clicking through a tree
 * does not feel like waiting on anything.
 */
const FAKE_LATENCY_MS = 30;

const settle = () => new Promise((resolve) => setTimeout(resolve, FAKE_LATENCY_MS));

/**
 * A refusal in the shape both hosts refuse with.
 *
 * A plain object rather than an `Error` subclass, and that is forced rather
 * than chosen: the rejection travels to the app frame through `postMessage`,
 * which structured-clones it, and a cloned `Error` arrives with its own
 * properties gone — `code` and `data` among them. `ToolWindow`'s
 * `isErrorPayload` is checking for exactly this shape.
 */
function rpcError(code: number, message: string, data?: unknown) {
  return { code, message, data };
}

/**
 * Answer one app `invoke` from a fixture, or `undefined` to let the caller
 * refuse it as it always has. Throws an `rpcError` envelope for a call the
 * backend would refuse — a fixture that could only succeed would leave every
 * error path in an app unreachable, and those are the paths nobody exercises.
 *
 * See the note above for what Home answers and why its pickers do not, and the
 * file-tree section below for the same about `files/*`.
 */
export async function fakeAppCall(
  method: string,
  params?: unknown,
  scope?: CallScope,
): Promise<unknown | undefined> {
  const path = (params as { path?: string } | undefined)?.path;
  const cluster = fakeClusterOf(scope);

  await settle();

  switch (method) {
    case "home/state":
      return { ...fakeProjectState(cluster), version: "0.1.0" };

    // The three that end in Rust's `project::open` or `project::close` also
    // publish, because those two are what emit `project:changed`. `forget`
    // deliberately does not — it touches the history and never any cluster's
    // project — so it does not here either.
    //
    // All three go through `requireFakeCluster` first, matching
    // `CallContext::require_cluster`: opening a project with no cluster to open
    // it into is not a smaller version of the action, it is a different one,
    // and the backend refuses it. A fixture that quietly succeeded would make
    // the refusal unreachable in the one browser an agent gets.
    case "home/open-recent":
      requireFakeCluster(cluster);
      if (fakeProjects.some((p) => p.path === path && p.exists)) {
        setFakeClusterProject(cluster as string, path ?? null);
      }
      return fakeProjectState(cluster);

    case "home/initialize-project":
      requireFakeCluster(cluster);
      fakeProjects = fakeProjects.map((p) => (p.path === path ? { ...p, initialized: true } : p));
      if (path !== undefined) setFakeClusterProject(cluster as string, path);
      return fakeProjectState(cluster);

    // No cluster required: the Recent list is global, and forgetting works
    // whether or not the caller is in a cluster. The scope only decides whose
    // open project the answer reports.
    case "home/forget-recent":
      fakeProjects = fakeProjects.filter((p) => p.path !== path);
      return fakeProjectState(cluster);

    case "home/close-project":
      requireFakeCluster(cluster);
      setFakeClusterProject(cluster as string, null);
      return fakeProjectState(cluster);

    default:
      return filesCall(method, params, cluster);
  }
}

/**
 * `CallContext::require_cluster`, message and all — the refusal Home's four
 * opening methods give a surface whose cluster has closed underneath it.
 *
 * Copied rather than paraphrased for the reason the whole file gives about the
 * not-UTF-8 and stale-write messages: a fixture whose refusals read differently
 * from the backend's teaches whoever hits one to go looking in the wrong place.
 */
function requireFakeCluster(clusterId: string | null): void {
  if (clusterId === null) {
    throw rpcError(
      HelveErrorCode.InternalError,
      "there is no cluster to open a project in — this surface is not in one any more",
    );
  }
}

// --- the fake file tree ------------------------------------------------------
//
// The Files app, answered. Everything from here to `__helveFakeFiles` serves
// `files/*` out of one `Map` of path to node, and it is the longest thing in
// this file on purpose: the explorer, the splitter, the tab strip, the filter,
// the Material icon resolver and all five viewers are frontend, all of them are
// drivable in Chrome, and none of them are reachable at all without a
// filesystem to point at. Port 1420 is the human's, so `?fake=1` is the only
// browser an agent gets.
//
// What this is a lie about, said plainly: there is no disk. Nothing here is
// slow the way a network share is, no directory is unreadable, and no file
// changes under an open tab unless `__helveFakeFiles` at the bottom of this
// section changes it.
//
// What it is deliberately *not* a lie about is the contract. Sort order, the
// truncation cap, `exists: false` for a missing stat, the not-UTF-8 refusal and
// the stale-write conflict are implemented the way `src-tauri/src/apps/files.rs`
// implements them, down to the wording of the two messages the frontend matches
// on. A fixture that answered more agreeably than the backend would hide the
// exact bugs it exists to surface — the same failure as the switcher bar that
// was full here and empty in the packaged app.
//
// The tree claims to be Windows because this is Windows: backslash-separated
// absolute paths under `C:\projects\`, with the drive root above so that "up"
// out of either project has somewhere real to go.
//
// It holds **two** projects — see `AURORA_ROOT` and `BOREALIS_ROOT`, which are
// declared up in the project-store section because the Recent list names them
// and that list is evaluated at module load. That they are needed in both
// places is the point: the two fixtures are one model now, not a project list
// beside an unrelated file tree.

/**
 * `MAX_READ_BYTES` from `files.rs`, restated.
 *
 * The one number in this section that is a copy of a constant in another
 * language. It travels back to the frontend as `limit` on every read, so the
 * app never spells it — and if Rust's cap moves, what goes stale here is a
 * truncation that fires at the wrong length rather than a number a person reads.
 */
const READ_LIMIT = 256 * 1024;

interface FakeNode {
  /** The filesystem's own three, as `EntryKind` in the app's `rpc.ts`. */
  kind: "dir" | "file" | "other";
  /** A UTF-8 text file's contents, `null` otherwise. This is how `files/read`
   *  decides to refuse: Rust learns it by trying to decode, and a fixture that
   *  stores text and bytes separately knows it up front. */
  text: string | null;
  /** Standard base64, no data-URI prefix, for a file whose bytes are not text. */
  base64: string | null;
  mtime: number;
}

const encoder = new TextEncoder();

/** `C:\` + `projects` without doubling the separator the drive root ends with. */
function joinPath(dir: string, name: string): string {
  return dir.endsWith("\\") ? `${dir}${name}` : `${dir}\\${name}`;
}

/**
 * The containing directory, or `null` where Rust's `Path::parent` says `None`.
 *
 * The only interesting case is the drive root: `C:\projects` cuts to `C:`,
 * which is a drive letter and not a directory, so the separator stays on.
 */
function parentOf(path: string): string | null {
  const cut = path.lastIndexOf("\\");
  if (cut <= 0 || cut === path.length - 1) return null;
  return cut === 2 ? path.slice(0, 3) : path.slice(0, cut);
}

/** `base_name` in `files.rs`: the last component, or the whole path when a
 *  drive root has none — an explorer headed "" would be worse than one headed
 *  `C:\`. */
function baseNameOf(path: string): string {
  const cut = path.lastIndexOf("\\");
  const name = cut === -1 ? path : path.slice(cut + 1);
  return name === "" ? path : name;
}

/** Crossed with each other to name `node_modules`, and reused as the crate
 *  names in the log below. Twenty by twelve is 240 packages; see the loop in
 *  `buildTree` for why that number. */
const PACKAGE_PREFIXES = [
  "ansi", "async", "babel", "cache", "chalk", "chokidar", "debug", "esbuild",
  "eslint", "glob", "graceful", "is", "json5", "lru", "micromatch", "minipass",
  "postcss", "resolve", "semver", "yargs",
];
const PACKAGE_SUFFIXES = [
  "core", "utils", "parser", "plugin", "loader", "runtime",
  "config", "helpers", "types", "cli", "stream", "fs",
];

/**
 * A log longer than the read cap, built rather than pasted.
 *
 * Deliberately ASCII. `files/read` cuts at a byte count, and one byte per
 * character means the cut cannot land inside a character — the case Rust
 * handles with `valid_up_to` and this fixture does not, because this is the
 * only file in the tree that trips the cap and it will never contain one.
 */
function buildLog(): string {
  const lines: string[] = [];
  for (let i = 0; i < 4200; i += 1) {
    const minute = String(Math.floor(i / 60) % 60).padStart(2, "0");
    const second = String(i % 60).padStart(2, "0");
    const crate = PACKAGE_PREFIXES[i % PACKAGE_PREFIXES.length];
    lines.push(
      `[2026-08-11T09:${minute}:${second}Z] aurora::build   compiling ${crate} v1.4.2 (unit ${i})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The tree, built once and only when something asks for it.
 *
 * Lazy where the project list above is a top-level array, because this one is
 * about a thousand objects and this module is in the shell's bundle whether or
 * not `?fake=1` is set. Nothing should pay for a fixture it is not using.
 */
let treeCache: Map<string, FakeNode> | null = null;

function fileTree(): Map<string, FakeNode> {
  treeCache ??= buildTree();
  return treeCache;
}

function buildTree(): Map<string, FakeNode> {
  const nodes = new Map<string, FakeNode>();

  // Distinct, descending times a minute apart. Every entry having the same
  // mtime would make a listing sorted by time look identical to one sorted by
  // insertion, which is a difference worth being able to see.
  const start = Date.now();
  let tick = 0;
  const nextMtime = () => start - (tick += 60_000);

  const dir = (path: string) =>
    nodes.set(path, { kind: "dir", text: null, base64: null, mtime: nextMtime() });
  const file = (path: string, text: string) =>
    nodes.set(path, { kind: "file", text, base64: null, mtime: nextMtime() });
  const binary = (path: string, base64: string) =>
    nodes.set(path, { kind: "file", text: null, base64, mtime: nextMtime() });

  // Above the project, so `files/list`'s `parent` leads somewhere and the
  // drive root's `parent: null` is reachable.
  dir("C:\\");
  dir("C:\\projects");
  dir(AURORA_ROOT);

  const at = (...parts: string[]) => parts.reduce(joinPath, AURORA_ROOT);

  // Names the Material theme has icons for, and one — `util.spec.ts` — that
  // resolves the `spec.ts` icon rather than the `ts` one only if the resolver
  // tries the longer suffix first.
  file(at("README.md"), README_MD);
  file(at("package.json"), PACKAGE_JSON);
  file(at("tsconfig.json"), TSCONFIG_JSON);
  file(at("Cargo.toml"), CARGO_TOML);
  file(at(".gitignore"), GITIGNORE);

  dir(at(".github"));
  dir(at(".github", "workflows"));
  file(at(".github", "workflows", "ci.yml"), CI_YML);

  dir(at("docs"));
  file(at("docs", "architecture.mmd"), ARCHITECTURE_MMD);
  file(at("docs", "design-notes.md"), DESIGN_NOTES_MD);

  dir(at("src"));
  file(at("src", "main.tsx"), MAIN_TSX);
  file(at("src", "util.spec.ts"), UTIL_SPEC_TS);

  dir(at("src", "engine"));
  file(at("src", "engine", "render.rs"), RENDER_RS);
  file(at("src", "engine", "scene.rs"), SCENE_RS);
  // The third `EntryKind`. Not a mistake in the fixture: a broken symlink is
  // what `"other"` means, and it is the only arm of a closed set the frontend
  // switches on that nothing else here would ever produce. It lists as `other`
  // with no size and no time, and stats as `exists: false`, which is what Rust
  // reports for it — `std::fs::metadata` follows links and finds nothing.
  nodes.set(at("src", "engine", "dangling-symlink"), {
    kind: "other",
    text: null,
    base64: null,
    mtime: nextMtime(),
  });

  // Deep enough that indentation has somewhere to go wrong.
  dir(at("src", "app"));
  dir(at("src", "app", "panels"));
  dir(at("src", "app", "panels", "inspector"));
  dir(at("src", "app", "panels", "inspector", "widgets"));
  file(at("src", "app", "panels", "inspector", "widgets", "TransformRow.tsx"), TRANSFORM_ROW_TSX);

  dir(at("assets"));
  binary(at("assets", "logo.png"), LOGO_PNG_BASE64);
  binary(at("assets", "glyphs.bin"), GLYPHS_BIN_BASE64);

  dir(at("logs"));
  file(at("logs", "build.log"), buildLog());

  // The big one, and the only directory here that exists for a reason other
  // than its name: the explorer windows its rows, and a tree whose largest
  // directory held a dozen entries would render every row it was handed and
  // prove nothing about whether the windowing works. 240 packages is far past
  // any viewport and costs a few hundred small objects to hold.
  const modules = at("node_modules");
  dir(modules);
  file(joinPath(modules, ".package-lock.json"), '{\n  "lockfileVersion": 3\n}\n');
  dir(joinPath(modules, ".bin"));
  // Capitalised, and the only two names here that are: case-insensitive
  // sorting looks exactly like case-sensitive sorting until something has a
  // capital in it. These land between `babel-utils` and `cache-cli`, and
  // between `json5-utils` and `lru-cli`.
  for (const name of ["JSONStream", "Base64"]) {
    dir(joinPath(modules, name));
    file(joinPath(modules, `${name}\\package.json`), packageJsonFor(name));
  }
  for (let i = 0; i < 240; i += 1) {
    const name = `${PACKAGE_PREFIXES[i % PACKAGE_PREFIXES.length]}-${
      PACKAGE_SUFFIXES[Math.floor(i / PACKAGE_PREFIXES.length) % PACKAGE_SUFFIXES.length]
    }`;
    const pkg = joinPath(modules, name);
    dir(pkg);
    file(joinPath(pkg, "package.json"), packageJsonFor(name));
    file(joinPath(pkg, "index.js"), `module.exports = require("./lib/${name}.js");\n`);
  }

  // The second project. Small on purpose — see the note by `BOREALIS_ROOT`. It
  // sits beside aurora under the same `C:\projects`, so "up" from either lands
  // somewhere that lists both, which is how you can see at a glance that these
  // are two trees and not one tree drawn twice.
  const bore = (...parts: string[]) => parts.reduce(joinPath, BOREALIS_ROOT);
  dir(BOREALIS_ROOT);
  file(bore("README.md"), BOREALIS_README_MD);
  file(bore("Cargo.toml"), BOREALIS_CARGO_TOML);
  dir(bore("src"));
  file(bore("src", "main.rs"), BOREALIS_MAIN_RS);
  file(bore("src", "shader.wgsl"), BOREALIS_SHADER_WGSL);

  return nodes;
}

function packageJsonFor(name: string): string {
  return `{\n  "name": "${name}",\n  "version": "1.4.2",\n  "main": "index.js"\n}\n`;
}

// --- serving the eight methods ------------------------------------------------

/**
 * Where Files roots when nobody has said otherwise — the port of
 * `files::default_root`.
 *
 * The calling cluster's project first, which is the whole of what changed: two
 * Files in two clusters ask this same function and get two answers. The
 * fallback is `AURORA_ROOT`, standing in for Rust's "the directory holding the
 * running manifest" — there is no manifest here, and what matters is that a
 * cluster with no project still has *somewhere* to browse rather than an error.
 *
 * A project path that is not a directory in this tree also falls back, and that
 * is not laziness: the Recent list holds four rows that exercise Home's own
 * states — a folder that was never initialized, one whose drive is gone — and
 * none of them has a file tree behind it. Opening one of those points the
 * cluster at it, Home says so, and Files browses the fallback. The real backend
 * behaves the same way for a project whose folder has been deleted since.
 */
function fakeDefaultRoot(clusterId: string | null): string {
  const project = fakeClusterProjectPath(clusterId);
  if (project !== null && fileTree().get(project)?.kind === "dir") return project;
  return AURORA_ROOT;
}

/**
 * The `files/*` half of `fakeAppCall`. `undefined` for anything else, so the
 * Home switch above can fall through to here and still refuse what neither
 * store knows.
 */
function filesCall(method: string, params?: unknown, clusterId: string | null = null): unknown | undefined {
  const root = fakeDefaultRoot(clusterId);
  const p = (params ?? {}) as {
    path?: unknown;
    text?: unknown;
    baseMtime?: unknown;
    parent?: unknown;
    name?: unknown;
    id?: unknown;
  };

  switch (method) {
    case "files/root":
      return { path: root, name: baseNameOf(root) };

    // Absent and null both mean "wherever you'd start me", as `resolve_path`
    // has it; every other method requires a path, as `required_path` has it.
    // "Wherever" is this cluster's project — see `fakeDefaultRoot`.
    case "files/list":
      return listAt(p.path === undefined || p.path === null ? root : requiredPath(p.path));

    case "files/stat":
      return statAt(requiredPath(p.path));

    case "files/read":
      return readAt(p.path === undefined || p.path === null ? root : requiredPath(p.path));

    case "files/read-bytes":
      return readBytesAt(requiredPath(p.path));

    case "files/write":
      return writeAt(requiredPath(p.path), p.text, p.baseMtime);

    case "files/create-file":
      return createAt(p, "file");

    case "files/create-dir":
      return createAt(p, "dir");

    case "files/rename":
      return renameAt(p);

    case "files/duplicate":
      return duplicateAt(requiredPath(p.path));

    // A native save dialog, and there is no OS here to open one. Refused with
    // the reason rather than answered with an invented path, for exactly the
    // reason `apps.ts`'s header gives about the three actions that raise a
    // folder picker: a fixture that looked healthier than the backend is what
    // once hid an empty switcher bar. Not left to the `MethodNotFound` at the
    // bottom either — the method exists, and saying it does not would send
    // anyone reading the console looking for a dispatch bug.
    case "files/save-as":
      throw rpcError(
        HelveErrorCode.InternalError,
        "files/save-as opens a native save dialog, and there is no OS here to open one (?fake=1)",
      );

    case "files/delete":
      return deleteAt(requiredPath(p.path));

    case "files/tree-size":
      return treeSizeAt(requiredPath(p.path));

    case "trash/list":
      return trashListing(root);

    case "trash/restore":
      return trashRestoreAt(requiredString(p.id, "id"));

    case "trash/purge":
      return trashPurgeAt(requiredString(p.id, "id"));

    // There is no OS here to hand a file to. Both resolve `null` — the same
    // thing Rust returns on success — rather than refusing, because refusing
    // would make the app draw an error for a button that worked, and logging
    // is what leaves the click observable.
    case "files/reveal":
    case "files/open-external":
      console.info(`helve: ${method} ${requiredPath(p.path)} — no OS here to hand it to (?fake=1)`);
      return null;

    default:
      // A `files/` or `trash/` method this fixture has never heard of is a
      // mistake worth naming, and it is the one Rust names too. Anything else
      // belongs to another app and is not this function's to answer.
      if (!method.startsWith("files/") && !method.startsWith("trash/")) return undefined;
      throw rpcError(HelveErrorCode.MethodNotFound, `no such method: ${method}`);
  }
}

function requiredPath(raw: unknown): string {
  if (typeof raw === "string") return raw;
  throw rpcError(
    HelveErrorCode.InvalidParams,
    raw === undefined || raw === null
      ? "path is required"
      : `path must be a string, got ${JSON.stringify(raw)}`,
  );
}

/** A file's length in bytes; `null` for anything that is not one. */
function sizeOf(node: FakeNode): number | null {
  if (node.kind !== "file") return null;
  if (node.text !== null) return encoder.encode(node.text).length;
  return base64Bytes(node.base64 ?? "");
}

/** The decoded length of base64, without decoding it. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function listAt(path: string): unknown {
  const node = fileTree().get(path);
  if (node === undefined || node.kind !== "dir") {
    // What `read_dir` failing looks like, with the message Windows gives for
    // the two ways it fails. Nothing matches on this text — it is here so a
    // console showing it reads like the real thing rather than like a fixture
    // that ran out of ideas.
    throw rpcError(
      HelveErrorCode.InternalError,
      node === undefined
        ? `could not read ${path}: The system cannot find the path specified. (os error 3)`
        : `could not read ${path}: The directory name is invalid. (os error 267)`,
    );
  }

  const entries = [...fileTree()]
    .filter(([child]) => parentOf(child) === path)
    .map(([child, entry]) => ({
      name: baseNameOf(child),
      path: child,
      kind: entry.kind,
      size: sizeOf(entry),
      // A listing gets its times from the same `metadata()` that decided the
      // kind, so the entry that has none also has no time.
      mtime: entry.kind === "other" ? null : entry.mtime,
    }));

  // Directories first, then by name without regard to case — the order
  // `files.rs` guarantees and the frontend explicitly does not re-do. Compared
  // with `<` rather than `localeCompare` because Rust compares lowercased
  // `String`s, which is code-point order; a locale-aware collation would sort
  // `.gitignore` and `Cargo.toml` by rules Rust has never heard of.
  entries.sort((a, b) => {
    const foldersFirst = Number(a.kind !== "dir") - Number(b.kind !== "dir");
    if (foldersFirst !== 0) return foldersFirst;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  return { path, parent: parentOf(path), entries };
}

/**
 * One entry as it is right now, including the fact that it isn't.
 *
 * A missing path is `exists: false` rather than a refusal, and that is
 * load-bearing rather than lenient: the external-change poll uses this to tell
 * "someone deleted it" from "the call failed", and those are opposite
 * instructions about what to do with the open tab.
 */
function statAt(path: string): unknown {
  const node = fileTree().get(path);
  // A dangling symlink has nothing to stat, the same as a path that was never
  // there — it keeps its `kind` and loses everything that came from metadata.
  const found = node?.kind === "other" ? undefined : node;

  return {
    path,
    name: baseNameOf(path),
    kind: node?.kind ?? "other",
    size: found ? sizeOf(found) : null,
    mtime: found?.mtime ?? null,
    exists: found !== undefined,
  };
}

/** The file at `path`, or the refusal Rust gives for whatever is there instead. */
function fileAt(path: string): FakeNode {
  const node = fileTree().get(path);
  if (node === undefined || node.kind === "other") {
    throw rpcError(
      HelveErrorCode.InternalError,
      `could not stat ${path}: The system cannot find the file specified. (os error 2)`,
    );
  }
  if (node.kind === "dir") {
    throw rpcError(HelveErrorCode.InvalidParams, `${path} is a directory, not a file`);
  }
  return node;
}

function readAt(path: string): unknown {
  const node = fileAt(path);

  if (node.text === null) {
    // This exact wording, because `isNotText` in the app's `rpc.ts` matches on
    // it, and what it is really matching is the Rust message this copies. It
    // is what hands a PNG or a `.bin` from the text viewer to the unsupported
    // one, so a paraphrase here would break a handoff rather than a string.
    throw rpcError(HelveErrorCode.InvalidParams, `${path} is not a UTF-8 text file`);
  }

  const truncated = encoder.encode(node.text).length > READ_LIMIT;
  return {
    path,
    text: truncated ? node.text.slice(0, READ_LIMIT) : node.text,
    truncated,
    limit: READ_LIMIT,
    mtime: node.mtime,
  };
}

function readBytesAt(path: string): unknown {
  const node = fileAt(path);
  // No 32 MiB refusal. The cap is real in Rust, but the largest thing in this
  // tree is a third of a megabyte, so the branch could only ever be dead code
  // here — and dead code in a fixture is a claim nobody can check.
  return {
    path,
    base64: node.base64 ?? toBase64(encoder.encode(node.text ?? "")),
    size: sizeOf(node) ?? 0,
    mtime: node.mtime,
  };
}

function writeAt(path: string, rawText: unknown, rawBaseMtime: unknown): unknown {
  if (typeof rawText !== "string") {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      rawText === undefined
        ? "text is required — there is no method for emptying a file by omission"
        : `text must be a string, got ${JSON.stringify(rawText)}`,
    );
  }
  // Absent and explicitly null are the same claim — "I have no time to compare
  // against" — and differ only because JSON makes them.
  const baseMtime = rawBaseMtime === undefined ? null : rawBaseMtime;
  if (baseMtime !== null && typeof baseMtime !== "number") {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `baseMtime must be a number or null, got ${JSON.stringify(rawBaseMtime)}`,
    );
  }

  const nodes = fileTree();
  const existing = nodes.get(path);
  const current = existing?.kind === "file" ? existing.mtime : null;

  // The conflict check, before anything is touched. A `null` base writes
  // unconditionally: a filesystem that cannot report times would otherwise
  // make the editor unusable rather than safer. A file that was *deleted*
  // since the read counts as changed too, which is why this compares against
  // `null` rather than skipping when the file is gone.
  if (baseMtime !== null && baseMtime !== current) {
    // `staleWrite` in the app's `rpc.ts` reads `data.kind`, not the code —
    // `InvalidParams` is also what a bad `text` gets, so the payload is the
    // only thing that says which refusal this is.
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${path} changed on disk since it was read`,
      { kind: "stale", mtime: current },
    );
  }

  if (existing !== undefined && existing.kind !== "file") {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${path} is a directory, not a file that can be written`,
    );
  }
  // A new file is written, not refused — Rust's `write_at` creates one, and a
  // fixture that refused would disagree with the backend the moment there is a
  // "new file" button. Its directory does have to exist, or the file would be
  // in the tree and in no listing.
  const parent = parentOf(path);
  if (parent === null || fileTree().get(parent)?.kind !== "dir") {
    throw rpcError(
      HelveErrorCode.InternalError,
      `could not write ${path}: The system cannot find the path specified. (os error 3)`,
    );
  }

  // Visibly new. `Date.now()` called twice inside one millisecond returns the
  // same number, and a save whose mtime did not move would leave the *next*
  // write comparing equal against a base it should have lost to — the conflict
  // this whole check exists to catch, made undetectable by a rounding error.
  const mtime = Math.max(Date.now(), (current ?? 0) + 1);
  nodes.set(path, { kind: "file", text: rawText, base64: null, mtime });
  return { path, mtime };
}

/**
 * Characters Windows will not store, and the DOS device names it reserves —
 * `RESERVED_CHARS` and `RESERVED_STEMS` in `files.rs`, restated.
 *
 * Control characters are checked by code point at the call site rather than
 * listed here, which is both what Rust's `char::is_control` does and the only
 * way to express the rule without putting a literal control byte in this
 * source, where no editor would show it.
 */
const FAKE_RESERVED_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*"]);
const FAKE_RESERVED_STEMS = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * `validate_component` in `files.rs`, rule for rule.
 *
 * Copied rather than approximated for the reason this whole section gives: a
 * fixture that accepted a name the backend refuses would make the create flow
 * look finished here and fail in the packaged app, which is the exact failure
 * mode the empty switcher bar was. The wording is close to Rust's but nothing
 * matches on it — unlike the not-UTF-8 and stale-write messages above, which
 * the app's `rpc.ts` really does read.
 */
function fakeValidateName(name: string): void {
  const refuse = (why: string) => {
    throw rpcError(HelveErrorCode.InvalidParams, why);
  };

  if (name === "") refuse("a name is required");
  if (name.includes("/") || name.includes("\\")) {
    refuse(
      `"${name}" contains a path separator — this creates one entry inside the folder you chose, ` +
        "so the name may not be a path",
    );
  }
  if (name === "." || name === "..") {
    refuse(`"${name}" is how a path refers to a folder that already exists, not a name`);
  }
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (FAKE_RESERVED_CHARS.has(ch) || code < 32 || code === 127) {
      refuse(`"${ch}" is not allowed in a Windows file name`);
    }
  }
  if (name.endsWith(" ") || name.endsWith(".")) {
    refuse(
      `Windows silently drops a trailing space or dot, so "${name}" would not be the name on disk`,
    );
  }
  const stem = name.split(".")[0].toLowerCase();
  if (FAKE_RESERVED_STEMS.has(stem)) {
    refuse(`"${stem}" is a reserved device name on Windows, so "${name}" cannot be created`);
  }
}

/**
 * `files/create-file` and `files/create-dir`, against the `Map`.
 *
 * The collision check is the interesting one: Rust gets it from
 * `create_new(true)` and `create_dir`, which refuse an existing path at the
 * syscall, and here it is an explicit `has`. Same refusal, and it must stay
 * that way — a fixture that overwrote would let the create flow ship having
 * never once shown the error it spends most of its code on.
 */
function createAt(
  p: { parent?: unknown; name?: unknown },
  kind: "file" | "dir",
): unknown {
  const parent = requiredString(p.parent, "parent");
  const name = requiredString(p.name, "name");
  fakeValidateName(name);

  const nodes = fileTree();
  if (nodes.get(parent)?.kind !== "dir") {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${parent} is not a folder, so there is nothing to create a ${
        kind === "dir" ? "folder" : "file"
      } in`,
    );
  }

  const path = joinPath(parent, name);
  if (nodes.has(path)) {
    throw rpcError(HelveErrorCode.InvalidParams, `${name} already exists in ${parent}`);
  }

  nodes.set(path, {
    kind,
    // An empty file, not a template — `create_at` says the same. A directory
    // holds neither, and its emptiness is simply that nothing else in the map
    // has it as a parent.
    text: kind === "file" ? "" : null,
    base64: null,
    mtime: Date.now(),
  });

  return { path, name, kind };
}

/**
 * `files/rename`, against the `Map`. Mirrors `rename_at` in `files.rs`.
 *
 * Two behaviours here are the ones worth having a fixture for at all, because
 * both are refusals the UI has to draw and neither is reachable otherwise:
 * renaming onto a name that is taken, and renaming a folder — which in a flat
 * `Map` means re-keying every descendant, the thing `std::fs::rename` does for
 * free and a fixture has to do by hand.
 */
function renameAt(p: { path?: unknown; name?: unknown }): unknown {
  const path = requiredPath(p.path);
  const name = requiredString(p.name, "name");
  fakeValidateName(name);

  const nodes = fileTree();
  const node = nodes.get(path);
  if (node === undefined) {
    throw rpcError(HelveErrorCode.InvalidParams, `${path} is no longer there to rename`);
  }

  const parent = parentOf(path);
  if (parent === null) {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${path} is a root, and a root has no name to change`,
    );
  }

  const target = joinPath(parent, name);
  if (target === path) return { path, name, kind: node.kind };

  // `is_same_entry` in Rust, which exists for the case-only rename. This tree
  // claims to be Windows, so the comparison is case-insensitive — and without
  // it, renaming `Notes.md` to `notes.md` would refuse here and succeed against
  // the real backend, which is the direction of disagreement this file is most
  // careful about.
  if (target.toLowerCase() !== path.toLowerCase() && nodes.has(target)) {
    throw rpcError(HelveErrorCode.InvalidParams, `${name} already exists in ${parent}`);
  }

  // A folder takes its children with it. Snapshot the entries first: this
  // mutates the map it is walking.
  const prefix = `${path}\\`;
  for (const [key, value] of [...nodes]) {
    if (key === path) {
      nodes.delete(key);
      nodes.set(target, value);
    } else if (key.startsWith(prefix)) {
      nodes.delete(key);
      nodes.set(target + key.slice(path.length), value);
    }
  }

  return { path: target, name, kind: node.kind };
}

/**
 * `files/duplicate`, against the `Map`. Mirrors `duplicate_at` in `files.rs`.
 *
 * The naming rule is the part that has to match, and it is the part a fixture
 * can actually get wrong: `notes.txt` becomes `notes copy.txt` and then
 * `notes copy 2.txt`, with the suffix *before* the extension, and a leading dot
 * counting as part of the name rather than as an extension. A fixture that
 * appended the suffix at the end would show the copy with the wrong icon in the
 * tree and nowhere else, which is the sort of disagreement `?fake=1` exists to
 * make visible rather than to hide.
 *
 * A folder takes its descendants, which in a flat map means copying by prefix.
 */
function duplicateAt(path: string): unknown {
  const nodes = fileTree();
  const node = nodes.get(path);
  if (node === undefined) {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${path} could not be read to duplicate it: no such file or directory`,
    );
  }

  const parent = parentOf(path);
  if (parent === null) {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${path} is a root, and a root cannot be duplicated`,
    );
  }

  const name = baseNameOf(path);
  let target = "";
  let targetName = "";
  for (let n = 1; n <= 1000; n += 1) {
    targetName = fakeCopyName(name, n);
    target = joinPath(parent, targetName);
    if (!nodes.has(target)) break;
    target = "";
  }
  if (!target) {
    throw rpcError(
      HelveErrorCode.InternalError,
      `${name} has already been duplicated 1000 times in ${parent}`,
    );
  }

  const prefix = `${path}\\`;
  const now = Date.now();
  for (const [key, value] of [...nodes]) {
    if (key === path) {
      nodes.set(target, { ...value, mtime: now });
    } else if (key.startsWith(prefix)) {
      nodes.set(target + key.slice(path.length), { ...value, mtime: now });
    }
  }

  return { path: target, name: targetName, kind: node.kind };
}

/** `notes.txt` → `notes copy.txt`, `notes copy 2.txt`. See `copy_name` in `files.rs`. */
function fakeCopyName(name: string, n: number): string {
  const suffix = n === 1 ? " copy" : ` copy ${n}`;
  const dot = name.lastIndexOf(".");
  // A leading dot begins a name, not an extension — `.gitignore` duplicates
  // whole. Same rule as `extensionOf` in the Files app's `rpc.ts`.
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

/**
 * `files/delete`, against the `Map`. Mirrors `delete_at` in `files.rs`.
 *
 * There is no Recycle Bin here and nothing to recover from, so `trashed` is
 * reported `true` because that is what the backend does rather than because
 * anything was moved anywhere. The lie is the same lie the rest of this section
 * tells — there is no disk — and it is the contract that has to match.
 *
 * A folder takes its descendants, which in a flat map means deleting by prefix.
 */
function deleteAt(path: string): unknown {
  const nodes = fileTree();
  const node = nodes.get(path);
  if (node === undefined) {
    throw rpcError(HelveErrorCode.InvalidParams, `${path} is no longer there to delete`);
  }

  // Everything that is about to go, kept so `trash/restore` can put it back.
  // This is what makes the delete → restore loop reachable under `?fake=1` at
  // all: without it the fixture could delete but never undo, and the restore
  // path — including both of its refusals — would ship unexercised.
  const prefix = `${path}\\`;
  const removed: Array<[string, FakeNode]> = [];
  for (const [key, value] of [...nodes]) {
    if (key === path || key.startsWith(prefix)) {
      removed.push([key, value]);
      nodes.delete(key);
    }
  }

  fakeTrash.push({
    // The real backend's id is a shell display name. Anything opaque and stable
    // will do here; what matters is that the frontend never parses it.
    id: `fake-trash-${(fakeTrashSerial += 1)}`,
    name: baseNameOf(path),
    originalPath: path,
    originalParent: parentOf(path) ?? path,
    deletedUnixMs: Date.now(),
    kind: node.kind,
    removed,
  });

  return { path, kind: node.kind, trashed: true };
}

// --- the fake Recycle Bin -----------------------------------------------------
//
// Only what this project deleted, because that is the rule the real backend
// enforces: `trash/list` scopes to the project root, and restore and purge look
// their id up inside that scoped set. The fixture cannot get that wrong in an
// interesting way — there is no system bin here and nothing outside the tree to
// leak — so what it exists to exercise is the *shape* of the answer and the two
// refusals that restore can produce.

interface FakeTrashEntry {
  id: string;
  name: string;
  originalPath: string;
  originalParent: string;
  deletedUnixMs: number;
  kind: "dir" | "file" | "other";
  /** The whole subtree that went, so a restore is exact rather than a stub. */
  removed: Array<[string, FakeNode]>;
}

let fakeTrash: FakeTrashEntry[] = [];
let fakeTrashSerial = 0;

function trashListing(root: string): unknown {
  return {
    // The scope the real backend enforces: `trash/list` reports the Recycle Bin
    // for the root Files is showing, and that root is now the calling cluster's
    // project. Passed in rather than read from a constant, so the two panes of
    // one Files surface cannot disagree about which project they are in.
    root,
    // Newest first, which is the order Rust sorts into. The frontend explicitly
    // does not re-sort, so a fixture handing back insertion order would make the
    // list look right here and wrong against the backend.
    items: [...fakeTrash]
      .sort((a, b) => b.deletedUnixMs - a.deletedUnixMs)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        originalPath: entry.originalPath,
        originalParent: entry.originalParent,
        deletedUnixMs: entry.deletedUnixMs,
        // A file reports bytes and a directory reports its immediate children,
        // exactly as `TrashItemSize` splits them.
        size: entry.kind === "dir" ? null : sizeOf(entry.removed[0][1]),
        entries:
          entry.kind === "dir"
            ? entry.removed.filter(
                ([key]) => parentOf(key) === entry.originalPath,
              ).length
            : null,
      })),
  };
}

function findTrashEntry(id: string): FakeTrashEntry {
  const entry = fakeTrash.find((candidate) => candidate.id === id);
  if (!entry) {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      "that item is not in this project's Recycle Bin — it may have been restored, purged, or " +
        "emptied since the list was read",
    );
  }
  return entry;
}

function trashRestoreAt(id: string): unknown {
  const entry = findTrashEntry(id);
  const nodes = fileTree();

  // Both refusals the real backend produces, in the same order.
  if (nodes.has(entry.originalPath)) {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${entry.originalPath} already exists, so restoring would overwrite it`,
    );
  }
  if (nodes.get(entry.originalParent)?.kind !== "dir") {
    throw rpcError(
      HelveErrorCode.InvalidParams,
      `${entry.originalParent} no longer exists, so there is nowhere to restore ${entry.name} to ` +
        "— recreate the folder first",
    );
  }

  for (const [key, value] of entry.removed) nodes.set(key, value);
  fakeTrash = fakeTrash.filter((candidate) => candidate.id !== id);

  return { path: entry.originalPath, name: entry.name };
}

function trashPurgeAt(id: string): unknown {
  const entry = findTrashEntry(id);
  fakeTrash = fakeTrash.filter((candidate) => candidate.id !== id);
  return { name: entry.name, originalPath: entry.originalPath };
}

/** `TREE_SIZE_CAP` in `files.rs`, restated — see that constant for the argument. */
const FAKE_TREE_SIZE_CAP = 10_000;

/**
 * `files/tree-size`: what a recursive delete would take with it.
 *
 * Counts by path prefix rather than by walking, because this tree is a flat map
 * and a prefix scan is the same answer. The cap is honoured so the `truncated`
 * branch is reachable here at all — `node_modules` in this fixture is around
 * 750 entries, so it is not reached in practice, and that is worth knowing
 * rather than assuming.
 */
function treeSizeAt(path: string): unknown {
  const prefix = `${path}\\`;
  let files = 0;
  let dirs = 0;
  let truncated = false;

  for (const [key, node] of fileTree()) {
    if (!key.startsWith(prefix)) continue;
    if (files + dirs >= FAKE_TREE_SIZE_CAP) {
      truncated = true;
      break;
    }
    if (node.kind === "dir") dirs += 1;
    else files += 1;
  }

  return { path, files, dirs, truncated };
}

/** `required_string` in `files.rs`, for the params only create and rename take. */
function requiredString(raw: unknown, key: string): string {
  if (typeof raw === "string") return raw;
  throw rpcError(
    HelveErrorCode.InvalidParams,
    raw === undefined || raw === null
      ? `${key} is required`
      : `${key} must be a string, got ${JSON.stringify(raw)}`,
  );
}

/**
 * The two things a filesystem does that nothing inside the app can: change a
 * file behind an open tab, and delete one.
 *
 * Both paths are unreachable here without them, and both are worth reaching.
 * `files/write`'s conflict refusal only fires when the mtime moved since the
 * read, and no button in Files can move it — so without `touch` the conflict
 * banner ships unverified, which makes it the most likely thing in the app to
 * be broken with nobody noticing. `remove` is the other half: the
 * external-change poll distinguishes a deleted file by `exists: false`, and
 * that needs a file that can go away.
 *
 * On the shell's window rather than the app frame's, because this module runs
 * in the shell. From the console on the top page, with the frame untouched:
 *
 *     __helveFakeFiles.touch("C:\\projects\\aurora\\README.md")
 *
 * then save in the editor and the write comes back stale.
 *
 * Attached only under `?fake=1`, so a packaged build has no way to reach it —
 * the same guard, for the same reason, as everything else in this file.
 */
if (isFake()) {
  (window as unknown as { __helveFakeFiles?: unknown }).__helveFakeFiles = {
    /** Move a file's mtime, as an editor outside this app would. */
    touch(path: string): number | null {
      const node = fileTree().get(path);
      if (!node) return null;
      const mtime = Math.max(Date.now(), node.mtime + 1);
      fileTree().set(path, { ...node, mtime });
      return mtime;
    },
    /** Delete one, so a poll can find it gone. */
    remove(path: string): boolean {
      return fileTree().delete(path);
    },
    /** Every path in the tree, for finding one to aim the other two at. */
    paths(): string[] {
      return [...fileTree().keys()];
    },
  };
}

// --- what the fixture files contain -------------------------------------------
//
// Below the code that uses it, because four hundred lines of sample file at the
// top would bury the eight methods that are the point. That works only because
// `buildTree` runs lazily — a `const` is not hoisted, and a tree built during
// module evaluation would read every one of these before it was initialised.
//
// The contents are real rather than lorem. The text viewer is Monaco, and a
// file of placeholder words says nothing about whether highlighting works.

const README_MD = `# Aurora

A game project that does not exist, so the Files app has something to browse.

Nothing in this tree is on disk. It is the fixture that \`?fake=1\` serves in
place of a filesystem, so that the explorer, the tabs and the viewers can be
driven in a plain browser. See src/shell/state/fakeBackend.ts in the
orchestrator for what it does and does not pretend.

## Layout

    src/            the client, TypeScript and Rust side by side
    docs/           design notes, including a mermaid diagram
    assets/         art the image viewer can open
    logs/           one file deliberately larger than the read cap
    node_modules/   240 packages, so the row list has to window

## Why these names

Every filename here was chosen to make something visible. Cargo.toml and
tsconfig.json for the icon resolver; util.spec.ts to prove a spec resolves a
different icon from plain TypeScript; a .gitignore because a leading dot is a
name and not an extension; glyphs.bin because the text viewer has to try a
read and hand off when the bytes are not text.
`;

const PACKAGE_JSON = `{
  "name": "aurora",
  "private": true,
  "version": "0.3.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "~5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true
  },
  "include": ["src"]
}
`;

const CARGO_TOML = `[package]
name = "aurora-engine"
version = "0.3.1"
edition = "2021"

[dependencies]
glam = "0.29"
pollster = "0.4"
wgpu = "23"

[dev-dependencies]
approx = "0.5"

[profile.release]
lto = true
codegen-units = 1
`;

const GITIGNORE = `/target
node_modules/
dist/
*.log
.DS_Store
`;

// --- the second project -------------------------------------------------------
//
// Four files, and they are four rather than forty on purpose. This tree exists
// so that a Files in one cluster is visibly not the Files in the other; every
// rule about listing, reading, writing and windowing is already exercised by
// aurora above, and a second copy of all of it would be a second thing to keep
// in agreement with `files.rs` for no extra coverage.
//
// The contents still say what project this is, so a screenshot of one cluster
// cannot be mistaken for a screenshot of the other.

const BOREALIS_README_MD = `# Borealis

The *second* fixture project, and the reason there are two.

A project belongs to a cluster, so the thing worth being able to see in a
browser is two Files side by side rooted at two different folders. Open Aurora
in one cluster and Borealis in the other from Home's Recent list, then switch
chips: the title bar renames and this tree replaces that one.

If both panes show the same files, the per-cluster wiring is broken — most
likely the instance id is not reaching \`app_call\`, or \`project:changed\` is
being relayed to frames outside the cluster it names.
`;

const BOREALIS_CARGO_TOML = `[package]
name = "borealis"
version = "0.1.0"
edition = "2021"

[dependencies]
wgpu = "23"
winit = "0.30"
`;

const BOREALIS_MAIN_RS = `//! Borealis — the second fixture project.

fn main() {
    let sky = Sky::at_latitude(68.4);
    println!("{} bands", sky.bands().count());
}

struct Sky {
    latitude: f32,
}

impl Sky {
    fn at_latitude(latitude: f32) -> Self {
        Self { latitude }
    }

    fn bands(&self) -> impl Iterator<Item = f32> + '_ {
        (0..12).map(move |i| self.latitude + i as f32 * 0.25)
    }
}
`;

const BOREALIS_SHADER_WGSL = `@group(0) @binding(0) var<uniform> time: f32;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let band = sin(uv.y * 12.0 + time) * 0.5 + 0.5;
    return vec4<f32>(0.1, 0.6 * band, 0.4 + 0.4 * band, 1.0);
}
`;

const CI_YML = `name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: cargo test --all-features
`;

/** Five nodes and two labelled edges — enough that a diagram that renders and
 *  one that merely draws a box are told apart. */
const ARCHITECTURE_MMD = `flowchart TD
  Explorer[Explorer tree] --> Registry{Viewer registry}
  Registry -->|text| Monaco[Monaco editor]
  Registry -->|image| Image[Image viewer]
  Registry -->|mmd| Mermaid[Mermaid viewer]
`;

const DESIGN_NOTES_MD = `# Design notes

The renderer draws the scene twice: once into a depth prepass, and once for
colour. That costs a second traversal and buys early-z on everything, which on
the integrated GPUs this has to run on is the difference between forty frames
and sixty.

Open question: whether the prepass should also write velocity, or whether the
temporal pass keeps its own. Writing it here means one more render target bound
for the whole prepass; keeping it separate means reading depth back.
`;

const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html has no #root to mount into");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const UTIL_SPEC_TS = `import { describe, expect, it } from "vitest";
import { clamp, lerp } from "./util";

describe("clamp", () => {
  it("leaves a value inside the range alone", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("pins to the nearer bound outside it", () => {
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(clamp(9, 0, 1)).toBe(1);
  });
});

describe("lerp", () => {
  it("returns the endpoints exactly", () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
  });
});
`;

const TRANSFORM_ROW_TSX = `import { useId } from "react";
import type { Vec3 } from "../../../engine/types";

export default function TransformRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vec3;
  onChange(next: Vec3): void;
}) {
  const id = useId();
  const axes = ["x", "y", "z"] as const;

  return (
    <div className="transform-row" role="group" aria-labelledby={id}>
      <span id={id} className="transform-row__label">
        {label}
      </span>
      {axes.map((axis, index) => (
        <input
          key={axis}
          type="number"
          step={0.01}
          value={value[index]}
          aria-label={label + " " + axis}
          onChange={(event) => {
            const next: Vec3 = [...value];
            next[index] = Number(event.target.value);
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
`;

/** The long one: enough lines to scroll, and Rust so Monaco has something to
 *  colour. */
const RENDER_RS = `//! The frame graph, such as it is.
//!
//! One pass list, executed in order, with the swapchain image threaded through
//! as the last colour target. There is no automatic barrier insertion and no
//! aliasing of transient targets — both are worth having and neither is worth
//! having before there are enough passes to make the bookkeeping cheaper than
//! writing it out.

use std::collections::HashMap;
use std::sync::Arc;

use glam::{Mat4, Vec3};

use crate::scene::{Scene, Visible};

/// How many frames the renderer will let the GPU fall behind.
///
/// Two, not three. A third frame buys a little throughput on a GPU-bound scene
/// and costs a frame of input latency on every other one, and this is a tool as
/// much as it is a game.
const FRAMES_IN_FLIGHT: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PassId {
    DepthPrepass,
    Opaque,
    Transparent,
    Tonemap,
}

pub struct Pass {
    pub id: PassId,
    pub colour: Option<TargetId>,
    pub depth: Option<TargetId>,
    /// Passes that must have finished before this one starts. Not derived from
    /// the targets, because two passes can share a target and still be
    /// independent — a resolve reads what a prepass wrote, but two shadow
    /// cascades write disjoint slices of one atlas.
    pub after: Vec<PassId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TargetId(pub u32);

pub struct Renderer {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    passes: Vec<Pass>,
    targets: HashMap<TargetId, wgpu::TextureView>,
    frame: usize,
}

impl Renderer {
    pub fn new(device: Arc<wgpu::Device>, queue: Arc<wgpu::Queue>) -> Self {
        Self {
            device,
            queue,
            passes: Vec::new(),
            targets: HashMap::new(),
            frame: 0,
        }
    }

    /// Add a pass. Order of insertion is execution order; \`after\` is checked
    /// against it rather than used to sort, because a graph that quietly
    /// reordered itself would make a frame capture disagree with this file.
    pub fn add_pass(&mut self, pass: Pass) -> Result<(), GraphError> {
        for dependency in &pass.after {
            if !self.passes.iter().any(|p| p.id == *dependency) {
                return Err(GraphError::OutOfOrder {
                    pass: pass.id,
                    needs: *dependency,
                });
            }
        }
        self.passes.push(pass);
        Ok(())
    }

    pub fn render(&mut self, scene: &Scene, view: Mat4, projection: Mat4) {
        let visible = scene.cull(view, projection);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("frame") });

        for pass in &self.passes {
            match pass.id {
                PassId::DepthPrepass => self.depth_prepass(&mut encoder, &visible),
                PassId::Opaque => self.opaque(&mut encoder, &visible),
                PassId::Transparent => self.transparent(&mut encoder, &visible),
                PassId::Tonemap => self.tonemap(&mut encoder),
            }
        }

        self.queue.submit(Some(encoder.finish()));
        self.frame = (self.frame + 1) % FRAMES_IN_FLIGHT;
    }

    fn depth_prepass(&self, encoder: &mut wgpu::CommandEncoder, visible: &Visible) {
        let _ = (encoder, visible);
        // Front to back, so early-z rejects as much as it can. The sort is the
        // whole point of the pass; without it this costs a traversal and saves
        // nothing.
    }

    fn opaque(&self, encoder: &mut wgpu::CommandEncoder, visible: &Visible) {
        let _ = (encoder, visible);
    }

    fn transparent(&self, encoder: &mut wgpu::CommandEncoder, visible: &Visible) {
        // Back to front, and no depth writes. Order-independent transparency
        // is the right answer and is a larger change than it looks.
        let _ = (encoder, visible);
    }

    fn tonemap(&self, encoder: &mut wgpu::CommandEncoder) {
        let _ = encoder;
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("pass {pass:?} depends on {needs:?}, which has not been added yet")]
    OutOfOrder { pass: PassId, needs: PassId },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dependency_added_later_is_rejected() {
        let mut passes: Vec<Pass> = Vec::new();
        passes.push(Pass {
            id: PassId::Opaque,
            colour: Some(TargetId(0)),
            depth: Some(TargetId(1)),
            after: vec![PassId::DepthPrepass],
        });
        assert_eq!(passes.len(), 1);
    }

    #[test]
    fn the_up_axis_is_y() {
        assert_eq!(Vec3::Y, Vec3::new(0.0, 1.0, 0.0));
    }
}
`;

const SCENE_RS = `//! What there is to draw, and which of it the camera can see.

use glam::{Mat4, Vec3};

pub struct Scene {
    pub meshes: Vec<Mesh>,
}

pub struct Mesh {
    pub centre: Vec3,
    pub radius: f32,
}

/// The result of a cull: indices into \`Scene::meshes\`, not references, so the
/// scene stays mutable while a frame is in flight.
pub struct Visible {
    pub indices: Vec<usize>,
}

impl Scene {
    pub fn cull(&self, view: Mat4, projection: Mat4) -> Visible {
        let clip = projection * view;
        let indices = self
            .meshes
            .iter()
            .enumerate()
            .filter(|(_, mesh)| inside(clip, mesh))
            .map(|(index, _)| index)
            .collect();
        Visible { indices }
    }
}

fn inside(clip: Mat4, mesh: &Mesh) -> bool {
    let centre = clip * mesh.centre.extend(1.0);
    centre.w > -mesh.radius
}
`;

/**
 * A real 64x64 PNG, RGB, no interlacing — a dark plate with an orange diagonal
 * band and a lighter border, so a screenshot shows whether the image viewer
 * drew it or drew a broken-image glyph.
 *
 * Built by hand and then decoded twice before being pasted here: once by
 * walking the chunks, checking every CRC and inflating IDAT to the exact
 * scanline length IHDR promises, and once by GDI+, which reported 64x64
 * Format24bppRgb and the border colour at (0,0). A placeholder string would
 * have been indistinguishable from a working fixture right up to the moment
 * someone tried to look at it.
 */
const LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAA9klEQVR42u2aMQ7CMBAE84iIgiek" +
  "oKTN//LD/IY+OLbPtuRdGOla0Ex358myvd7Ws/yIwPp4fs957PlJ/qp+Ov+/ICBOXxDQp88JWNDf" +
  "CrjQpwWM6BMCXvRXATv6mIAgfUBAk75WQJa+SkCZviwgTn8ee05Anz4nYEF/K+BCnxYwok8IeNFf" +
  "BezoRwrM2qPGCEzcAgcIzN1hewWmb+BdAgr3Q7uAyPXTKKBzu7UISF2eYQG1uzkmIHj1BwQ03yxq" +
  "BWRfXKoElN+L6AP0AfoAfYA+QB+gD9AH6AP0AfoAfYA+QB+gD9AH6AP0AfoAfeDv+wBfr0+bD3v7" +
  "ZGZLwyuZAAAAAElFTkSuQmCC";

/**
 * Forty-eight bytes that are not UTF-8 — checked with a fatal `TextDecoder`
 * rather than assumed, since a string of high bytes that happened to decode
 * would make `files/read` succeed and the handoff to the unsupported viewer
 * unreachable.
 */
const GLYPHS_BIN_BASE64 = "R0xZRgAB//7AgAAq7aCA9ZGPvwAQIDD///79AQIDBJyNfm/DKOCAQfCCgqwAABM3";

/**
 * A stand-in tool frontend, as a blob URL.
 *
 * It is a real page in a real iframe running the tool half of transport B: it
 * posts `hello` on load and waits for the shell's `ready` before drawing
 * anything. So mounting it exercises the handshake end to end — including the
 * shell's rule that it answers rather than announces — in a plain browser,
 * with no Tauri and no tool checkout.
 *
 * A blob URL rather than a `data:` URL because a data URL frame has an opaque
 * origin, which arrives as the string `"null"`; the shell replies with
 * `postMessage(reply, event.origin)`, and posting to `"null"` is not a
 * deliverable target. A blob inherits this page's origin, so the reply lands.
 *
 * That inherited origin is also the one way this fixture is unlike production,
 * where a tool is deliberately on its own origin so the protocol's origin
 * checks mean something. It buys the handshake being testable here and nothing
 * else — no shipped code path reads this.
 *
 * Cached per tool id, and that matters: handing back a fresh URL on every
 * render would re-create the iframe, which is precisely the behaviour the
 * shell is supposed to avoid on a tab switch.
 */
const fakePages = new Map<string, string>();

export function fakeToolPage(toolId: string): string {
  const cached = fakePages.get(toolId);
  if (cached) return cached;

  const html = `<!doctype html><meta charset="utf-8"><title>${toolId}</title>
<style>
  html,body{margin:0;height:100%}
  body{background:#14161a;color:#949cab;display:grid;place-items:center;
       font:400 12px/1.6 "IBM Plex Sans",system-ui,sans-serif}
  code{font-family:"IBM Plex Mono",ui-monospace,monospace;color:#d98a3f}
</style>
<div id="s">waiting for <code>ready</code>…</div>
<script>
  // The tool half of transport B. Listen first, then announce — a reply to a
  // hello posted before this listener existed would be gone with no replay.
  addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const d = e.data;
    if (!d || d.helve !== 1 || d.kind !== "ready") return;
    window.__helveReady = d;
    document.getElementById("s").innerHTML =
      '<code>' + d.toolId + '</code> mounted — handshake complete';
  });
  parent.postMessage({ helve: 1, kind: "hello" }, "*");
<\/script>`;

  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  fakePages.set(toolId, url);
  return url;
}

// --- source control ---------------------------------------------------------
//
// The one fixture in this file that is *stateful*, and deliberately so. Every
// other fake here answers the same thing forever, because every other fake
// stands in for something the shell only reads. The source-control panel is a
// loop — stage, look, unstage, commit, look again — and a fixture that answered
// with a frozen list would make the whole loop unmeasurable: the checkbox would
// tick and nothing else would move, which is indistinguishable from the wiring
// being broken.
//
// So `stage`/`unstage` really move an entry between the two arrays and `commit`
// really empties the index. Nothing here talks to git; it is a small mutable
// model of what git would have said.

function fakeChange(path: string, kind: GitFileChange["kind"], staged: boolean): GitFileChange {
  const cut = path.lastIndexOf("/");
  return {
    path,
    file: cut === -1 ? path : path.slice(cut + 1),
    dir: cut === -1 ? "" : path.slice(0, cut),
    kind,
    staged,
  };
}

const fakeGit = {
  branch: "feature/git-source-control",
  ahead: 0,
  behind: 0,
  staged: [] as GitFileChange[],
  unstaged: [
    fakeChange("src/shell/state/git.ts", "modified", false),
    fakeChange("src/shell/worktree/SourceControlView.tsx", "added", false),
    fakeChange("docs/handoffs/git-source-control-plan.md", "untracked", false),
  ],
};

/**
 * Staging an untracked file makes it an addition, and unstaging one puts it
 * back — the same rename git does when a path enters and leaves the index.
 * Without this the fixture would show `untracked` in the staged list, a
 * combination git can never produce.
 */
function fakeStagedKind(kind: GitFileChange["kind"]): GitFileChange["kind"] {
  return kind === "untracked" ? "added" : kind;
}

function fakeMove(from: GitFileChange[], to: GitFileChange[], paths: string[], staged: boolean) {
  for (const path of paths) {
    const at = from.findIndex((c) => c.path === path);
    if (at === -1) continue;
    const [change] = from.splice(at, 1);
    to.push({
      ...change,
      staged,
      kind: staged ? fakeStagedKind(change.kind) : change.kind === "added" ? "untracked" : change.kind,
    });
  }
}

export const fakeGitControl: GitControl = {
  status() {
    // Fresh arrays every call: the panel re-fetches after every mutation and
    // renders from what it gets back, so handing out the live arrays would let
    // a later mutation edit a snapshot React had already been given.
    const status: GitStatus = {
      branch: fakeGit.branch,
      ahead: fakeGit.ahead,
      behind: fakeGit.behind,
      staged: fakeGit.staged.map((c) => ({ ...c })),
      unstaged: fakeGit.unstaged.map((c) => ({ ...c })),
    };
    return Promise.resolve(status);
  },

  diff(_toolId, path, staged) {
    const untracked = fakeGit.unstaged.some((c) => c.path === path && c.kind === "untracked");
    return Promise.resolve({
      original: untracked ? "" : `// ${path}\nexport const helve = {\n  seam: "before",\n};\n`,
      modified: `// ${path}\nexport const helve = {\n  seam: "${staged ? "staged" : "working tree"}",\n  added: true,\n};\n`,
    });
  },

  stage(_toolId, paths) {
    fakeMove(fakeGit.unstaged, fakeGit.staged, paths, true);
    return Promise.resolve();
  },

  unstage(_toolId, paths) {
    fakeMove(fakeGit.staged, fakeGit.unstaged, paths, false);
    return Promise.resolve();
  },

  commit() {
    // What a commit does to the fixture: the index empties, the branch moves
    // one ahead of its upstream — which is the only way the status bar's `↑`
    // becomes reachable under `?fake=1` — and the working tree is left with a
    // single change, so the list visibly shrinks rather than merely re-sorting.
    fakeGit.staged = [];
    fakeGit.unstaged = fakeGit.unstaged.slice(0, 1);
    fakeGit.ahead += 1;
    return Promise.resolve();
  },
};

// --- the fake shell state store ---------------------------------------------
//
// The real backend broadcasts `shell:state` on every mutation — `ShellState`'s
// whole point (`src-tauri/src/shell_state.rs`) is that no window can end up out
// of step with another. `?fake=1` has no backend to do that broadcasting, so
// this is a small stand-in: a mutable terminal list plus a subscriber list,
// mutated by the same fake control functions `state/terminals.ts` calls.
//
// It exists because a static snapshot that never changed would make "+", split,
// and close all invisible to the panel — which is exactly the geometry this
// fixture is supposed to let the split/clear/kill bar be measured against. See
// the module doc above for why `?fake=1` exists at all.

let fakeTerminals: TerminalSessionState[] = [
  { id: "term-1", title: "bash", windowLabel: "main", agentFinished: false, groupId: null },
  { id: "term-2", title: "bash 2", windowLabel: "main", agentFinished: false, groupId: null },
  { id: "term-3", title: "forger", windowLabel: "main", agentFinished: true, groupId: null },
];
let fakeTerminalSerial = 3;

/**
 * The layout, as a real mutable model.
 *
 * Every function in `fakeLayout` below actually changes this and republishes,
 * because the alternative was tried and it does not work. This file's own
 * history is the argument: a hardcoded dock list that *looked* right hid a real
 * empty-switcher-bar bug for as long as the fixture existed, because
 * `ShellState::default` docked nothing and the fixture claimed otherwise. A
 * fixture that disagrees with the backend in the direction of looking healthier
 * is worse than no fixture at all.
 *
 * It matters more here than it did there. Browser verification has been
 * unreachable in this environment, so `?fake=1` is the only way any of the
 * layout work — splitting, dragging a tab between panes, switching clusters —
 * can be exercised by anyone. A no-op fake would make all of it unverifiable
 * while still rendering something.
 *
 * The seed is chosen to make that exercisable on sight: two clusters, so
 * switching is visible, and a row split in the first, so dividers and
 * cross-pane drags have somewhere to go.
 *
 * The two clusters hold **two different projects**, which is the newest thing
 * worth seeing here. Switching between them retitles the bar and re-roots the
 * Files in each — and a fixture where both pointed at the same folder would
 * render exactly as it does today whether the per-cluster wiring worked or not.
 */
let fakeInstances: SurfaceInstance[] = [
  { id: "home-1", appId: "home", kind: "app", title: "Home" },
  { id: "files-1", appId: "files", kind: "app", title: "Files" },
  { id: "files-2", appId: "files", kind: "app", title: "Files" },
];

let fakeWindows: WindowPlacement[] = [
  {
    label: "main",
    clusters: [
      {
        id: "cluster-1",
        name: "orchestrator",
        tree: {
          kind: "split",
          id: "split-1",
          dir: "row",
          sizes: [0.5, 0.5],
          children: [
            { kind: "leaf", id: "pane-1", tabs: ["home-1"], activeTab: "home-1" },
            { kind: "leaf", id: "pane-2", tabs: ["files-1"], activeTab: "files-1" },
          ],
        },
        project: AURORA_ROOT,
        worktree: null,
      },
      {
        id: "cluster-2",
        name: "borealis",
        tree: { kind: "leaf", id: "pane-3", tabs: ["files-2"], activeTab: "files-2" },
        // A different project from the one above, which is the point. Click
        // between the two chips: the title bar changes name and `files-2` shows
        // a different tree from `files-1`.
        project: BOREALIS_ROOT,
        worktree: null,
      },
    ],
    activeClusterId: "cluster-1",
    // The panel's selection is the window's, so switching to `auth` above
    // leaves it exactly where it is. That is the thing to look at under
    // `?fake=1`: the tab strip beside the deck must not change with the cluster.
    activeTerminal: "term-1",
    geometry: null,
  },
];

/** Per-app ordinals, so a second Files becomes `files-3` and not a duplicate. */
const fakeInstanceSerials = new Map<string, number>([
  ["home", 1],
  ["files", 2],
]);
let fakePaneSerial = 3;
let fakeSplitSerial = 1;
let fakeClusterSerial = 2;
/** Minted by `detachCluster`, exactly as `claim_window_label` mints `win-<n>`. */
let fakeWindowSerial = 0;

const fakeShellListeners = new Set<(snapshot: ShellSnapshot) => void>();

function fakeSnapshot(): ShellSnapshot {
  return {
    windows: fakeWindows,
    instances: fakeInstances,
    terminals: fakeTerminals,
    engine: "idle",
  };
}

function publishFakeShellState() {
  // The counterpart of `ShellState::mutate` doing this: every mutation, one
  // place. See `reseatActiveTerminals`.
  reseatActiveTerminals();
  // A fresh array identity per publish, so React sees a change. The nested
  // objects are replaced rather than mutated in place by every mutator below,
  // for the same reason.
  fakeWindows = [...fakeWindows];
  const snapshot = fakeSnapshot();
  for (const cb of fakeShellListeners) cb(snapshot);
}

/**
 * Port of `reseat_active_terminals` in `shell_state.rs` — read that for the
 * rule and why it lives at the one door every mutation goes through.
 *
 * The short version: a window's panel selection has to name one of *that
 * window's* terminals, and never one that has been dragged into a pane tree,
 * because a terminal in a tree draws in the pane area and the panel does not
 * list it at all.
 */
function reseatActiveTerminals(): void {
  fakeWindows = fakeWindows.map((w) => {
    const inATree = w.clusters.flatMap((c) => paneTabsOf(c.tree));
    const isPanelTerminal = (id: string) =>
      fakeTerminals.some((t) => t.id === id && t.windowLabel === w.label) && !inATree.includes(id);

    if (w.activeTerminal && isPanelTerminal(w.activeTerminal)) return w;
    return { ...w, activeTerminal: fakeTerminals.find((t) => isPanelTerminal(t.id))?.id ?? null };
  });
}

export function fakeShellState(): ShellSnapshot {
  return fakeSnapshot();
}

/**
 * Subscribe to the fake terminal list. Mirrors the real `useShellState`'s
 * contract closely enough to stand in for it: called once with the current
 * snapshot, then again on every mutation below.
 */
export function subscribeFakeShellState(cb: (snapshot: ShellSnapshot) => void): () => void {
  fakeShellListeners.add(cb);
  cb(fakeSnapshot());
  return () => {
    fakeShellListeners.delete(cb);
  };
}

/**
 * Mirrors `commands::open_terminal`: a new, ungrouped session in this window's
 * panel. The window, not the cluster it happens to be showing — which is what
 * makes the new tab survive a cluster switch here the same way it does for real.
 */
export function fakeAddTerminal(title: string): string {
  const { id, label } = mintFakeTerminal(title);
  // `ShellState::add_terminal` selects what it just opened, so the panel is
  // showing the terminal the "+" produced rather than the one before it.
  fakeWindows = fakeWindows.map((w) => (w.label === label ? { ...w, activeTerminal: id } : w));
  publishFakeShellState();
  return id;
}

/** A session in the list and nothing else — no selection, no publish. The two
 *  routes below decide those for themselves, exactly as Rust's two do. */
function mintFakeTerminal(title: string): { id: string; label: string } {
  fakeTerminalSerial += 1;
  const id = `term-fake-${fakeTerminalSerial}`;
  const label = fakeWindows[0]?.label ?? "main";
  fakeTerminals = [
    ...fakeTerminals,
    { id, title, windowLabel: label, agentFinished: false, groupId: null },
  ];
  return { id, label };
}

/**
 * Mirrors `ShellState::add_terminal_in_pane`: a session published with its id
 * *already* in the active cluster's tree.
 *
 * Being in a tree is the whole of what makes it a pane terminal rather than a
 * panel one — a terminal is in a panel unless its id appears in a tree, and no
 * second field records which, by design.
 *
 * **One publish, and the panel's selection is deliberately not touched.** Add it
 * to the panel first and move it after and you get what Rust's doc comment
 * describes: the panel jumps to a terminal that is about to leave it, then
 * `reseatActiveTerminals` repairs the selection to whichever panel terminal
 * happens to be first — so opening a terminal in a pane would change which
 * terminal the panel is showing. A fixture that reproduced that would be
 * teaching the bug.
 *
 * `paneId` falling back to the cluster's first pane matches `active_pane`,
 * including its forgiveness of a pane id from a layout that has since changed.
 */
export function fakeAddTerminalInPane(paneId?: string, dir?: SplitDir): string {
  const active = activeClusterId();
  const cluster = active === null ? undefined : findCluster(active);
  // No cluster, no tree, nowhere for a pane terminal to go. Rust refuses this
  // outright (`active_pane` answers `None`); here the panel is the honest
  // fallback, since the session has to be somewhere a tab can be seen.
  if (!cluster || active === null) return fakeAddTerminal("shell");

  const target =
    paneId !== undefined && hasPane(cluster.tree, paneId) ? paneId : firstPaneId(cluster.tree);

  const split = mintSplitIds(dir);
  const { id } = mintFakeTerminal("shell");
  eachCluster((c) =>
    c.id === active ? { ...c, tree: openIntoNode(c.tree, target, id, null, split) } : c,
  );
  publishFakeShellState();
  return id;
}

/** Whether this tree holds a pane with that id. Port of `PaneNode::pane_of_id`. */
function hasPane(node: PaneNode, paneId: string): boolean {
  return node.kind === "leaf" ? node.id === paneId : node.children.some((c) => hasPane(c, paneId));
}

/** Mirrors `ShellState::group_with` — see its doc comment for the rule this
 *  follows: reuse `sourceId`'s group if it has one, mint one if it doesn't. */
export function fakeGroupWith(sourceId: string, id: string): void {
  const source = fakeTerminals.find((t) => t.id === sourceId);
  if (!source) return;
  const groupId = source.groupId ?? `group-${sourceId}`;
  fakeTerminals = fakeTerminals.map((t) => (t.id === sourceId || t.id === id ? { ...t, groupId } : t));
  publishFakeShellState();
}

/**
 * Mirrors `ShellState::set_terminal_title`'s two guards — an empty report is
 * dropped, and one identical to what's already stored is dropped too — so a
 * title reported under `?fake=1` renames a tab the same way a real one does,
 * rather than needing a separate story for "does this actually work" here
 * versus against the real backend. It does not replicate Rust's
 * absolute-path shortening: nothing under `?fake=1` ever reports a real
 * filesystem path, so there is nothing here that would need shortening.
 */
export function fakeSetTitle(id: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const current = fakeTerminals.find((t) => t.id === id);
  if (!current || current.title === trimmed) return;
  fakeTerminals = fakeTerminals.map((t) => (t.id === id ? { ...t, title: trimmed } : t));
  publishFakeShellState();
}

/** Mirrors `close_terminal_pure` in `shell_state.rs`, including the "a group
 *  of one stops being a group" cleanup — see that function's doc comment. */
export function fakeCloseTerminal(id: string): void {
  const closed = fakeTerminals.find((t) => t.id === id);
  fakeTerminals = fakeTerminals.filter((t) => t.id !== id);

  if (closed?.groupId) {
    const survivors = fakeTerminals.filter((t) => t.groupId === closed.groupId);
    if (survivors.length === 1) {
      fakeTerminals = fakeTerminals.map((t) => (t.id === survivors[0].id ? { ...t, groupId: null } : t));
    }
  }
  // A terminal dragged into the layout is a tab as well as a session.
  eachCluster((cluster) => ({ ...cluster, tree: removeTab(cluster.tree, id) }));
  publishFakeShellState();
}

// --- the layout, faked ------------------------------------------------------
//
// These are ports of the pure functions in `src-tauri/src/layout.rs`, and they
// have to stay ports. The point of the fake is that an interaction behaves the
// same way with and without a backend; a tree operation that differed here
// would make `?fake=1` worse than useless, since it would teach the wrong
// behaviour confidently. Where a rule is subtle the Rust file is cited rather
// than the reasoning repeated, so the two cannot drift in explanation either.

function activeClusterId(): string | null {
  return fakeWindows[0]?.activeClusterId ?? null;
}

/** Rewrite every cluster in every window through `f`. */
function eachCluster(f: (cluster: Cluster) => Cluster): void {
  fakeWindows = fakeWindows.map((w) => ({ ...w, clusters: w.clusters.map(f) }));
}

function findCluster(clusterId: string): Cluster | undefined {
  for (const w of fakeWindows) {
    const found = w.clusters.find((c) => c.id === clusterId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Clamp to a 5% floor and scale to sum 1 — the port of `layout::normalize`.
 *
 * The order is the subtlety, and it is explained in full there: clamping first
 * and scaling after divides a just-clamped weight straight back under the
 * floor, so the clamp happens in normalized space and is paid for out of the
 * panes that have slack.
 */
function normalize(sizes: number[]): number[] {
  const n = sizes.length;
  if (n === 0) return sizes;
  const even = 1 / n;
  if (MIN_PANE * n >= 1) return sizes.map(() => even);

  const cleaned = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = cleaned.reduce((a, b) => a + b, 0);
  if (total <= 0) return cleaned.map(() => even);

  const scaled = cleaned.map((s) => s / total);
  const deficit = scaled.reduce((a, s) => a + Math.max(MIN_PANE - s, 0), 0);
  if (deficit <= 0) return scaled;
  const slack = scaled.reduce((a, s) => a + Math.max(s - MIN_PANE, 0), 0);

  return scaled.map((s) =>
    s < MIN_PANE ? MIN_PANE : slack > 0 ? s - deficit * ((s - MIN_PANE) / slack) : s,
  );
}

const MIN_PANE = 0.05;

function isEmptyLeaf(node: PaneNode): boolean {
  return node.kind === "leaf" && node.tabs.length === 0;
}

/** Port of `layout::PaneNode::prune`. Both invariants, both reasons in Rust. */
function prune(node: PaneNode): PaneNode {
  if (node.kind === "leaf") return node;

  const children: PaneNode[] = [];
  const sizes: number[] = [];

  node.children.forEach((raw, i) => {
    const child = prune(raw);
    const size = node.sizes[i] ?? 1 / node.children.length;
    if (isEmptyLeaf(child)) return;

    if (child.kind === "split" && child.dir === node.dir) {
      // Same-direction nesting is a distinction without a difference on screen.
      child.children.forEach((grandchild, j) => {
        children.push(grandchild);
        sizes.push(size * (child.sizes[j] ?? 1 / child.children.length));
      });
      return;
    }
    children.push(child);
    sizes.push(size);
  });

  if (children.length === 1) return children[0];
  if (children.length === 0) return { kind: "leaf", id: node.id, tabs: [], activeTab: null };
  return { ...node, children, sizes: normalize(sizes) };
}

/** Port of `insert_tab`: remove first, so a same-pane reorder cannot clone. */
function insertTab(
  node: PaneNode,
  paneId: string,
  instanceId: string,
  index: number | null,
): PaneNode {
  if (node.kind === "split") {
    return { ...node, children: node.children.map((c) => insertTab(c, paneId, instanceId, index)) };
  }
  if (node.id !== paneId) return node;

  const tabs = node.tabs.filter((t) => t !== instanceId);
  const at = Math.min(index ?? tabs.length, tabs.length);
  tabs.splice(at, 0, instanceId);
  return { ...node, tabs, activeTab: instanceId };
}

/** Port of `remove_tab`, including its neighbour-focus rule, then `prune`. */
function removeTab(node: PaneNode, instanceId: string): PaneNode {
  return prune(removeTabInner(node, instanceId));
}

function removeTabInner(node: PaneNode, instanceId: string): PaneNode {
  if (node.kind === "split") {
    return { ...node, children: node.children.map((c) => removeTabInner(c, instanceId)) };
  }
  const i = node.tabs.indexOf(instanceId);
  if (i === -1) return node;

  const tabs = node.tabs.filter((t) => t !== instanceId);
  const activeTab =
    node.activeTab === instanceId ? (tabs[i] ?? tabs[tabs.length - 1] ?? null) : node.activeTab;
  return { ...node, tabs, activeTab };
}

function activateTab(node: PaneNode, instanceId: string): PaneNode {
  if (node.kind === "split") {
    return { ...node, children: node.children.map((c) => activateTab(c, instanceId)) };
  }
  return node.tabs.includes(instanceId) ? { ...node, activeTab: instanceId } : node;
}

function splitPaneNode(
  node: PaneNode,
  paneId: string,
  dir: SplitDir,
  splitId: string,
  newPaneId: string,
  instanceId: string,
  before: boolean,
): PaneNode {
  if (node.kind === "split") {
    return {
      ...node,
      children: node.children.map((c) =>
        splitPaneNode(c, paneId, dir, splitId, newPaneId, instanceId, before),
      ),
    };
  }
  if (node.id !== paneId) return node;

  const fresh: PaneNode = {
    kind: "leaf",
    id: newPaneId,
    tabs: [instanceId],
    activeTab: instanceId,
  };
  return {
    kind: "split",
    id: splitId,
    dir,
    sizes: [0.5, 0.5],
    children: before ? [fresh, node] : [node, fresh],
  };
}

/**
 * How many panes a tree draws. Port of `PaneNode::pane_count`, and the number
 * `MAX_AUTO_PANES` below is counted against.
 */
function paneCount(node: PaneNode): number {
  return node.kind === "leaf" ? 1 : node.children.reduce((n, c) => n + paneCount(c), 0);
}

/** Whether `paneId` names a leaf holding nothing. Port of `pane_is_empty`. */
function paneIsEmpty(node: PaneNode, paneId: string): boolean {
  return node.kind === "leaf"
    ? node.id === paneId && node.tabs.length === 0
    : node.children.some((c) => paneIsEmpty(c, paneId));
}

/**
 * The ceiling on the automatic split. Mirrors `layout::MAX_AUTO_PANES`, which
 * is where the number is argued for — four, because a 2×2 grid is the largest
 * arrangement that still reads as several things rather than a mosaic.
 */
const MAX_AUTO_PANES = 4;

/**
 * Where a newly opened surface goes. Port of `PaneNode::open_into`, and the
 * whole reason it is a port rather than a second implementation: `?fake=1` is
 * how this shell is looked at without a backend, so a fixture that stacked
 * where Rust splits would make the browser a liar about the one behaviour
 * somebody is checking. The rule, its two refusals and the ceiling are all
 * documented on the Rust side; this only has to agree with them.
 */
function openIntoNode(
  node: PaneNode,
  paneId: string,
  instanceId: string,
  index: number | null,
  split: { dir: SplitDir; splitId: string; newPaneId: string } | null,
): PaneNode {
  if (split && paneCount(node) < MAX_AUTO_PANES && !paneIsEmpty(node, paneId)) {
    return splitPaneNode(node, paneId, split.dir, split.splitId, split.newPaneId, instanceId, false);
  }
  return insertTab(node, paneId, instanceId, index);
}

/**
 * The two ids a split needs, taken from the same serials Rust takes them from.
 * `null` when no direction was measured, so nothing is minted for an open that
 * was never going to split — the same thrift `ShellState::open_instance` shows.
 */
function mintSplitIds(dir?: SplitDir): { dir: SplitDir; splitId: string; newPaneId: string } | null {
  if (!dir) return null;
  fakeSplitSerial += 1;
  fakePaneSerial += 1;
  return { dir, splitId: `split-${fakeSplitSerial}`, newPaneId: `pane-${fakePaneSerial}` };
}

function setSizesNode(node: PaneNode, splitId: string, sizes: number[]): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) {
    // A count that disagrees with the children means the caller measured a tree
    // that has since changed; guessing would rearrange the layout silently.
    if (sizes.length !== node.children.length) return node;
    return { ...node, sizes: normalize(sizes) };
  }
  return { ...node, children: node.children.map((c) => setSizesNode(c, splitId, sizes)) };
}

/** The no-backend stand-in for every layout mutation in `shellState.ts`. */
export const fakeLayout = {
  openInstance(_label: string, appId: string, paneId?: string, dir?: SplitDir): Promise<string> {
    const active = activeClusterId();
    // No cluster, nowhere to put it — `ShellState::open_instance` returns
    // `None` here and publishes nothing, so nothing is minted. Refused rather
    // than half-done: without this the fixture would add the instance to the
    // flat list and into no tree, leaving a surface that exists and is drawn
    // nowhere. The Apps menu is disabled in this state, so reaching it means
    // something else went wrong and should say so.
    if (active === null) {
      return Promise.reject(
        rpcError(HelveErrorCode.InternalError, "there is no cluster in this window to open into"),
      );
    }

    const ordinal = (fakeInstanceSerials.get(appId) ?? 0) + 1;
    fakeInstanceSerials.set(appId, ordinal);
    const id = `${appId}-${ordinal}`;
    const title = fakeApps().find((a) => a.id === appId)?.name ?? appId;

    const split = mintSplitIds(dir);
    fakeInstances = [...fakeInstances, { id, appId, kind: "app", title }];
    eachCluster((cluster) => {
      if (cluster.id !== active) return cluster;
      const target = paneId ?? firstPaneId(cluster.tree);
      return { ...cluster, tree: openIntoNode(cluster.tree, target, id, null, split) };
    });
    publishFakeShellState();
    return Promise.resolve(id);
  },

  closeInstance(instanceId: string): Promise<void> {
    eachCluster((cluster) => ({ ...cluster, tree: removeTab(cluster.tree, instanceId) }));
    fakeInstances = fakeInstances.filter((i) => i.id !== instanceId);
    publishFakeShellState();
    return Promise.resolve();
  },

  activateInstance(instanceId: string): Promise<void> {
    fakeWindows = fakeWindows.map((w) => {
      const owner = w.clusters.find((c) => paneOfTabIn(c.tree, instanceId));
      return {
        ...w,
        activeClusterId: owner ? owner.id : w.activeClusterId,
        clusters: w.clusters.map((c) => ({ ...c, tree: activateTab(c.tree, instanceId) })),
      };
    });
    publishFakeShellState();
    return Promise.resolve();
  },

  moveInstance(
    instanceId: string,
    clusterId: string,
    paneId: string,
    index: number | null,
  ): Promise<void> {
    // Out of everywhere else before in anywhere, so a cross-pane move cannot
    // leave a copy behind. Mirrors `ShellState::move_instance`.
    eachCluster((cluster) =>
      cluster.id === clusterId ? cluster : { ...cluster, tree: removeTab(cluster.tree, instanceId) },
    );
    eachCluster((cluster) =>
      cluster.id === clusterId
        ? { ...cluster, tree: prune(insertTab(cluster.tree, paneId, instanceId, index)) }
        : cluster,
    );
    publishFakeShellState();
    return Promise.resolve();
  },

  splitPane(paneId: string, dir: SplitDir, instanceId: string, before: boolean): Promise<void> {
    fakeSplitSerial += 1;
    fakePaneSerial += 1;
    const splitId = `split-${fakeSplitSerial}`;
    const newPaneId = `pane-${fakePaneSerial}`;

    eachCluster((cluster) => ({ ...cluster, tree: removeTabInner(cluster.tree, instanceId) }));
    eachCluster((cluster) => ({
      ...cluster,
      tree: prune(
        splitPaneNode(cluster.tree, paneId, dir, splitId, newPaneId, instanceId, before),
      ),
    }));
    publishFakeShellState();
    return Promise.resolve();
  },

  setPaneSizes(splitId: string, sizes: number[]): Promise<void> {
    eachCluster((cluster) => ({ ...cluster, tree: setSizesNode(cluster.tree, splitId, sizes) }));
    publishFakeShellState();
    return Promise.resolve();
  },

  addCluster(label: string, name: string): Promise<string | null> {
    fakeClusterSerial += 1;
    fakePaneSerial += 1;
    const id = `cluster-${fakeClusterSerial}`;
    fakeWindows = fakeWindows.map((w) =>
      w.label === label
        ? {
            ...w,
            clusters: [
              ...w.clusters,
              {
                id,
                name,
                tree: { kind: "leaf", id: `pane-${fakePaneSerial}`, tabs: [], activeTab: null },
                // No project, matching `ShellState::add_cluster`. Not inherited
                // from the cluster this was added beside and no picker raised —
                // the Home that opens below draws the pick-a-project state, and
                // that state is reachable in a browser only because this is
                // `null` rather than a convenient guess.
                project: null,
                worktree: null,
              },
            ],
            activeClusterId: id,
          }
        : w,
    );
    // Home, exactly as `commands::add_cluster` does it — and for the same
    // reason it composes rather than folding the surface into the primitive.
    // `openInstance` acts on the active cluster, which the map above has just
    // made this one. It publishes, so nothing publishes twice here.
    return this.openInstance(label, "home").then(() => id);
  },

  setActiveCluster(label: string, clusterId: string | null): Promise<void> {
    fakeWindows = fakeWindows.map((w) =>
      // The guard `ShellState::set_active_cluster` carries, and for the reason
      // written there: the click that ends a chip's drag arrives after the chip
      // has left, asking for a cluster the window no longer holds.
      w.label === label && (clusterId === null || w.clusters.some((c) => c.id === clusterId))
        ? { ...w, activeClusterId: clusterId }
        : w,
    );
    publishFakeShellState();
    return Promise.resolve();
  },

  renameCluster(clusterId: string, name: string): Promise<void> {
    eachCluster((cluster) => (cluster.id === clusterId ? { ...cluster, name } : cluster));
    publishFakeShellState();
    return Promise.resolve();
  },

  /**
   * Close a cluster and everything in its tree — including the last cluster in
   * a window, which is now allowed.
   *
   * `activeClusterId` falls to `null` when there is nothing left to fall to,
   * and that `null` is the state worth clicking through here: the app area
   * draws `NoClustersState` and the terminal panel beside it keeps working,
   * because a panel terminal is the window's and was never in any cluster's
   * tree. That last part is the one this fixture can actually get wrong, so it
   * is worth checking by eye — close both chips and the shells must still be
   * there.
   *
   * `detachCluster` below reaches the same state by the other route, and no
   * longer refuses to move the last cluster out. See `move_cluster_pure` in
   * `shell_state.rs`.
   */
  closeCluster(clusterId: string): Promise<void> {
    const gone = findCluster(clusterId);
    const held = gone ? paneTabsOf(gone.tree) : [];

    fakeWindows = fakeWindows.map((w) => {
      const i = w.clusters.findIndex((c) => c.id === clusterId);
      if (i === -1) return w;
      const clusters = w.clusters.filter((c) => c.id !== clusterId);
      return {
        ...w,
        clusters,
        activeClusterId:
          w.activeClusterId === clusterId
            ? // The neighbour rule tabs use: whatever slid into the vacated
              // position, or the last one.
              (clusters[i]?.id ?? clusters[clusters.length - 1]?.id ?? null)
            : w.activeClusterId,
      };
    });

    // Only what was in its *tree*, terminals included — mirrors
    // `ShellState::close_cluster`. A terminal in the panel is the window's and
    // has nothing to do with the cluster being closed.
    fakeTerminals = fakeTerminals.filter((t) => !held.includes(t.id));
    fakeInstances = fakeInstances.filter((i) => !held.includes(i.id));
    publishFakeShellState();
    return Promise.resolve();
  },

  /**
   * Port of `move_cluster_pure` in `shell_state.rs` — read that for the one
   * refusal and for why the terminals in the tree have to be rewritten.
   *
   * One thing here is not a faithful picture, and it cannot be: `?fake=1` has no
   * backend and so no way to open an OS window. A cluster detached to a fresh
   * label is moved into a `WindowPlacement` this page does not draw, so on
   * screen it simply leaves the row. That is the state being correct rather than
   * the fixture being broken — for real, a window opens beside it holding
   * exactly that cluster.
   *
   * What is worth exercising here is the rest of it: that the window's selection
   * falls to a survivor rather than pointing at something that has gone, and
   * that a window emptied by dragging its last cluster out draws
   * `NoClustersState` with its terminal panel intact. That last case used to be
   * refused here and in Rust; it is not any more, and this fixture has to agree
   * or clicking through `?fake=1` teaches the wrong rule.
   */
  detachCluster(clusterId: string, toLabel: string | null): Promise<void> {
    const source = fakeWindows.find((w) => w.clusters.some((c) => c.id === clusterId));
    // A cluster nobody holds. The only refusal left.
    if (!source) return Promise.resolve();
    // Already where it was asked to be.
    if (toLabel === source.label) return Promise.resolve();

    const i = source.clusters.findIndex((c) => c.id === clusterId);
    const cluster = source.clusters[i];
    const remaining = source.clusters.filter((c) => c.id !== clusterId);
    const label = toLabel ?? `win-${(fakeWindowSerial += 1)}`;
    const held = paneTabsOf(cluster.tree);

    fakeWindows = fakeWindows.map((w) =>
      w.label === source.label
        ? {
            ...w,
            clusters: remaining,
            // The neighbour rule again: whatever slid into the vacated
            // position, or the last one. Shared with `closeCluster` in Rust;
            // here the two read alike rather than sharing a helper.
            activeClusterId:
              w.activeClusterId === clusterId
                ? (remaining[i]?.id ?? remaining[remaining.length - 1]?.id ?? null)
                : w.activeClusterId,
          }
        : w,
    );

    // A terminal in the moved tree is on screen in the new window now, so the
    // panel it would return to has to be that window's.
    fakeTerminals = fakeTerminals.map((t) =>
      held.includes(t.id) ? { ...t, windowLabel: label } : t,
    );

    fakeWindows = fakeWindows.some((w) => w.label === label)
      ? fakeWindows.map((w) =>
          w.label === label
            ? { ...w, clusters: [...w.clusters, cluster], activeClusterId: cluster.id }
            : w,
        )
      : [
          ...fakeWindows,
          {
            label,
            clusters: [cluster],
            activeClusterId: cluster.id,
            activeTerminal: null,
            geometry: null,
          },
        ];

    publishFakeShellState();
    return Promise.resolve();
  },

  setActiveTerminal(label: string, id: string | null): Promise<void> {
    fakeWindows = fakeWindows.map((w) => (w.label === label ? { ...w, activeTerminal: id } : w));
    publishFakeShellState();
    return Promise.resolve();
  },

  /**
   * Mirrors `ShellState::move_terminal`. Leaving the tree is the half that
   * matters under `?fake=1`, since there is only one window to move between:
   * this is the path a terminal takes when it is dragged out of a pane and back
   * onto the panel, and without it the drag would look like it did nothing.
   */
  moveTerminal(id: string, toLabel: string): Promise<void> {
    eachCluster((cluster) => ({ ...cluster, tree: removeTab(cluster.tree, id) }));
    fakeTerminals = fakeTerminals.map((t) => (t.id === id ? { ...t, windowLabel: toLabel } : t));
    fakeWindows = fakeWindows.map((w) => (w.label === toLabel ? { ...w, activeTerminal: id } : w));
    publishFakeShellState();
    return Promise.resolve();
  },

  setInstanceTitle(instanceId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return Promise.resolve();
    const current = fakeInstances.find((i) => i.id === instanceId);
    if (!current || current.title === trimmed) return Promise.resolve();
    fakeInstances = fakeInstances.map((i) => (i.id === instanceId ? { ...i, title: trimmed } : i));
    publishFakeShellState();
    return Promise.resolve();
  },
};

function firstPaneId(node: PaneNode): string {
  return node.kind === "leaf" ? node.id : firstPaneId(node.children[0] ?? node);
}

function paneTabsOf(node: PaneNode): string[] {
  return node.kind === "leaf" ? node.tabs : node.children.flatMap(paneTabsOf);
}

function paneOfTabIn(node: PaneNode, instanceId: string): boolean {
  return node.kind === "leaf"
    ? node.tabs.includes(instanceId)
    : node.children.some((c) => paneOfTabIn(c, instanceId));
}

// --- layout presets, faked ---------------------------------------------------
//
// A port of `src-tauri/src/presets/mod.rs`, and it has to stay one, for the
// reason the layout section above gives at length: a fake that behaved
// differently from the backend would teach the wrong behaviour confidently.
//
// It earns the duplication the same way that section does. Applying a preset is
// the single most consequential gesture this feature has — it rearranges a whole
// cluster in one click — and the rule that makes it safe is that *nothing open
// is ever closed*. That rule is testable in Rust and clickable only here.
//
// Where the Rust file is subtle, it is cited rather than re-explained, so the
// two cannot drift in reasoning even where they drift in code.

/** Rust's `presets::BUILTIN_PREFIX`. No user preset's id may begin with it. */
const FAKE_BUILTIN_PREFIX = "builtin:";

/** Rust's `presets::MAX_DEPTH`. */
const FAKE_MAX_PRESET_DEPTH = 6;

function presetAppPane(appId: string): PresetNode {
  return { kind: "pane", slots: [{ kind: "app", appId }] };
}

function presetTerminalPane(): PresetNode {
  return { kind: "pane", slots: [{ kind: "terminal" }] };
}

/**
 * `presets::builtins`, restated — the same three, in the same order, with the
 * same ids and weights.
 *
 * Like `fakeApps` above, this is a copy of a table in another language and is
 * the one thing in this section that can go stale without anything noticing. It
 * is a copy anyway because the built-ins are the *whole* of what the menu shows
 * before anyone has saved anything, and a submenu that was empty here and full
 * in the packaged app is precisely the disagreement this file exists to avoid.
 */
function fakeBuiltinPresets(): LayoutPreset[] {
  return [
    {
      id: `${FAKE_BUILTIN_PREFIX}files-and-terminal`,
      name: "Files & Terminal",
      builtin: true,
      root: {
        kind: "split",
        dir: "row",
        sizes: [0.65, 0.35],
        children: [presetAppPane("files"), presetTerminalPane()],
      },
    },
    {
      id: `${FAKE_BUILTIN_PREFIX}two-files`,
      name: "Two Files",
      builtin: true,
      root: {
        kind: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [presetAppPane("files"), presetAppPane("files")],
      },
    },
    {
      id: `${FAKE_BUILTIN_PREFIX}files-over-terminal`,
      name: "Files over Terminal",
      builtin: true,
      root: {
        kind: "split",
        dir: "column",
        sizes: [0.7, 0.3],
        children: [presetAppPane("files"), presetTerminalPane()],
      },
    },
  ];
}

/**
 * The user's own, in memory only.
 *
 * There is no `presets.json` in a browser and inventing one would be a lie of
 * the kind this file refuses elsewhere. What survives here is the session, which
 * is enough to exercise the thing worth exercising: save an arrangement, switch
 * cluster, apply it, watch what was already open land where the rule says it
 * should.
 */
let fakeUserPresets: LayoutPreset[] = [];
const fakePresetListeners = new Set<(presets: LayoutPreset[]) => void>();

/** Port of `presets::merge`, including every reason it drops an entry. */
function mergeFakePresets(): LayoutPreset[] {
  const out = fakeBuiltinPresets();
  for (const preset of fakeUserPresets) {
    if (preset.id.startsWith(FAKE_BUILTIN_PREFIX)) continue;
    if (!preset.id.trim() || !preset.name.trim()) continue;
    if (out.some((p) => p.id === preset.id)) continue;
    if (out.some((p) => p.name.toLowerCase() === preset.name.toLowerCase())) continue;
    out.push({ ...preset, builtin: false, root: normalizePreset(preset.root, 0) });
  }
  return out;
}

function publishFakePresets(): void {
  const merged = mergeFakePresets();
  for (const cb of fakePresetListeners) cb(merged);
}

/** Port of `PresetNode::normalized`. Read that for what each repair is for. */
function normalizePreset(node: PresetNode, depth: number): PresetNode {
  if (node.kind === "pane") {
    return {
      kind: "pane",
      slots: node.slots.filter(
        (slot) => slot.kind === "terminal" || fakeApps().some((a) => a.id === slot.appId),
      ),
    };
  }

  if (depth >= FAKE_MAX_PRESET_DEPTH) {
    const first = node.children[0];
    return first ? normalizePreset(first, depth) : { kind: "pane", slots: [] };
  }

  const children: PresetNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((raw, i) => {
    const child = normalizePreset(raw, depth + 1);
    if (child.kind === "pane" && child.slots.length === 0) return;
    children.push(child);
    sizes.push(node.sizes[i] ?? 1 / node.children.length);
  });

  if (children.length === 0) return { kind: "pane", slots: [] };
  if (children.length === 1) return children[0];
  // Through the same `normalize` the live tree uses, so a preset cannot
  // describe a split the layout engine would refuse to draw.
  return { ...node, children, sizes: normalize(sizes) };
}

// No port of `PresetNode::pane_count` / `split_count`. Rust needs them because
// it mints its ids from `Counters` before taking the state lock — see
// `ShellState::apply_preset` — and there is no lock here, so `planPreset` takes
// the next serial as it reaches each node.

/** What a tab id is, as a slot. Port of `shell_state::resolve_slot`. */
function fakeSlotOfTab(id: string): PresetSlot | null {
  const instance = fakeInstances.find((i) => i.id === id);
  if (instance) return { kind: "app", appId: instance.appId };
  return fakeTerminals.some((t) => t.id === id) ? { kind: "terminal" } : null;
}

function sameSlot(a: PresetSlot | null, b: PresetSlot): boolean {
  if (a === null) return false;
  if (a.kind === "terminal" || b.kind === "terminal") return a.kind === b.kind;
  return a.appId === b.appId;
}

/** Port of `presets::capture`: the shape, the apps, and none of the ids. */
function capturePreset(node: PaneNode): PresetNode {
  const raw: PresetNode =
    node.kind === "leaf"
      ? {
          kind: "pane",
          slots: node.tabs
            .map(fakeSlotOfTab)
            .filter((slot): slot is PresetSlot => slot !== null),
        }
      : {
          kind: "split",
          dir: node.dir,
          sizes: [...node.sizes],
          children: node.children.map(capturePreset),
        };
  return normalizePreset(raw, 0);
}

interface FakeGap {
  paneId: string;
  /** `null` when appending lands it in the right place. See `presets::Gap`. */
  index: number | null;
  slot: PresetSlot;
}

/**
 * Port of `presets::plan`, and **the rule is the point**: a surface matching a
 * slot moves into it, a slot with nothing to fill it comes back as a gap, and
 * everything else lands in the last pane. Nothing is ever closed.
 */
function planPreset(
  root: PresetNode,
  existing: { id: string; fills: PresetSlot | null }[],
): { tree: PaneNode; gaps: FakeGap[] } {
  const claimed = new Set<string>();
  const gaps: FakeGap[] = [];

  const build = (node: PresetNode): PaneNode => {
    if (node.kind === "split") {
      fakeSplitSerial += 1;
      const id = `split-${fakeSplitSerial}`;
      return { kind: "split", id, dir: node.dir, sizes: [...node.sizes], children: node.children.map(build) };
    }

    fakePaneSerial += 1;
    const paneId = `pane-${fakePaneSerial}`;
    const tabs: string[] = [];
    node.slots.forEach((slot, index) => {
      const match = existing.find((e) => !claimed.has(e.id) && sameSlot(e.fills, slot));
      if (match) {
        claimed.add(match.id);
        tabs.push(match.id);
        return;
      }
      gaps.push({ paneId, index: node.slots.length > 1 ? index : null, slot });
    });
    return { kind: "leaf", id: paneId, tabs, activeTab: tabs[0] ?? null };
  };

  const tree = build(root);

  // Written straight into the last leaf rather than through `insertTab`, which
  // would make each leftover the pane's active tab in turn — the tab a pane
  // shows should be the one the preset asked for.
  const leftovers = existing.filter((e) => !claimed.has(e.id)).map((e) => e.id);
  if (leftovers.length > 0) {
    const last = lastLeafOf(tree);
    last.tabs = [...last.tabs, ...leftovers];
    last.activeTab ??= leftovers[0];
  }

  return { tree, gaps };
}

function lastLeafOf(node: PaneNode): Extract<PaneNode, { kind: "leaf" }> {
  if (node.kind === "leaf") return node;
  const last = node.children[node.children.length - 1];
  return last ? lastLeafOf(last) : { kind: "leaf", id: node.id, tabs: [], activeTab: null };
}

/** The no-backend stand-in for `state/presets.ts`. */
export const fakePresets = {
  /** Mirrors `useLayoutPresets`: the current list now, then every change. */
  subscribe(cb: (presets: LayoutPreset[]) => void): () => void {
    fakePresetListeners.add(cb);
    cb(mergeFakePresets());
    return () => {
      fakePresetListeners.delete(cb);
    };
  },

  /**
   * Mirrors `commands::save_preset`, refusals included.
   *
   * The built-in name check is copied rather than paraphrased for the reason
   * this file gives about the not-UTF-8 and stale-write messages: a fixture
   * whose refusals read differently from the backend's teaches whoever hits one
   * to go looking in the wrong place. It rejects with a bare string, which is
   * what Rust's `AppError` serializes to and what the name field renders.
   */
  save(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      return Promise.reject("a preset needs a name to be found by");
    }
    const clash = fakeBuiltinPresets().find(
      (b) => b.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (clash) {
      return Promise.reject(
        `"${clash.name}" is one of HELVE's own presets, so it cannot be replaced — pick another name`,
      );
    }

    const active = activeClusterId();
    const cluster = active === null ? undefined : findCluster(active);
    if (!cluster) return Promise.reject("this window has no cluster to save the arrangement of");

    const root = capturePreset(cluster.tree);
    const existing = fakeUserPresets.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      // Saving over a name replaces it, and keeps its id — the only way this
      // build has of editing a preset. See `presets::save`.
      fakeUserPresets = fakeUserPresets.map((p) =>
        p === existing ? { ...p, name: trimmed, root } : p,
      );
    } else {
      fakeUserPresets = [
        ...fakeUserPresets,
        { id: mintFakePresetId(trimmed), name: trimmed, builtin: false, root },
      ];
    }

    publishFakePresets();
    return Promise.resolve();
  },

  /**
   * Mirrors `commands::apply_preset`: rearrange in one step, then fill the gaps
   * through the same doors everything else opens surfaces through.
   *
   * The terminal case is the one worth watching here. A terminal in a pane *is*
   * a session whose id appears in a tree — there is no second representation —
   * so this opens one into the panel and then moves it into the pane, which is
   * exactly what dragging its tab there does.
   */
  async apply(presetId: string): Promise<void> {
    const preset = mergeFakePresets().find((p) => p.id === presetId);
    if (!preset) return Promise.reject(`no preset with id \`${presetId}\``);

    const active = activeClusterId();
    const cluster = active === null ? undefined : findCluster(active);
    if (active === null || !cluster) {
      return Promise.reject("this window has no cluster to apply a preset to");
    }

    const existing = paneTabsOf(cluster.tree).map((id) => ({ id, fills: fakeSlotOfTab(id) }));
    const { tree, gaps } = planPreset(preset.root, existing);

    eachCluster((c) => (c.id === active ? { ...c, tree } : c));
    publishFakeShellState();

    const label = fakeWindows[0]?.label ?? "main";
    for (const gap of gaps) {
      if (gap.slot.kind === "app") {
        const id = await fakeLayout.openInstance(label, gap.slot.appId, gap.paneId);
        // Only a pane holding more than one slot can need this; see
        // `presets::Gap.index`.
        if (gap.index !== null) {
          await fakeLayout.moveInstance(id, active, gap.paneId, gap.index);
        }
      } else {
        const id = fakeAddTerminal("bash");
        await fakeLayout.moveInstance(id, active, gap.paneId, gap.index);
      }
    }
  },
};

/** Port of `presets::mint_id`: a slug of the name, numbered if it is taken. */
function mintFakePresetId(name: string): string {
  let slug = "";
  for (const ch of name) {
    if (/[a-zA-Z0-9]/.test(ch)) slug += ch.toLowerCase();
    else if (!slug.endsWith("-")) slug += "-";
  }
  const base = slug.replace(/^-+|-+$/g, "") || "preset";
  const taken = fakeUserPresets.map((p) => p.id);
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  }
}
