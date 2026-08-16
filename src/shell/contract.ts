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
import type {
  AppInfo,
  GitCommit,
  GitWorktree,
  ResolvedTool,
  ToolStatus,
  WorktreeRef,
} from "../bindings";

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
  /**
   * A terminal in this **window's panel**. Resolves once the shell is actually
   * running and the session has an id.
   *
   * The panel's own `+`, and the default. A panel terminal belongs to the
   * window rather than to any cluster, so it survives every cluster switch —
   * see `TerminalSessionState.windowLabel` for why that is the point of it.
   */
  create(windowLabel: string, cols: number, rows: number): Promise<string>;
  /**
   * A terminal in a **pane of the active cluster**, from the Apps menu or the
   * switcher's `+`.
   *
   * The second of two legitimate ways to make a terminal, and it looks like a
   * contradiction of the first until you notice they answer different
   * questions: `create` is *what am I watching*, and outlives the cluster;
   * this is *what am I working in*, and is part of an arrangement — the
   * right-hand pane of a "Files & Terminal" preset, or whatever someone drags
   * there by hand. It closes with its cluster because it is drawn inside it.
   * Both exist in VS Code for the same reason, as the panel and an editor-area
   * terminal.
   *
   * There is still only one thing in the application that spawns a shell:
   * Rust opens the session the usual way and then moves its id into the tree,
   * which is precisely what dragging a terminal's tab into a pane does. See
   * `commands::open_terminal_into_pane`.
   *
   * `paneId` names the pane this open is *relative to*; omitted, it is the
   * active cluster's first. `dir` splits that pane along the given axis and
   * gives the terminal a pane of its own — the same treatment opening an app
   * gets, because Terminal is a row in the same menu. Omitted, it arrives as a
   * tab in the named pane. See `panes/splitOnOpen.ts` for where the axis comes
   * from and `PaneNode::open_into` for when the split is declined.
   */
  createInPane(windowLabel: string, paneId?: string, dir?: SplitDir): Promise<string>;
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

export type GitChangeKind =
  "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

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
  /**
   * Line-change totals since `HEAD` (or, for a repository with no commits
   * yet, since the empty tree) — what the status bar's compact
   * `+N -N · M files` readout is built from. Mirrors `GitStatus` in `git.rs`,
   * which is where the exact rule for what counts and what doesn't is written
   * down: staged and unstaged changes to tracked files combined into one
   * diff against the base, plus every untracked file (already present below
   * in `unstaged`) counted as a pure addition of its own line count. A
   * changed binary file and an untracked file over 5 MiB both still appear in
   * `staged`/`unstaged` — so they still count as a file touched — without
   * adding to `insertions`/`deletions`, since there is no line count worth
   * reading either of them for.
   */
  insertions: number;
  deletions: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
}

/** Two blobs, ready for `DiffView`. Never a patch: Monaco diffs whole texts. */
export interface GitDiff {
  original: string;
  modified: string;
}

/**
 * The index, scoped to a cluster: what has changed, what is staged, commit it.
 *
 * Every method takes a **cluster** id. It used to be a tool id, which was not a
 * near-miss but a dead end — Rust resolved a tool id against the `helve.toml`
 * `[[tool]]` pins, a list `discovery.rs` leaves empty for every project, so
 * every call rejected and the source-control view drew an error where its
 * change list should have been. `git.rs`'s note on `git_cluster_status` has the
 * full account.
 *
 * A cluster is also the honest subject. It is the thing a user opens a project
 * into, the thing that can be moved onto a worktree, and the thing whose branch
 * the status bar names — none of which the pane that happens to hold focus has
 * any bearing on.
 */
export interface GitControl {
  /** `null` when the cluster has no project open or its project is not a repo. */
  status(clusterId: string): Promise<GitStatus | null>;
  diff(clusterId: string, path: string, staged: boolean): Promise<GitDiff>;
  stage(clusterId: string, paths: string[]): Promise<void>;
  unstage(clusterId: string, paths: string[]): Promise<void>;
  commit(clusterId: string, message: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Worktrees — one cluster, one checkout of its own
// ---------------------------------------------------------------------------
//
// A cluster can work inside a git worktree instead of the project folder
// itself, which is what lets two clusters hold two branches of one repository
// open at the same time without either one's edits showing up in the other's
// file tree. The worktree is a real second checkout on disk; git maintains it,
// and `git worktree list` — not anything HELVE writes down — is the authority
// on which ones exist.
//
// They are created *outside* the project, at `<project>/../.worktrees/
// <project-name>/<name>/`, and that placement is load-bearing rather than
// tidiness. A worktree nested inside the project would be a complete second
// copy of the codebase sitting in the tree that every file walker descends:
// the Files app, the search index, and Vite's watcher would each find one more
// copy of `src/` per cluster. Outside, nothing has to be taught to ignore it.

/**
 * Creating, listing, and discarding a cluster's worktree.
 *
 * Request/reply for the same reason `GitControl` is (see the note at the top of
 * the source-control section): there is no watcher, and every one of these
 * either follows a user action or a cluster switch, both of which are already
 * moments the panel re-asks at.
 */
export interface WorktreeControl {
  /**
   * Every worktree of the cluster's repository, main checkout included.
   *
   * Scoped to a cluster rather than a path because the frontend never names a
   * directory for the backend to run `git` in — the same rule the source
   * control commands follow. Empty when the cluster has no project, or has one
   * that is not a repository; neither is an error worth a dialog.
   */
  list(clusterId: string): Promise<GitWorktree[]>;
  /**
   * The repository's local branches as one graph, newest first.
   *
   * On `WorktreeControl` rather than `GitControl` because it is scoped to a
   * cluster and spans every worktree of its repository — the graph is the one
   * part of the panel that is deliberately *not* about the cluster's own
   * checkout, which is why the top half stays put while the bottom half changes
   * as you switch clusters.
   */
  graph(clusterId: string, limit: number): Promise<GitCommit[]>;
  /**
   * Everything this cluster's worktree has changed since it forked.
   *
   * `null` for a cluster working in its project folder rather than a worktree.
   * There is no fork point to measure from, and the panel draws its ordinary
   * source-control view for that case rather than an empty divergence.
   */
  divergence(clusterId: string): Promise<GitDivergence | null>;
  /**
   * One file's whole divergence, as two texts for the diff editor.
   *
   * Takes the `mergeBase` from the `GitDivergence` the file came from rather
   * than letting the backend resolve it again: a merge base computed twice
   * during one reading of one list could differ if something fetched in
   * between, and a diff taken against a different base than the list was built
   * from is quietly wrong rather than visibly broken.
   */
  divergenceDiff(clusterId: string, path: string, mergeBase: string): Promise<GitDiff>;
  /**
   * Cut a new branch named `name` from the current HEAD, check it out into a
   * new worktree, and point the cluster at it.
   *
   * One name for both the branch and the folder, because two names for one
   * thing is two things to keep in agreement and the user is naming a piece of
   * work, not a directory. Fails rather than overwrites when the branch or the
   * folder already exists.
   */
  create(clusterId: string, name: string): Promise<WorktreeRef>;
  /**
   * Remove the worktree and return the cluster to working in its project.
   *
   * Deletes the checkout on disk but never the branch — the commits on it are
   * the point of having made it. `force` is what a worktree with uncommitted
   * changes needs, and git's refusal without it is correct: that refusal is the
   * only thing standing between a stray click and unrecoverable work.
   */
  remove(clusterId: string, force: boolean): Promise<void>;
}

/**
 * Where a cluster's work actually is: its worktree when it has one, else its
 * project folder.
 *
 * The precedence lives here and nowhere else. Terminals spawn in this
 * directory, the Files app roots its tree at it, and the search index scopes to
 * it — three features that must agree, and would eventually stop agreeing if
 * each carried its own copy of the rule. The Rust side resolves the same
 * precedence in `project::cluster_path`.
 *
 * Deliberately *not* the answer to "which project is this cluster on" — that is
 * `Cluster.project`, and it stays the project even while the work is happening
 * in a worktree beside it. Home names the project, the file tree walks the
 * root, and conflating them would have Home renaming itself every time somebody
 * made a branch.
 *
 * Synchronous, so it cannot check that the directory still exists. A worktree
 * removed outside HELVE leaves the path pointing at nothing until the backend
 * reconciles against `git worktree list`, which it does on load and after every
 * worktree mutation. Callers that walk the result should treat a missing
 * directory as empty rather than as a failure.
 */
export function clusterRoot(cluster: Cluster): string | null {
  return cluster.worktree?.path ?? cluster.project;
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
  /**
   * Rows that open to the side, behind a caret.
   *
   * There was none of this until presets arrived, and the two menus that wanted
   * one before — File > Open Recent, and the Apps list itself — both went the
   * other way deliberately, because what they had to show was richer than a
   * column of labels. A preset is exactly a column of labels: a name, and
   * clicking it does the thing. Flattening them into the Apps menu instead would
   * put "open one more Files" and "rearrange this whole cluster" in one
   * undifferentiated list, which is the reason a submenu exists at all.
   *
   * A row with a `submenu` has no `onSelect` and does not close the menu when
   * clicked — it opens. `disabled` still applies, and disables the whole branch.
   */
  submenu?: MenuItem[];
  /**
   * A row that asks for one line of text before it acts.
   *
   * The alternative was `window.prompt`, which is a modal the shell does not
   * control, does not style, and — being synchronous — blocks the webview that
   * every iframe in the window is a child of. This is the same surface the menu
   * is already drawing, with the list swapped for a field.
   */
  prompt?: MenuPrompt;
}

/**
 * One line of text, asked for inside the menu that will act on it.
 *
 * `onSubmit` rejects with something to *show* rather than something to log: the
 * refusals it can produce — a blank name, a name one of the built-in presets
 * already holds — are answers to what was just typed, and belong under the field
 * that typed it. The menu stays open on a rejection and closes on success.
 */
export interface MenuPrompt {
  /** Above the field. A sentence, not a word: this is the only explanation. */
  label: string;
  placeholder?: string;
  /** Pre-filled and selected, so a suggested name can be taken with Enter. */
  initialValue?: string;
  confirmLabel: string;
  onSubmit: (value: string) => Promise<void>;
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

// ---------------------------------------------------------------------------
// Layout presets — an arrangement, and which app belongs in each pane
// ---------------------------------------------------------------------------
//
// Mirrors `src-tauri/src/presets/mod.rs`, and the distinction that module is
// built around survives the crossing: a `PaneNode` is made of *identities* —
// pane ids, split ids, instance ids, all minted per session — and a `PresetNode`
// is the same shape with every one of them removed. What is left is a direction,
// the weights, and in each pane the **app ids** that belong there, because a
// type is the only thing about an arrangement that outlives the session it was
// arranged in.
//
// Nothing in the shell draws a preset's shape today; the menu draws its name.
// The tree is typed here anyway because it crosses the wire.

/** Mirrors `presets::PresetSlot`. A terminal is not an app id — see below. */
export type PresetSlot = { kind: "app"; appId: string } | { kind: "terminal" };

/** Mirrors `presets::PresetNode`. Discriminated on `kind`, like `PaneNode`. */
export type PresetNode =
  | { kind: "split"; dir: SplitDir; sizes: number[]; children: PresetNode[] }
  | { kind: "pane"; slots: PresetSlot[] };

/** Mirrors `presets::LayoutPreset`. */
export interface LayoutPreset {
  /** Stable across renames — what the menu sends back when a row is clicked. */
  id: string;
  name: string;
  /**
   * Compiled into the build rather than read from `presets.json`.
   *
   * Computed by Rust and never trusted from the file, so this is a fact about
   * where the preset came from and not a claim the file made. The menu uses it
   * to separate the two groups; a built-in cannot be replaced or deleted.
   */
  builtin: boolean;
  root: PresetNode;
}

/**
 * What a cluster's worktree has changed since it forked. Mirrors
 * `git::GitDivergence`.
 *
 * Committed and uncommitted work in one list, deliberately. The comparison is
 * against the fork point rather than against HEAD, so committing a file does
 * not make it leave this list and does not change the diff shown for it — the
 * question the bottom half of the panel answers is "what has this cluster
 * done", and that must not depend on how often the user happened to commit.
 *
 * Declared here rather than in `bindings.ts` — unlike the other Rust mirrors —
 * because it holds `GitFileChange`, which lives here. `bindings` cannot import
 * from `contract`, so a mirror that references a contract type has to be on
 * this side of the edge, and `state/git.ts` calls `invoke` for it directly the
 * way it already does for `git_status`.
 */
export interface GitDivergence {
  /** The branch this worktree was cut from. */
  base: string;
  /**
   * The fork point. Every diff in this view is taken against it, so it is safe
   * to cache on: a merge base that has not moved means none of these diffs can
   * have changed except through the working tree.
   */
  mergeBase: string;
  /** Commits made since the fork. Zero is ordinary — work not yet committed. */
  commits: number;
  /** `staged` is meaningless here and always false; this view is not the index. */
  files: GitFileChange[];
}

/**
 * One changed region of a file against HEAD, in lines. Mirrors `git::GitHunk`.
 *
 * What the editor's gutter draws one mark per. Against HEAD rather than the
 * index, matching VS Code: staging a change does not clear the bar, because the
 * line really is still different from the last committed version and a mark
 * that vanished on `git add` would say the file matches HEAD when it does not.
 *
 * A deletion covers no current lines — `lines` is `0` — and is drawn as a wedge
 * between two lines rather than as a bar beside one.
 */
export interface GitHunk {
  kind: "added" | "modified" | "deleted";
  /** 1-based, in the file as it is now. Already clamped to a minimum of 1. */
  start: number;
  /** How many current lines the region covers. `0` for a deletion. */
  lines: number;
  originalStart: number;
  originalLines: number;
}

/**
 * Where a cluster's work is happening on disk, and what git reports about the
 * checkouts it could be happening in.
 *
 * Both mirror Rust and are therefore declared in `bindings.ts`, re-exported
 * here because this is the file the shell reads its types from. See
 * [`clusterRoot`] for the rule that decides which of a cluster's two possible
 * roots wins.
 */
export type { GitCommit, GitWorktree, WorktreeRef } from "../bindings";

/**
 * One tab in the switcher bar: a layout, the project it is about, and its
 * worktree.
 *
 * A cluster is one thing being worked on. Switching cluster tabs swaps the pane
 * tree *and the project underneath it* — and only those. The panel beside it
 * does not change, because the terminals in it are the *window's*: a shell
 * watching one worktree is exactly the thing you want still in front of you
 * while you move between the clusters working on others. See
 * `TerminalSessionState.windowLabel`.
 *
 * A terminal that has been dragged into the layout is a different matter. It is
 * a tab in `tree` like any other surface, drawn in the pane area, and the panel
 * stops listing it — membership of one excludes the other, and both are derived
 * from the tree rather than tracked.
 */
export interface Cluster {
  id: string;
  name: string;
  tree: PaneNode;
  /**
   * The folder this cluster's work is in, as an absolute path, or `null` for a
   * cluster nobody has pointed at one yet.
   *
   * The project is the cluster's and not the process's, which is what lets two
   * windows on two monitors show two projects at once. Every app surface in
   * this cluster resolves against it — Files roots its tree here, Home names it
   * as the open project — and Rust does that resolution, from the instance id
   * the shell passes with each `invoke`. Nothing in the frontend has to carry
   * a project down to a surface.
   *
   * A *path*, not a name. The name the title bar draws comes from
   * `clusterProject`, because a project's name is its manifest's when it has
   * one and only the backend has read that.
   */
  project: string | null;
  worktree: WorktreeRef | null;
}

/**
 * One entry in the shell's single tab bar.
 *
 * The bar is one row: a chip per cluster, and — for the cluster that is
 * expanded — every surface and terminal inside it, inline. So a member is
 * whichever of those two things a tab happens to be, flattened to the one shape
 * the bar draws. `paneId` is the whole distinction: a surface lives in a pane of
 * the layout, a terminal lives in the panel, and `null` is what says which.
 *
 * Built fresh from `shell:state` on every render rather than tracked. There is
 * no membership stored anywhere — a cluster's surfaces are its tree's tabs and
 * its terminals are the sessions carrying its id, both already single sources of
 * truth, and a cached list beside them would be a second answer that could
 * disagree.
 */
export interface ClusterMember {
  /** The tab's own identity: an instance id, or a terminal tab's group id. */
  id: string;
  /**
   * What the drag layer moves when this tab is dragged.
   *
   * The same as `id` except for a split terminal, whose tab is identified by the
   * group and whose *sessions* are what can actually be moved. Carried
   * explicitly so no caller has to know that a group id is not a session id.
   */
  dragId: string;
  title: string;
  kind: SurfaceKind;
  /** The pane holding it, or `null` when it lives in the terminal panel. */
  paneId: string | null;
  /** On screen right now — its pane's active tab, or the panel's. */
  showing: boolean;
  /** Only ever true for a terminal. Drives the dot, exactly as in the panel. */
  agentFinished: boolean;
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
 * Two things can be dragged, and `what` is which. They are not variations on
 * one shape: a surface is a tab and goes *into* the layout, while a cluster is
 * the layout — it can only ever be dropped on a window, never in a pane, so it
 * has no pane, no index and no edge to speak of. A union rather than a wide
 * object with half its fields unused is what makes `commit` say that out loud
 * instead of leaving a cluster to fall through the tab branches and land
 * somewhere it cannot go.
 */
export type DragPayload = SurfaceDrag | ClusterDrag;

/**
 * A tab in the air.
 *
 * One kind, where there used to be two. A tab is a tab: an app surface and a
 * terminal drag identically, drop in the same places, and split a pane the same
 * way. `kind` is carried for the ghost's benefit — a terminal's ghost shows its
 * agent-finished dot — and for nothing else.
 */
export interface SurfaceDrag {
  what: "surface";
  instanceId: string;
  title: string;
  kind: SurfaceKind;
  /** Only ever true for a terminal. Drives the dot on the ghost. */
  agentFinished?: boolean;
  /** Where it came from, so a drop that lands nowhere can be a no-op. */
  fromPaneId: string | null;
}

/**
 * A whole cluster in the air — its chip, and with it its entire pane tree.
 *
 * The gesture exists for a second monitor: one cluster over there, another over
 * here. Nothing of the cluster's contents is carried, because nothing needs to
 * be — the id is the address, and the tree travels with it in the backend.
 */
export interface ClusterDrag {
  what: "cluster";
  clusterId: string;
  name: string;
}

/**
 * Where a drag would land if it were released now.
 *
 * `pane` with an `edge` splits that pane on that side; `pane` with no edge
 * appends to its tab strip. `strip` is a drop between two tabs, with `index`
 * naming the insertion point. `panel` is the terminal panel — the one place a
 * terminal can go that is not the tree. `detach` is clear of every drop target,
 * and releasing there makes a window.
 *
 * `none` is the pointer being somewhere this *particular* payload cannot go —
 * a cluster over a pane, which holds panes and cannot be put inside one. It is
 * never what a hit test returns; `useDrag` substitutes it, so that a region does
 * not draw an insertion caret or light an edge for a release that will be
 * refused. Releasing on it does nothing at all, exactly like cancelling.
 */
export type DropTarget =
  | { kind: "pane"; paneId: string; edge: SplitDir | null; before: boolean }
  | { kind: "strip"; paneId: string; index: number }
  | { kind: "panel" }
  | { kind: "detach" }
  | { kind: "none" };

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
  /**
   * Covers the split row — the tool window, the handle and the panel — while
   * search is open, leaving the switcher bar above and the status bar below
   * untouched.
   *
   * Its own band rather than part of `overlay` because the two sit at
   * different heights and answer to different things: `overlay` is portalled
   * over the entire frame for a drag ghost that has to be able to cross every
   * bar, whereas this deliberately stops at the two edges it does, so the
   * field being typed into stays visible and the status bar keeps reporting.
   */
  splitOverlay?: ReactNode;
}
