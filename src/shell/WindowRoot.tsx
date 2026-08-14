import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import type { StackSnapshot } from "../bindings";
import Frame from "./frame/Frame";
import {
  appPresentation,
  paneLeaves,
  paneTabs,
  toolPresentation,
  type EngineState,
  type PaneNode,
  type TerminalBusy,
  type TerminalSession,
  type TerminalTabGroup,
  type WindowKind,
} from "./contract";
import { snap } from "./motion";
import TitleBar, { APP_COMMAND, defaultMenus, type CommandHandlers } from "./titlebar/TitleBar";
import { editHandlers, useEditTarget } from "./titlebar/useEditTarget";
import ClusterBar from "./switcher/ClusterBar";
import ToolWindow, { type ToolWindowHandle } from "./toolwindow/ToolWindow";
import SecondaryPanel from "./panel/SecondaryPanel";
import StatusBar from "./statusbar/StatusBar";
import SearchSlot from "./search/SearchSlot";
import { useDrag } from "./drag/useDrag";
import { useKeyboard } from "./keys/useKeyboard";
import SourceControlView from "./worktree/SourceControlView";
import { useGitStatus } from "./worktree/useGitStatus";
import TerminalDeck, { type TerminalDeckHandle } from "./terminal/TerminalDeck";
import { idleEngineStatus } from "./stubs/engineStatus";
import { callApp, useApps } from "./state/apps";
import {
  activateInstance,
  addCluster,
  closeCluster,
  closeInstance,
  closeWindow as closeThisWindow,
  newWindow,
  openInstance,
  renameCluster,
  setActiveCluster,
  setActiveTerminal,
  setPaneSizes,
  useShellState,
  windowLabel,
} from "./state/shellState";
import { terminalControl, terminalTransport } from "./state/terminals";
import { gitControl } from "./state/git";
import { isFullscreen, isTauri, nextZoom, setFullscreen, setZoom } from "./hostWindow";

/**
 * What a window draws before the first `shell:state` arrives.
 *
 * A tree rather than `null`, so every consumer can assume there is always a
 * pane. `PaneTree` and `ToolWindow` would both otherwise need a "no layout yet"
 * branch that exists for one frame and is impossible to see.
 */
const EMPTY_TREE: PaneNode = { kind: "leaf", id: "pane-pending", tabs: [], activeTab: null };

/**
 * One HELVE window.
 *
 * Both the main window and every detached one mount this. They differ in
 * exactly one visible way — a detached window holds a single tool, so it has no
 * switcher bar — and that difference is a slot being omitted, not a second
 * component. Everything else is identical, which is what makes a detached
 * window feel like the same application rather than a stripped-down popup.
 *
 * `MotionConfig` sits here rather than at the app root so a detached window
 * gets the same scale without anything having to pass it across the window
 * boundary. `reducedMotion="user"` is honoured by every `motion` component
 * beneath it, so the seven moments collapse to state changes for anyone who
 * has asked the OS for that — no per-component opt-in, and no way to forget.
 */
export default function WindowRoot({
  snapshot,
  error,
  rescanning,
  onRescan,
}: {
  snapshot: StackSnapshot | null;
  /** Set when the last scan failed. Surfaces in the health list, not a banner. */
  error: string | null;
  rescanning: boolean;
  /** "Re-scan tools", from the health popover, the empty state, and ⌘R. */
  onRescan: () => void;
}) {
  const label = useMemo(() => windowLabel(), []);
  const kind: WindowKind = label === "main" ? "main" : "detached";

  // View-local, and deliberately never shared with the other windows: two
  // windows are allowed to have differently-sized panels, and routing this
  // through the backend would make one of them wrong. panelMaximized carries
  // the same reasoning — whether this window's terminal has taken over the
  // split row is a fact about this window's screen, not about the project.
  const [panelWidth, setPanelWidth] = useState(380);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelMaximized, setPanelMaximized] = useState(false);

  // Lifted out of the search slot because two regions need it: the field
  // expands, and the bar around it has to yield the width for that to be
  // possible. Neither owns the other, so the flag sits above both.
  const [searchExpanded, setSearchExpanded] = useState(false);

  const apps = useApps();

  // The authoring tools, resolved but **not openable**.
  //
  // None of them can mount in this build: a tool's core is a child process and
  // the broker that would reach it is not written, so a tool surface could only
  // ever open on a state explaining why there is nothing there. They are held
  // back until that changes rather than offered as six dead entries.
  //
  // Still computed, because they are still *reported*: this is what the cluster
  // bar's warning badge and its health list read, and it is the only place in
  // the shell that says Turner needs an update or Wright is not installed. Not
  // offering a tool and not knowing about it are different things, and only the
  // first is intended here.
  const stackTools = useMemo(
    () => (snapshot?.tools ?? []).filter((t) => t.kind === "dev-tool").map(toolPresentation),
    [snapshot],
  );

  // How to present the app an instance is an instance of. A lookup by *app* id,
  // because that is what decides which code to load and what to call it — there
  // is one presentation of Files however many Files are open.
  const presentations = useMemo(
    () => new Map(apps.map((a) => [a.id, appPresentation(a)])),
    [apps],
  );
  const presentationOf = useCallback((appId: string) => presentations.get(appId), [presentations]);

  const shell = useShellState();
  const placement = shell?.windows.find((w) => w.label === label) ?? null;

  // There is no seeding effect any more, and its absence is the point.
  //
  // What used to be here docked every app into the bar on first run, because
  // `ShellState::default` deliberately held no opinion about what should be
  // open. That opinion now lives in one place, in Rust, at the only moment it
  // can be formed correctly: `lib.rs`'s `seed_first_run` opens Home and nothing
  // else, and only when there is no saved layout to restore instead. A frontend
  // effect doing it as well would fight the restore — it would re-open surfaces
  // into a session that had deliberately closed them, every launch.

  const clusters = placement?.clusters ?? [];
  const activeCluster =
    clusters.find((c) => c.id === placement?.activeClusterId) ?? clusters[0] ?? null;
  const activeClusterId = activeCluster?.id ?? null;

  // Resolvable by id, for the tab strips. Every surface in every cluster, not
  // just the active one — a drag can name a tab in a cluster that is not on
  // screen, and a `Map` missing it would draw its raw id.
  const instances = useMemo(
    () => new Map((shell?.instances ?? []).map((i) => [i.id, i])),
    [shell?.instances],
  );

  // The tree this window draws. An empty leaf covers the moment before the
  // first `shell:state` lands — there is always a pane, so there is always
  // somewhere for a surface to go.
  const tree: PaneNode = activeCluster?.tree ?? EMPTY_TREE;

  // Which pane a new surface lands in and which pane's tabs the menus act on.
  // Local, because "which pane you were last looking at" is a fact about this
  // screen; kept valid by the effect below rather than by every place a pane can
  // appear or vanish.
  const [activePaneId, setActivePane] = useState<string | null>(null);
  const paneIds = useMemo(() => paneLeaves(tree).map((l) => l.id), [tree]);
  useEffect(() => {
    if (activePaneId === null || !paneIds.includes(activePaneId)) {
      setActivePane(paneIds[0] ?? null);
    }
  }, [paneIds, activePaneId]);

  // The surface the menus act on: the active tab of the focused pane. Not "the
  // active tab" — with several panes on screen there is no such thing, and
  // Save has to mean the editor you were typing in rather than whichever pane
  // happens to be first in the tree.
  const activeInstanceId = useMemo(() => {
    const focused = paneLeaves(tree).find((l) => l.id === activePaneId);
    return focused?.activeTab ?? paneLeaves(tree)[0]?.activeTab ?? null;
  }, [tree, activePaneId]);

  const activeInstance = activeInstanceId ? instances.get(activeInstanceId) : undefined;

  const onSelectTab = useCallback((instanceId: string) => {
    void activateInstance(instanceId);
  }, []);

  const onCloseInstanceTab = useCallback((instanceId: string) => {
    void closeInstance(instanceId);
  }, []);

  const onOpenApp = useCallback(
    (appId: string) => {
      void openInstance(label, appId, activePaneId ?? undefined);
    },
    [label, activePaneId],
  );

  const onResizePane = useCallback((splitId: string, sizes: number[]) => {
    void setPaneSizes(splitId, sizes);
  }, []);

  // --- clusters -------------------------------------------------------------

  const onSelectCluster = useCallback(
    (clusterId: string) => {
      void setActiveCluster(label, clusterId);
    },
    [label],
  );

  const onAddCluster = useCallback(() => {
    // Numbered rather than prompting. A dialog before you can see the thing you
    // are naming is the wrong order; the tab is renameable in place the moment
    // it exists.
    void addCluster(label, `Cluster ${clusters.length + 1}`);
  }, [label, clusters.length]);

  const onCloseCluster = useCallback((clusterId: string) => {
    void closeCluster(clusterId);
  }, []);

  const onRenameCluster = useCallback((clusterId: string, name: string) => {
    void renameCluster(clusterId, name);
  }, []);

  /**
   * Close this window, through the backend rather than through Tauri directly.
   *
   * `hostWindow.closeWindow` calls `getCurrentWindow().close()`, which is how
   * this used to work and is now wrong. `WindowEvent::Destroyed` cannot tell a
   * deliberate close from the application shutting down, and at shutdown it
   * fires for every window — so the backend needs the close *announced* before
   * it happens. Without that, `reclaim` would fold every window into `main` on
   * the way out and the layout written to disk would be that collapsed one. You
   * would quit with three windows and reopen with one. See
   * `ShellState::closing`.
   */
  const onCloseWindow = useCallback(() => {
    void closeThisWindow(label);
  }, [label]);

  /**
   * File > New Window: an empty window with a cluster of its own.
   *
   * Built by detaching nothing — `newWindow` on the backend creates the window
   * and seeds it, rather than this reusing `detachInstance` and taking a tab out
   * of the window you are looking at. That distinction is why the item was
   * disabled before: the only window-making path used to be "drag a tab out",
   * and wiring New Window to it would have opened a window by emptying this one.
   */
  const onNewWindow = useCallback(() => {
    void newWindow();
  }, []);

  // --- terminals ------------------------------------------------------------
  //
  // Sessions come from `shell:state` and nowhere else. They have to: a terminal
  // can be dragged into another window, so the list of what this panel holds is
  // a filter over shared state rather than anything this window owns. Each one
  // has a real pty behind it (src-tauri/src/pty.rs) — the panel is not showing
  // a fixture any more.
  // Filtered by *cluster*, not by window. The panel belongs to the cluster, so
  // switching from `auth` to `billing` swaps the terminals under it — which is
  // the whole reason a cluster is a useful unit: the shells you had running
  // against one worktree are still there when you come back to it.
  //
  // A terminal that has been dragged into the layout is excluded. It is drawn as
  // a tab by the pane that now holds it, and drawing it in both places is the
  // one way the single-home rule can visibly break.
  const sessions = useMemo(() => {
    const inTree = new Set(paneTabs(tree));
    return (shell?.terminals ?? [])
      .filter((t) => t.clusterId === activeClusterId && !inTree.has(t.id))
      .map(({ id, title, agentFinished, groupId }) => ({ id, title, agentFinished, groupId }));
  }, [shell?.terminals, activeClusterId, tree]);

  // `activePanelTab` is stored as whatever id was last clicked or created —
  // a plain session id most of the time. A tab's own identity can move out
  // from under that value without a click, though: splitting mints a group
  // id for a session that didn't have one, and closing a pane can collapse
  // a group back down to a plain session (see `onCloseTab` below). So this
  // re-derives "which tab is that id part of *right now*" on every render
  // instead of trusting the stored value verbatim — a session found by
  // either its own id or its group id resolves to its *current* tab id
  // (`groupId ?? id`), which is what `SecondaryPanel` and `TerminalDeck`
  // both key their own tab/pane matching on.
  const [activePanelTab, setActivePanelTab] = useState<string>("");
  const panelTabId = (() => {
    if (activePanelTab === "worktree") return "worktree";
    const owner = sessions.find((s) => s.id === activePanelTab || s.groupId === activePanelTab);
    if (owner) return owner.groupId ?? owner.id;
    return sessions[0] ? (sessions[0].groupId ?? sessions[0].id) : "";
  })();

  // The pane split/clear/kill act on: "the terminal you have open" within
  // whichever tab is active. Defaults to the tab's first session and follows
  // clicks/focus inside `TerminalDeck` from there (see `onFocusPane` below).
  // Kept valid by the effect beneath it rather than by every place the tab
  // or the session list can change — a tab switch, a split, or a close all
  // funnel through the same one check instead of three separate ones that
  // could disagree.
  const [focusedPaneId, setFocusedPaneId] = useState<string>("");
  const activeTabSessions = useMemo(
    () => sessions.filter((s) => s.id === panelTabId || s.groupId === panelTabId),
    [sessions, panelTabId],
  );
  useEffect(() => {
    if (!activeTabSessions.some((s) => s.id === focusedPaneId)) {
      setFocusedPaneId(activeTabSessions[0]?.id ?? "");
    }
  }, [activeTabSessions, focusedPaneId]);

  // The deck mounts every xterm instance; clearing one reaches into a
  // specific mounted instance from outside the deck's own tree, which is
  // what the imperative handle is for — see `TerminalDeck`'s doc comment.
  const deckRef = useRef<TerminalDeckHandle>(null);

  /**
   * Which panel tab is showing — locally *and* in the cluster that owns it.
   *
   * Both, because the two answer different questions. The local value paints on
   * the same frame as the click; the cluster's is what survives switching away
   * and back, and what a restart restores. Reporting only locally would mean a
   * cluster always reopened on its first terminal rather than the one you were
   * using; reporting only to Rust would make every click wait a round trip.
   *
   * `"worktree"` is a panel tab but not a terminal, so it is deliberately not
   * sent on — the cluster's `activeTerminal` names a session or nothing.
   */
  const onSelectPanelTab = useCallback(
    (id: string) => {
      setActivePanelTab(id);
      if (activeClusterId && id !== "worktree") void setActiveTerminal(activeClusterId, id);
    },
    [activeClusterId],
  );

  // What the cluster says was last showing, so switching clusters comes back to
  // the terminal you were using rather than to whichever is first.
  useEffect(() => {
    if (activeCluster?.activeTerminal) setActivePanelTab(activeCluster.activeTerminal);
  }, [activeCluster?.id, activeCluster?.activeTerminal]);

  const onNewTerminal = useCallback(async () => {
    // 80×24 is a placeholder the emulator overwrites the moment it has measured
    // itself. A pty has to be created with *some* size, and a shell that prints
    // a banner before the first resize would otherwise wrap against nothing.
    const id = await terminalControl.create(label, 80, 24);
    setActivePanelTab(id);
  }, [label]);

  // Open a second pty beside the focused pane, under the same tab — Rust
  // decides the group (reusing one if the focused session is already split,
  // minting one otherwise; see `commands::split_terminal`), this just asks
  // and then moves focus onto the pane that just opened.
  const onSplit = useCallback(async () => {
    if (!focusedPaneId) return;
    const id = await terminalControl.split(focusedPaneId, 80, 24);
    setFocusedPaneId(id);
  }, [focusedPaneId]);

  // Clears the focused pane's emulator only — never the pty. A full-screen
  // TUI draws from its own terminal state, not from anything a shell command
  // could print, so writing `cls`/`clear` into the stream would do nothing
  // useful to it (or land as literal keystrokes in whatever prompt it's
  // showing). `TerminalDeck.clear` calls xterm's own `clear()` on exactly
  // this pane's instance.
  const onClear = useCallback(() => {
    if (focusedPaneId) deckRef.current?.clear(focusedPaneId);
  }, [focusedPaneId]);

  // Closing the tab you were looking at has to leave you somewhere. Rust drops
  // the session from the broadcast, so `panelTabId` above would fall to the
  // first remaining terminal on its own — but only after a round trip, which
  // reads as a flicker. Choosing the neighbour here means the switch happens on
  // the same frame as the click, and the broadcast then agrees with it.
  //
  // Splitting means a tab can lose a pane without losing the tab, so this
  // isn't just "closed the active tab, move on" any more:
  //   - the tab survives with 2+ panes left: its group id is unaffected,
  //     `panelTabId`'s own re-derivation above keeps pointing at it, nothing
  //     to predict here.
  //   - the tab survives with exactly 1 pane left: `close_terminal_pure` on
  //     the Rust side ungroups a lone survivor (a group of one is not a
  //     group), so the tab's id moves from the shared group id to that
  //     session's own id. Predicted here for the same reason the neighbour
  //     jump always was — so the switch lands on the same frame as the
  //     click rather than a tick after `shell:state` catches up.
  //   - the tab itself is gone (its last/only pane closed): jump to the
  //     neighbouring *tab*, walking distinct tab ids rather than raw
  //     session ids, since a split's second pane is not "the tab" a
  //     neighbour search should land on.
  const onCloseTab = useCallback(
    (id: string) => {
      const closed = sessions.find((s) => s.id === id);
      const closedTabId = closed ? (closed.groupId ?? closed.id) : null;
      if (closedTabId !== null && closedTabId === panelTabId) {
        const remaining = sessions.filter((s) => s.id !== id && (s.groupId ?? s.id) === panelTabId);
        if (remaining.length === 0) {
          const tabIds = [...new Set(sessions.map((s) => s.groupId ?? s.id))];
          const i = tabIds.indexOf(panelTabId);
          setActivePanelTab(tabIds[i + 1] ?? tabIds[i - 1] ?? "worktree");
        } else if (remaining.length === 1) {
          setActivePanelTab(remaining[0].id);
        }
      }
      terminalControl.close(id);
    },
    [panelTabId, sessions],
  );

  // The one confirmation flow for closing a session with something running
  // in it — asked once, at the moment of the request, never polled. Lives
  // here rather than inside the panel because the Terminal menu's Kill item
  // has to be able to raise the exact same dialog a tab's own × does, and a
  // dialog whose state lived only in `SecondaryPanel` could never be reached
  // from the title bar. `SecondaryPanel` still renders `CloseConfirm` — the
  // dialog is visually scoped to the panel — it just no longer decides when
  // to show it.
  const [pendingClose, setPendingClose] = useState<{ id: string; title: string; busy: TerminalBusy } | null>(null);
  const requestClose = useCallback(
    async (session: TerminalSession) => {
      const busy = await terminalControl.busy(session.id);
      if (busy) {
        setPendingClose({ id: session.id, title: session.title, busy });
      } else {
        onCloseTab(session.id);
      }
    },
    [onCloseTab],
  );

  // The one place "which pane does closing this tab actually mean" gets
  // decided — the tab's own × and the Terminal menu's Kill item both route
  // through this rather than each carrying its own rule. The answer is the
  // focused pane when `tab` is the tab currently on screen (Kill's only
  // possible target, since it only ever acts on the active tab) and the
  // tab's first session otherwise (the × on a tab that isn't active has no
  // focused pane to speak of — nothing in it is on screen to have been
  // clicked).
  const requestCloseTab = useCallback(
    (tab: TerminalTabGroup) => {
      const target =
        tab.id === panelTabId ? (tab.sessions.find((s) => s.id === focusedPaneId) ?? tab.sessions[0]) : tab.sessions[0];
      void requestClose(target);
    },
    [panelTabId, focusedPaneId, requestClose],
  );

  // The Terminal menu's Kill item acts on the focused pane, same as Split
  // and Clear — "the terminal you have open" is a property of the pane, not
  // of the tab it happens to sit in. Built as the active tab's own group so
  // it goes through `requestCloseTab` exactly like the × does, rather than
  // duplicating that resolution here.
  const onKillTerminal = useCallback(() => {
    if (activeTabSessions.length === 0) return;
    requestCloseTab({ id: panelTabId, sessions: activeTabSessions });
  }, [activeTabSessions, panelTabId, requestCloseTab]);

  // --- the menu bar ---------------------------------------------------------
  //
  // File, Edit and View operate the window and the app showing in it. Three
  // facts make that possible without the shell knowing anything about Files:
  //
  //   1. `toolRef` posts a menu command into the active frame (transport B, a
  //      `command` message — see `ToolWindow`'s header).
  //   2. `appCommands` is what each frame has said it can do *right now*, which
  //      is the only thing that decides whether an item is clickable.
  //   3. `editTarget` is where focus was before the menu opened, which decides
  //      whether Edit means the app at all.
  //
  // None of the three names an app, a method, or a file type.
  // Keyed by *instance*, not by app. Two Files can differ in what they can do
  // right now — one with a dirty editor can Save and one without cannot — so a
  // single entry per app would grey out the wrong menu about half the time.
  const toolRef = useRef<ToolWindowHandle>(null);
  const [appCommands, setAppCommands] = useState<Record<string, readonly string[]>>({});
  const onCommandsChange = useCallback((instanceId: string, commands: readonly string[]) => {
    setAppCommands((prev) =>
      sameSet(prev[instanceId], commands) ? prev : { ...prev, [instanceId]: commands },
    );
  }, []);

  const activeInstanceName = activeInstance?.title ?? "";

  /** File items that act on the surface in the focused pane. */
  const app: CommandHandlers = {
    run: (command) => {
      if (activeInstanceId) toolRef.current?.send(activeInstanceId, command);
    },
    blocked: (command) => {
      if (!activeInstanceId) return "No app is open in this pane.";
      if (appCommands[activeInstanceId]?.includes(command)) return undefined;
      // Generic on purpose. Why Save is unavailable is the *app's* knowledge —
      // nothing is dirty, no file is open — and a shell that guessed at it
      // would be inventing a reason it has no way to check.
      return `${activeInstanceName} cannot do this right now.`;
    },
  };

  const editTarget = useEditTarget();
  const edit = editHandlers(editTarget, app);

  /** Run a menu command only if the same check that greys the item out allows it. */
  const runIfAllowed = useCallback((handlers: CommandHandlers, command: string) => {
    if (handlers.blocked(command) === undefined) handlers.run(command);
  }, []);

  // A window's zoom, and whether it is full screen. Both are properties of the
  // OS window rather than of anything in React, so they are read back once on
  // mount rather than assumed — a window restored full screen would otherwise
  // have a menu item offering to enter a state it is already in.
  const [fullscreen, setFullscreenState] = useState(false);
  useEffect(() => {
    void isFullscreen()
      .then(setFullscreenState)
      .catch(() => {
        /* No window to ask. The menu item still toggles; it just starts by
           claiming the window is not full screen, which under `?fake=1` it
           is not. */
      });
  }, []);

  const onToggleFullscreen = useCallback(() => {
    setFullscreenState((was) => {
      const next = !was;
      // Optimistic, and rolled back if the window refuses — same shape as
      // `activeToolId` above, and for the same reason: a menu item that
      // repainted a round trip later would read as a click that missed.
      void setFullscreen(next).catch(() => setFullscreenState(was));
      return next;
    });
  }, []);

  const [zoom, setZoomState] = useState(1);
  const onZoom = useCallback((direction: 1 | -1) => {
    setZoomState((current) => {
      const next = nextZoom(current, direction);
      if (next === current) return current;
      void setZoom(next).catch(() => setZoomState(current));
      return next;
    });
  }, []);

  // "The terminal is showing" is the panel being open *and* on a terminal tab —
  // the worktree lives in the same panel, so an open panel is not evidence of a
  // terminal. `panelTabId` is empty when there are no sessions at all.
  const terminalShowing = !panelCollapsed && panelTabId !== "worktree" && panelTabId !== "";

  const onToggleTerminal = useCallback(() => {
    if (terminalShowing) {
      setPanelCollapsed(true);
      return;
    }
    setPanelCollapsed(false);
    // Open, but on the worktree tab or with nothing in it. "Show Terminal" has
    // to end with a terminal on screen, so this finishes the job rather than
    // revealing a panel that is showing something else.
    if (sessions.length === 0) {
      void onNewTerminal();
      return;
    }
    if (panelTabId === "worktree" || panelTabId === "") {
      setActivePanelTab(sessions[0].groupId ?? sessions[0].id);
    }
  }, [terminalShowing, sessions, panelTabId, onNewTerminal]);

  // Home is where a project is opened, so File > Open… is Home's
  // `home/open-project` — the same native folder picker its own button raises,
  // rather than a second path to the same dialog. Called through `callApp`, so
  // `?fake=1` refuses it the way it refuses every other picker instead of
  // pretending a folder was chosen.
  const onOpenProject = useCallback(() => {
    void callApp("home", "home/open-project").catch((err: unknown) =>
      console.error("helve: File > Open… failed:", err),
    );
  }, []);

  // `MenuItem` has no submenu and faking one is out, so Open Recent shows the
  // surface that has the real list. Naming "home" here is the shell knowing
  // which app owns projects, which it already has to — it is the app the
  // window opens on.
  //
  // It no longer has to check whether Home is docked, because it no longer has
  // to find one: `onOpenApp` opens a Home instance if the cluster has none, and
  // brings the existing one forward if it does. An item that used to be disabled
  // whenever Home happened to be somewhere else is now always live.
  const onOpenRecent = useCallback(() => {
    const existing = paneTabs(tree).find((id) => instances.get(id)?.appId === "home");
    if (existing) void activateInstance(existing);
    else onOpenApp("home");
  }, [tree, instances, onOpenApp]);

  const [engine, setEngine] = useState<EngineState>("idle");
  useEffect(() => idleEngineStatus.subscribe(setEngine), []);

  // The status bar and the source-control tab read one status. Two fetches
  // would be two chances to disagree about which branch is checked out, and the
  // whole point of the branch appearing in the status bar is that it is the
  // answer, not a second opinion. It also has to outlive the tab: the panel
  // keeps `worktreeView` mounted but hidden, and a status owned by the view
  // would still be re-fetched on every remount of it.
  // Keyed on the active surface's *app* id, which is what `gitControl` resolves
  // a checkout from. Following the cluster's own worktree is the right answer
  // and is where this goes next — `Cluster.worktree` is already carried for it —
  // but that field is a stub in this work, and pointing a live git view at an
  // unpopulated one would report "no repository" for every cluster.
  const git = useGitStatus(gitControl, activeInstance?.appId ?? null);

  // The drag layer is the only thing in the shell that spans regions, so it is
  // the only thing that has to be handed down rather than owned locally. The
  // regions never import it — they take a handle factory and stay ignorant of
  // what a drag is.
  //
  // It needs this window's label and active cluster because a drop names a
  // destination: a tab released over another window has to be moved *there*, and
  // a pane belongs to a cluster.
  const drag = useDrag(label, activeClusterId);

  useKeyboard({
    // ⌘1…⌘9 now select a *cluster* rather than a tool. There is no longer one
    // list of surfaces to index into — a window holds several panes, each with
    // its own tabs — and the thing a number key can still name unambiguously is
    // which cluster you are looking at.
    selectToolByIndex: (index) => {
      const cluster = clusters[index];
      if (cluster) onSelectCluster(cluster.id);
    },
    rescan: onRescan,
    // ⌘. is drawn under the boot spinner, but nothing can act on it yet:
    // booting a tool is the iframe loading and running its own handshake, and
    // there is no cancel path through that. Wired as a deliberate no-op rather
    // than left unbound, so the day a cancel exists this is where it goes and
    // the accelerator does not have to be rediscovered.
    cancelBoot: () => {},

    // Every menu accelerator, routed through the same `blocked()` the menu item
    // reads. That is what makes Ctrl+S with nothing dirty do exactly what
    // clicking a greyed-out Save does — nothing — rather than posting a command
    // the app has said it cannot carry out.
    newFile: () => runIfAllowed(app, APP_COMMAND.newFile),
    openProject: onOpenProject,
    save: () => runIfAllowed(app, APP_COMMAND.save),
    saveAs: () => runIfAllowed(app, APP_COMMAND.saveAs),
    duplicate: () => runIfAllowed(app, APP_COMMAND.duplicate),
    closeWindow: onCloseWindow,

    commandPalette: () => setSearchExpanded(true),
    togglePanel: () => setPanelCollapsed((c) => !c),
    toggleTerminal: onToggleTerminal,
    toggleFullscreen: onToggleFullscreen,
    zoomIn: () => onZoom(1),
    zoomOut: () => onZoom(-1),

    newTerminal: () => void onNewTerminal(),
    splitTerminal: () => {
      if (focusedPaneId) void onSplit();
    },
  });

  // A scan in flight has nowhere to show yet — the health popover renders the
  // result, not the request. Kept in the signature so the day it gets a
  // spinner, the value is already here.
  void rescanning;

  return (
    <MotionConfig transition={snap} reducedMotion="user">
      <Frame
        kind={kind}
        panelCollapsed={panelCollapsed}
        panelWidth={panelWidth}
        onPanelWidthChange={setPanelWidth}
        panelMaximized={panelMaximized}
        onPanelMaximizedChange={setPanelMaximized}
        slots={{
          // The spec's title is "HELVE Engine — [tool]": the bar names what the
          // window is currently showing, not the application again.
          titleBar: (
            <TitleBar
              kind={kind}
              title={activeInstanceName}
              menus={defaultMenus({
                app,
                edit,
                apps: {
                  // Every app this build ships, as things you can open another
                  // of. Built from the registry rather than a literal list, so
                  // an app added in Rust appears here without a second edit.
                  available: apps.map((a) => ({ id: a.id, name: a.name })),
                  open: onOpenApp,
                },
                file: {
                  newWindow: onNewWindow,
                  openProject: onOpenProject,
                  openRecent: onOpenRecent,
                  closeWindow: onCloseWindow,
                },
                view: {
                  commandPalette: () => setSearchExpanded(true),
                  panelCollapsed,
                  togglePanel: () => setPanelCollapsed((c) => !c),
                  terminalShowing,
                  toggleTerminal: onToggleTerminal,
                  fullscreen,
                  toggleFullscreen: onToggleFullscreen,
                  zoomIn: () => onZoom(1),
                  zoomOut: () => onZoom(-1),
                  zoomInBlocked: zoomBlocked(zoom, 1),
                  zoomOutBlocked: zoomBlocked(zoom, -1),
                },
                terminal: {
                  onNew: onNewTerminal,
                  onSplit,
                  onKill: onKillTerminal,
                  onClear,
                  enabled: Boolean(focusedPaneId),
                },
              })}
            />
          ),
          // Present in *every* window now, where it used to be omitted from a
          // detached one. That omission was right when a detached window held
          // exactly one tool and so had nothing to switch between; it holds real
          // clusters that can be added to and switched between, so there is.
          switcherBar: (
            <ClusterBar
              clusters={clusters}
              activeClusterId={activeClusterId}
              onSelect={onSelectCluster}
              onAdd={onAddCluster}
              onClose={onCloseCluster}
              onRename={onRenameCluster}
              healthOf={stackTools}
              onRescan={onRescan}
              searchExpanded={searchExpanded}
              searchSlot={
                <SearchSlot expanded={searchExpanded} onExpandedChange={setSearchExpanded} />
              }
            />
          ),
          toolWindow: (
            <ToolWindow
              ref={toolRef}
              tree={tree}
              instances={instances}
              presentationOf={presentationOf}
              focusedPaneId={activePaneId}
              onFocusPane={setActivePane}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseInstanceTab}
              onResize={onResizePane}
              onOpenApp={onOpenApp}
              onRescan={onRescan}
              dragHandleFor={(instanceId) => {
                const instance = instances.get(instanceId);
                if (!instance) return undefined;
                return drag.tabHandle({
                  instanceId,
                  title: instance.title,
                  kind: instance.kind,
                  fromPaneId: activePaneId,
                });
              }}
              dropTarget={drag.target}
              onCommandsChange={onCommandsChange}
            />
          ),
          secondaryPanel: (
            <SecondaryPanel
              sessions={sessions}
              activeTabId={panelTabId}
              collapsed={panelCollapsed}
              onSelectTab={onSelectPanelTab}
              onNewTerminal={onNewTerminal}
              onToggleCollapse={() => setPanelCollapsed((c) => !c)}
              onRequestClose={requestCloseTab}
              dropActive={drag.target?.kind === "panel"}
              pendingClose={pendingClose}
              onCancelClose={() => setPendingClose(null)}
              onConfirmClose={() => {
                if (pendingClose) onCloseTab(pendingClose.id);
                setPendingClose(null);
              }}
              // Every session's emulator, all mounted, one visible. Passed as a
              // slot for the same reason the worktree view is: the panel owns
              // the tab row and the geometry, and has no business knowing that
              // a terminal is xterm rather than anything else.
              terminalView={
                <TerminalDeck
                  ref={deckRef}
                  sessions={sessions}
                  activeId={panelTabId === "worktree" ? "" : panelTabId}
                  focusedId={focusedPaneId || null}
                  onFocusPane={setFocusedPaneId}
                  transport={terminalTransport}
                  // The title itself doesn't come back through this
                  // callback — Rust is the owner of record (a terminal can
                  // be dragged into another window), so this only reports
                  // what xterm saw, and the name a tab actually renders
                  // comes back around through `shell:state` and `sessions`
                  // above.
                  onTitle={(id, title) => terminalControl.setTitle(id, title)}
                />
              }
              worktreeView={
                <SourceControlView
                  control={gitControl}
                  toolId={activeInstance?.appId ?? null}
                  git={git}
                />
              }
              // The same handle a pane's tab gets. A terminal and an app surface
              // drag identically now, which is what lets a terminal be dropped
              // into the layout at all — the panel is where it starts, not the
              // only place it can be.
              dragHandleFor={(session) =>
                drag.tabHandle({
                  instanceId: session.id,
                  title: session.title,
                  kind: "terminal",
                  agentFinished: session.agentFinished,
                  fromPaneId: null,
                })
              }
            />
          ),
          overlay: drag.overlay,
          statusBar: (
            <StatusBar
              engine={engine}
              branch={git.status && { name: git.status.branch, ahead: git.status.ahead, behind: git.status.behind }}
              githubOk={!error}
            />
          ),
        }}
      />
    </MotionConfig>
  );
}

/**
 * Why Zoom In or Zoom Out cannot go any further, or `undefined`.
 *
 * Two reasons, and they are different kinds of thing: there is no webview to
 * scale at all (a browser under `?fake=1`), or the ladder has run out in that
 * direction. The second is what keeps the item honest at the ends — clicking
 * Zoom In at 250% would otherwise look like a click that did nothing.
 */
function zoomBlocked(zoom: number, direction: 1 | -1): string | undefined {
  if (!isTauri()) {
    return "Zoom scales the desktop app's webview. There is no webview to scale in a browser.";
  }
  if (nextZoom(zoom, direction) !== zoom) return undefined;
  const at = `${Math.round(zoom * 100)}%`;
  return direction === 1 ? `Already at the largest size (${at}).` : `Already at the smallest size (${at}).`;
}

/**
 * Whether a frame's declaration says the same thing it said last time.
 *
 * A frontend re-declares from an effect, so the same set arrives again on every
 * render that changed anything else. Without this, each one would be a new
 * object in `appCommands` and a re-render of the whole window — for a menu that
 * is closed, describing a state that has not moved.
 *
 * Order-insensitive, because the set is assembled from conditionals on the
 * other side and the order they fall in is not a change. `undefined` (nothing
 * declared yet) is only equal to an empty list, which is the same claim.
 */
function sameSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (a === undefined) return b.length === 0;
  if (a.length !== b.length) return false;
  const have = new Set(a);
  return b.every((entry) => have.has(entry));
}
