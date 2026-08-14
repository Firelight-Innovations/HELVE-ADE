/**
 * The seam every region plugs into.
 *
 * Each of the six regions is built independently against this file and nothing
 * else. A region never imports another region's source — it receives what it
 * needs as props typed here, and hands back what it produces the same way. That
 * is what lets the regions be built in parallel without them growing into each
 * other.
 *
 * Two of the review's rules are enforced here rather than written down and
 * hoped for:
 *
 *   * No version number reaches the interface. `ToolPresentation` has no
 *     version field, and `toolPresentation()` is the only way to turn a
 *     `ResolvedTool` into something a component can render. A component that
 *     wants to print a version has to go out of its way to get one.
 *
 *   * No backend vocabulary reaches the interface. The backend's four states
 *     are `ready | mismatch | unversioned | missing`; the user reads "needs
 *     update", "not tracked", "not installed". The mapping happens once, below.
 */
import type { ReactNode } from "react";
import type { AppInfo, ResolvedTool, ToolStatus } from "../bindings";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * How a tool's resolution state appears to a person.
 *
 * `ok` is silent — the handoff is explicit that four of six tools are normally
 * showing nothing at all, and that tabs stay plain. This exists to drive the
 * health list behind the warning badge, and the one visual rule on a tab: a
 * tool that is `not-installed` renders dim and inert.
 */
export type ToolHealth = "ok" | "needs-update" | "not-tracked" | "not-installed";

/** The user-facing string for each. Never the backend's word for it. */
export const HEALTH_LABEL: Record<Exclude<ToolHealth, "ok">, string> = {
  "needs-update": "needs update",
  "not-tracked": "not tracked",
  "not-installed": "not installed",
};

/** The dot colour token for each, from the handoff's health-list crop. */
export const HEALTH_TOKEN: Record<Exclude<ToolHealth, "ok">, string> = {
  "needs-update": "var(--warn)",
  "not-tracked": "var(--warn)",
  "not-installed": "var(--err)",
};

/**
 * Everything a component is allowed to know about a tool.
 *
 * Note what is absent: version, pinned version, repo URL, checkout path. The
 * shell shows a name and a short description. Versions exist in helve.toml and
 * in the backend, and that is where they stay.
 */
export interface ToolPresentation {
  id: string;
  name: string;
  description: string;
  health: ToolHealth;
  /** `not-installed` tools render dim and cannot be selected. */
  interactive: boolean;
  /**
   * A first-party app rather than a tool checkout.
   *
   * One bit, and it earns its place by being the routing decision the tool
   * window cannot make any other way: an app's `invoke` is answered in-process
   * by `app_call`, a tool's would go to its core over the broker. Everything
   * else about the two is identical here on purpose — an app gets no special
   * tab, no badge, and no separate section in the bar, because to the person
   * using it the difference is an implementation detail of where the code
   * happens to live.
   */
  isApp: boolean;
}

/** The one door between the backend's tool type and the interface's. */
export function toolPresentation(tool: ResolvedTool): ToolPresentation {
  const health = healthOf(tool.status);
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    health,
    interactive: health !== "not-installed",
    isApp: false,
  };
}

/**
 * The same door for a first-party app.
 *
 * An app has no health to map. It ships inside the binary that is asking about
 * it, so `missing` is not a state it can be in and `mismatch` has no pinned
 * version to disagree with — `ok` is not an optimistic default here, it is the
 * only answer the type can carry.
 */
export function appPresentation(app: AppInfo): ToolPresentation {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    health: "ok",
    interactive: true,
    isApp: true,
  };
}

function healthOf(status: ToolStatus): ToolHealth {
  switch (status.state) {
    case "ready":
      return "ok";
    case "mismatch":
      return "needs-update";
    case "unversioned":
      return "not-tracked";
    case "missing":
      return "not-installed";
  }
}

// ---------------------------------------------------------------------------
// Engine status — stubbed, five strings and nothing else
// ---------------------------------------------------------------------------

export type EngineState = "idle" | "building" | "running" | "failed" | "none";

/** The five strings, verbatim from the handoff. There is no sixth. */
export const ENGINE_LABEL: Record<EngineState, string> = {
  idle: "Engine idle",
  building: "Engine building",
  running: "Engine running",
  failed: "Build failed",
  none: "No engine",
};

export const ENGINE_TOKEN: Record<EngineState, string> = {
  idle: "var(--ok)",
  building: "var(--accent)",
  running: "var(--ok)",
  failed: "var(--err)",
  none: "var(--dot-off)",
};

export interface EngineStatusSource {
  subscribe(cb: (state: EngineState) => void): () => void;
}

// ---------------------------------------------------------------------------
// Terminals — real PTYs, real emulation
// ---------------------------------------------------------------------------
//
// A session is two separate things, and they are deliberately two interfaces.
//
// `TerminalSource` is *identity and lifetime*: which sessions exist, what they
// are called, which window's panel holds one. That is shared state — a terminal
// can be dragged between windows and outlives whichever window is showing it —
// so it is Rust's, and this is a projection of `shell:state`.
//
// `TerminalTransport` is *bytes*: one PTY's output going to one emulator, and
// that emulator's keystrokes going back. It is per-session, high-volume, and
// nothing outside the terminal view has any business seeing it.
//
// Keeping them apart is what makes the interception point in Rust worth having.
// Every byte in either direction crosses one seam there, so a wrapper around a
// coding harness — tracking what it did, injecting input, restarting it — is
// written once in the transport and needs no cooperation from anything here.

export interface TerminalSession {
  id: string;
  title: string;
  /**
   * The dot on a terminal tab means *this agent finished*. It is not tool
   * health, and it never appears on a tool tab.
   */
  agentFinished: boolean;
  /**
   * Sessions sharing a group id render as one tab, laid out side by side in
   * the deck by `TerminalDeck`. `null` for an ordinary, unsplit session.
   *
   * Owned by Rust, like the rest of a session's identity — a terminal can be
   * dragged into another window, and a group held together by one window's
   * own state would come apart the moment a member of it moved.
   */
  groupId: string | null;
}

/**
 * One entry in the tab row: a solo session, or every session that shares a
 * group id, in the order they first appear in `sessions`.
 *
 * `id` is the tab's own identity — a session id for a solo tab, the shared
 * group id for a split one — and is what `SecondaryPanel`'s `activeTabId`
 * and `TerminalDeck`'s `activeId` both compare against. Computed fresh from
 * `sessions` rather than tracked separately, so there is no second place a
 * tab's membership could drift from what Rust actually reports.
 */
export interface TerminalTabGroup {
  id: string;
  sessions: TerminalSession[];
}

export function groupTerminalTabs(sessions: TerminalSession[]): TerminalTabGroup[] {
  const tabs: TerminalTabGroup[] = [];
  const byGroupId = new Map<string, TerminalTabGroup>();

  for (const session of sessions) {
    if (session.groupId) {
      let tab = byGroupId.get(session.groupId);
      if (!tab) {
        tab = { id: session.groupId, sessions: [] };
        byGroupId.set(session.groupId, tab);
        tabs.push(tab);
      }
      tab.sessions.push(session);
    } else {
      tabs.push({ id: session.id, sessions: [session] });
    }
  }

  return tabs;
}

/**
 * What a session is running, when it is running anything.
 *
 * Only ever asked for at the moment someone clicks the close button, which is
 * what keeps it cheap: there is no polling and no per-session watcher, just one
 * question answered once. `null` means the shell is sitting at a prompt with no
 * child of its own, and that close needs no confirming.
 */
export interface TerminalBusy {
  /** The child process's name, so the dialog can say what it would kill. */
  process: string;
}

/**
 * Opening and closing sessions.
 *
 * There is deliberately no `subscribe` here. Which sessions exist is part of
 * `shell:state` — it has to be, since a terminal can be dragged into another
 * window — so a second subscription would be a second answer to a question that
 * already has one, and the two could disagree.
 */
export interface TerminalControl {
  /** Resolves once the shell is actually running and the session has an id. */
  create(windowLabel: string, cols: number, rows: number): Promise<string>;
  /**
   * Open a second pty and fold it into `sourceId`'s tab — the second half of
   * "split terminal", the first half being `open_terminal` on the Rust side
   * (reused, not duplicated; see `commands::split_terminal`). Grouping is
   * decided in Rust, same as everything else about a session's identity, so
   * this only ever *asks*; the group a caller should render comes back
   * around through `shell:state`, same as `setTitle` below.
   */
  split(sourceId: string, cols: number, rows: number): Promise<string>;
  close(id: string): void;
  busy(id: string): Promise<TerminalBusy | null>;
  /**
   * A session's own program set its title via an OSC escape sequence (`ESC
   * ] 0 ; title BEL` / `ESC ] 2 ; title ST`), detected by the emulator that
   * saw it and reported up here.
   *
   * Lives on `TerminalControl`, not `TerminalTransport`: a title is identity
   * — the same thing `TerminalSession.title` already is — not a byte on the
   * session's stream, and Rust is the owner of record for identity (see the
   * comment above `TerminalSession`) because a terminal can be dragged into
   * another window's panel. This call only ever *reports*; the title a
   * caller should render still comes back around through `shell:state`.
   */
  setTitle(id: string, title: string): void;
}

/**
 * One session's byte stream, in both directions.
 *
 * `attach` returns its own unsubscribe rather than taking an id to detach,
 * because the emulator that attached is the only thing that should be able to
 * stop listening — an id-keyed `detach` lets any caller silence someone else's
 * terminal.
 */
export interface TerminalTransport {
  /**
   * Start receiving this session's output.
   *
   * `onData` is called with everything the shell has already said before it is
   * called with anything new, so an emulator that mounts late still sees the
   * whole session. That is not a convenience: a pty starts talking the instant
   * it is spawned, well before React has mounted anything, and on Windows its
   * opening line is a question the shell blocks on until an emulator answers.
   * A transport that only carried live events would leave every terminal
   * permanently blank. See `src-tauri/src/pty.rs`.
   */
  attach(id: string, onData: (chunk: string) => void): () => void;
  write(id: string, data: string): void;
  /**
   * Tell the PTY how big its viewport is, in character cells.
   *
   * Not optional and not cosmetic: a TUI asks the pty for its size and draws to
   * exactly that, so a pty that disagrees with the emulator produces a corrupt
   * frame rather than a scaled one.
   */
  resize(id: string, cols: number, rows: number): void;
}

// ---------------------------------------------------------------------------
// Source control — real git, one shot at a time
// ---------------------------------------------------------------------------
//
// These replace an earlier `Worktree`/`WorktreeSource` pair, which was a
// subscription over a single flat change list and had nowhere to put the half
// of git that matters: the index. What is here instead is request/reply, because
// there is no watcher — the panel re-asks after every mutation and when the
// shown tool changes, and that is the whole update model.

export type GitChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

/**
 * The single letter git itself would print in a status short-format, which is
 * also what the row's leading column draws. `untracked` is `?` rather than `U`
 * because `U` is already git's letter for an unmerged path.
 */
export const GIT_KIND_LETTER: Record<GitChangeKind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflicted: "U",
};

/**
 * The colour token for that letter. Modified/added/deleted keep the three the
 * worktree list has always used; the three kinds that list could not express
 * borrow from the same small palette rather than introduce new tokens —
 * renamed reads as a modification, untracked as not-yet-anything, and a
 * conflict as the error it is.
 */
export const GIT_KIND_TOKEN: Record<GitChangeKind, string> = {
  modified: "var(--warn)",
  added: "var(--ok)",
  deleted: "var(--err)",
  renamed: "var(--warn)",
  untracked: "var(--text-dim-3)",
  conflicted: "var(--err)",
};

/**
 * One path, in one of the two lists.
 *
 * A path that is staged *and* then modified again appears twice — once in
 * `staged` and once in `unstaged`, each with its own kind — because those are
 * two different diffs and the user has to be able to click either one.
 */
export interface GitFileChange {
  /** Repo-relative, forward slashes. The identity: what the commands take. */
  path: string;
  /** Basename only — the directory is a separate, dimmer column. */
  file: string;
  dir: string;
  kind: GitChangeKind;
  staged: boolean;
  renamedFrom?: string;
}

export interface GitStatus {
  branch: string;
  /**
   * Commits ahead of and behind the upstream. Both `0` when there is no
   * tracking ref at all, which is not an error — a fresh branch is a normal
   * state, and the bar simply omits the arrows.
   */
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
}

/** Two blobs, ready for `DiffView`. Never a patch: Monaco diffs whole texts. */
export interface GitDiff {
  original: string;
  modified: string;
}

export interface GitControl {
  /** `null` when the tool has no checkout or the checkout is not a repo. */
  status(toolId: string): Promise<GitStatus | null>;
  diff(toolId: string, path: string, staged: boolean): Promise<GitDiff>;
  stage(toolId: string, paths: string[]): Promise<void>;
  unstage(toolId: string, paths: string[]): Promise<void>;
  commit(toolId: string, message: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Search — stubbed index, real interaction
// ---------------------------------------------------------------------------

export type SearchType = "content" | "scripts" | "assets" | "terminal" | "settings";

export const SEARCH_TYPE_LABEL: Record<SearchType, string> = {
  content: "Content",
  scripts: "Scripts",
  assets: "Assets",
  terminal: "Terminal output",
  settings: "Tool settings",
};

export interface SearchResult {
  /** The lowercase kind shown in the leading 58px column. */
  type: string;
  label: string;
}

export interface SearchIndex {
  query(text: string, types: SearchType[]): SearchResult[];
}

// ---------------------------------------------------------------------------
// Menus — every menu opens, and an item that cannot act says so
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  /**
   * Shown at the trailing edge of the row, and **bound** — an accelerator on
   * display is a promise that the keystroke does this. Either `useKeyboard.ts`
   * binds it, or the platform already does (the Edit menu's, which the focused
   * text surface handles natively). Nothing here is decorative; see the
   * accelerator note in `titlebar/TitleBar.tsx`.
   */
  accelerator?: string;
  separatorBefore?: boolean;
  onSelect?: () => void;
  /**
   * Renders inert and unclickable — the native `disabled` attribute, not a
   * dimmed-but-live button. This is the only way an item is allowed to be
   * unable to act: an item that renders live and silently does nothing teaches
   * the user that the menu lies.
   */
  disabled?: boolean;
  /**
   * A sentence about this row, shown as its `title`.
   *
   * Almost always **why it is disabled**, which is the case it exists for: an
   * item the user cannot click owes them a reason, and "no dead items" is only
   * half an answer without one. It is also allowed on a live item whose effect
   * is not obvious from its label — File > Open Recent, which shows the Home
   * app rather than a submenu.
   *
   * Rendered on the wrapping `<li>` rather than the button, because a
   * `disabled` button receives no pointer events and so never shows a tooltip
   * of its own — which would leave the explanation reachable on exactly the
   * items that do not need one.
   */
  hint?: string;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

// ---------------------------------------------------------------------------
// Instances, panes, clusters — the layout
// ---------------------------------------------------------------------------
//
// The distinction this whole section draws: an *app id* is a type, an *instance
// id* is an identity. `files` names some code; `files-1` and `files-2` name two
// live surfaces with their own open files and their own scroll positions.
//
// All of it is owned by Rust and arrives on `shell:state`, for the reason
// `TerminalSession.groupId` below already gives about terminal groups: anything
// a tab can be dragged across windows with cannot live in one window's own
// state, because it would come apart the moment it moved. A client-side pane
// tree would be the first shell layout state outside that broadcast, and it
// would be wrong for exactly the same reason.

/** Mirrors `shell_state::SurfaceKind`. */
export type SurfaceKind = "app" | "tool" | "terminal";

/**
 * One live surface. Mirrors `shell_state::SurfaceInstance`.
 *
 * `appId` survives only as the thing that says which code to load and where to
 * route an `invoke`. Everything else — which frame a message came from, which
 * tab to close, which iframe to keep mounted — is keyed on `id`.
 */
export interface SurfaceInstance {
  id: string;
  appId: string;
  kind: SurfaceKind;
  title: string;
}

/** Mirrors `layout::SplitDir`. */
export type SplitDir = "row" | "column";

/**
 * One node of a cluster's layout. Mirrors `layout::PaneNode`.
 *
 * Discriminated on `kind` rather than on which keys are present, matching
 * `ToolStatus` and `BootStatus`.
 *
 * `sizes` are fractions of the parent, one per child, summing to 1 — not
 * pixels. The window is resizable, so a layout stored in pixels would have to
 * be recomputed on every resize and would restore wrongly onto a different
 * monitor.
 */
export type PaneNode =
  | { kind: "split"; id: string; dir: SplitDir; sizes: number[]; children: PaneNode[] }
  | { kind: "leaf"; id: string; tabs: string[]; activeTab: string | null };

/** Mirrors `shell_state::WorktreeRef`. A stub — nothing reads it yet. */
export interface WorktreeRef {
  path: string;
  branch: string | null;
}

/**
 * One tab in the switcher bar: a layout, its terminals, and its worktree.
 *
 * A cluster is one thing being worked on. Switching cluster tabs swaps the
 * whole pane tree *and* the panel beneath it, which is why the terminals belong
 * here rather than to the window — a terminal opened against the `auth`
 * worktree should still be there when you come back from `billing`.
 *
 * The set of terminals is not a field. It is derived by filtering
 * `ShellSnapshot.terminals` on `clusterId`, so there is exactly one answer to
 * where a terminal lives and no second field that could contradict it.
 */
export interface Cluster {
  id: string;
  name: string;
  tree: PaneNode;
  activeTerminal: string | null;
  worktree: WorktreeRef | null;
}

/** Every tab in a tree, in layout order. */
export function paneTabs(node: PaneNode): string[] {
  return node.kind === "leaf" ? node.tabs : node.children.flatMap(paneTabs);
}

/** Which pane holds a tab, or `null` if this tree does not have it. */
export function paneOfTab(node: PaneNode, instanceId: string): string | null {
  if (node.kind === "leaf") return node.tabs.includes(instanceId) ? node.id : null;
  for (const child of node.children) {
    const found = paneOfTab(child, instanceId);
    if (found) return found;
  }
  return null;
}

/** Every leaf in a tree, in layout order. */
export function paneLeaves(node: PaneNode): Extract<PaneNode, { kind: "leaf" }>[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(paneLeaves);
}

// ---------------------------------------------------------------------------
// Drag — every interaction, one vocabulary
// ---------------------------------------------------------------------------

/**
 * What is currently in the air.
 *
 * One kind, where there used to be two. A tab is a tab: an app surface and a
 * terminal drag identically, drop in the same places, and split a pane the same
 * way. `kind` is carried for the ghost's benefit — a terminal's ghost shows its
 * agent-finished dot — and for nothing else.
 */
export interface DragPayload {
  instanceId: string;
  title: string;
  kind: SurfaceKind;
  /** Only ever true for a terminal. Drives the dot on the ghost. */
  agentFinished?: boolean;
  /** Where it came from, so a drop that lands nowhere can be a no-op. */
  fromPaneId: string | null;
}

/**
 * Where a drag would land if it were released now.
 *
 * `pane` with an `edge` splits that pane on that side; `pane` with no edge
 * appends to its tab strip. `strip` is a drop between two tabs, with `index`
 * naming the insertion point. `panel` is the terminal panel — the one place a
 * terminal can go that is not the tree. `detach` is clear of every drop target,
 * and releasing there makes a window.
 */
export type DropTarget =
  | { kind: "pane"; paneId: string; edge: SplitDir | null; before: boolean }
  | { kind: "strip"; paneId: string; index: number }
  | { kind: "panel" }
  | { kind: "detach" };

export interface DragState {
  payload: DragPayload;
  /** Viewport coordinates of the pointer, for the ghost. */
  x: number;
  y: number;
  /** Where a release right now would put it. */
  target: DropTarget;
}

/** What a region spreads onto an element to make it a drag source. */
export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  style: { cursor: string };
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * Which window this is.
 *
 * Only the title bar's traffic-light treatment still turns on this. Both kinds
 * now have a switcher bar and a panel: a detached window holds real clusters
 * that can be added to and switched between, so there is something to switch.
 */
export type WindowKind = "main" | "detached";

/**
 * The six regions, as slots.
 *
 * `Frame` owns the geometry — the heights, the split, the fact that only the
 * middle row grows — and knows nothing about what goes in them. That is the
 * whole reason the regions can be built in parallel: they are handed a box of
 * the right size and cannot affect anyone else's.
 */
export interface FrameSlots {
  titleBar: ReactNode;
  /** Omitted in a detached window. */
  switcherBar?: ReactNode;
  toolWindow: ReactNode;
  secondaryPanel: ReactNode;
  statusBar: ReactNode;
  /** Portalled above everything: drag ghost and drop outlines. */
  overlay?: ReactNode;
}
