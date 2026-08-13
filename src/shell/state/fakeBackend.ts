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
import type { ResolvedTool, StackSnapshot } from "../../bindings";
import type { GitControl, GitFileChange, GitStatus } from "../contract";
import type { ShellSnapshot } from "./shellState";

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

/** The handoff's default screen: three terminals, one agent finished. */
export function fakeShellState(): ShellSnapshot {
  return {
    windows: [
      {
        label: "main",
        toolIds: ["forger", "journeyman", "turner", "scrivener", "quickener", "wright"],
        activeToolId: "forger",
      },
    ],
    terminals: [
      { id: "term-1", title: "bash", windowLabel: "main", agentFinished: false },
      { id: "term-2", title: "bash 2", windowLabel: "main", agentFinished: false },
      { id: "term-3", title: "forger", windowLabel: "main", agentFinished: true },
    ],
    engine: "idle",
  };
}
