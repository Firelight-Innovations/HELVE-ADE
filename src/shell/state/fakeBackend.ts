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
import type { AppInfo, ResolvedTool, StackSnapshot } from "../../bindings";
import type { ShellSnapshot, TerminalSessionState } from "./shellState";

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

// --- the fake project store --------------------------------------------------
//
// Home is the one app worth answering under `?fake=1`. It is what the shell
// opens on, its layout is the thing most worth measuring in a browser, and every
// state it can be in — a project open, none open, a recent whose folder has gone
// — is a *layout*, which is exactly what this fixture exists to make reachable.
//
// Files is deliberately left rejecting. Answering it would mean faking a
// filesystem, and a fake directory tree is a much larger lie than a fake list of
// four projects: it would have to invent file sizes, nesting, and read errors,
// none of which the pane's geometry actually depends on.
//
// The three actions that open a *native folder picker* are not faked either.
// There is no picker in a browser, and inventing a folder the user did not
// choose would make this fixture disagree with the backend in the direction of
// looking healthier — the exact failure that hid the empty switcher bar. They
// reject, and Home draws the error path it would draw for any other refusal.

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
  {
    name: "Torn Apart",
    path: "C:\\Users\\bjsea\\Documents\\games\\Torn Apart",
    id: "0000000000000001a1b2c3d4e5f60001",
    initialized: true,
    exists: true,
    lastOpened: Date.now() - 2 * HOUR,
    modified: Date.now() - HOUR,
  },
  {
    name: "ACRE Turbulence",
    path: "C:\\Users\\bjsea\\Documents\\games\\ACRE Turbulence",
    id: "0000000000000002a1b2c3d4e5f60002",
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
    id: "0000000000000004a1b2c3d4e5f60004",
    initialized: false,
    exists: false,
    lastOpened: Date.now() - 200 * 24 * HOUR,
    modified: null,
  },
];

let fakeOpen: string | null = null;

function fakeProjectState() {
  return {
    open: fakeProjects.find((p) => p.path === fakeOpen) ?? null,
    recents: fakeProjects,
  };
}

/**
 * Answer one app `invoke` from a fixture, or `undefined` to let the caller
 * refuse it as it always has. See the note above for what is answered and why
 * the rest is not.
 */
export function fakeAppCall(method: string, params?: unknown): unknown | undefined {
  const path = (params as { path?: string } | undefined)?.path;

  switch (method) {
    case "home/state":
      return { ...fakeProjectState(), version: "0.1.0" };

    case "home/open-recent":
      if (fakeProjects.some((p) => p.path === path && p.exists)) fakeOpen = path ?? null;
      return fakeProjectState();

    case "home/initialize-project":
      fakeProjects = fakeProjects.map((p) => (p.path === path ? { ...p, initialized: true } : p));
      return fakeProjectState();

    case "home/forget-recent":
      fakeProjects = fakeProjects.filter((p) => p.path !== path);
      return fakeProjectState();

    case "home/close-project":
      fakeOpen = null;
      return fakeProjectState();

    default:
      return undefined;
  }
}

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

const fakeShellListeners = new Set<(snapshot: ShellSnapshot) => void>();

function fakeSnapshot(): ShellSnapshot {
  return {
    windows: [
      {
        label: "main",
        // The apps, and only the apps — what `WindowRoot`'s seeding effect
        // docks against the real backend now that the tools are held back
        // until the broker exists.
        //
        // This list being hardcoded is what hid a real bug for as long as it
        // existed: `ShellState::default` docks *nothing*, and nothing on the
        // frontend ever docked anything either, so the packaged app opened with
        // an empty switcher bar while `?fake=1` showed a full one. A fixture
        // that disagrees with the backend in the direction of looking healthier
        // is worse than no fixture. It stays hardcoded — a fake of a broadcast
        // has to say something — but it now says what the real path produces.
        //
        // The six tools stay in `fakeStack()` regardless, two of them unhealthy:
        // they are what the warning badge reports on, and dropping them here
        // would leave that fixture's whole reason for existing untestable.
        toolIds: ["home", "files"],
        activeToolId: "home",
      },
    ],
    terminals: fakeTerminals,
    engine: "idle",
  };
}

function publishFakeShellState() {
  const snapshot = fakeSnapshot();
  for (const cb of fakeShellListeners) cb(snapshot);
}

/** The handoff's default screen: three terminals, one agent finished. */
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

/** Mirrors `commands::open_terminal`: a new, ungrouped session. */
export function fakeAddTerminal(title: string): string {
  fakeTerminalSerial += 1;
  const id = `term-fake-${fakeTerminalSerial}`;
  fakeTerminals = [...fakeTerminals, { id, title, windowLabel: "main", agentFinished: false, groupId: null }];
  publishFakeShellState();
  return id;
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
  publishFakeShellState();
}
