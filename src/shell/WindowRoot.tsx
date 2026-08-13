import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import type { StackSnapshot } from "../bindings";
import Frame from "./frame/Frame";
import {
  toolPresentation,
  type EngineState,
  type TerminalBusy,
  type TerminalSession,
  type TerminalTabGroup,
  type WindowKind,
} from "./contract";
import { snap } from "./motion";
import TitleBar, { defaultMenus } from "./titlebar/TitleBar";
import ToolSwitcherBar from "./switcher/ToolSwitcherBar";
import ToolWindow from "./toolwindow/ToolWindow";
import SecondaryPanel from "./panel/SecondaryPanel";
import StatusBar from "./statusbar/StatusBar";
import SearchSlot from "./search/SearchSlot";
import { useDrag } from "./drag/useDrag";
import { useKeyboard } from "./keys/useKeyboard";
import SourceControlView from "./worktree/SourceControlView";
import { useGitStatus } from "./worktree/useGitStatus";
import TerminalDeck, { type TerminalDeckHandle } from "./terminal/TerminalDeck";
import { idleEngineStatus } from "./stubs/engineStatus";
import { useShellState, windowLabel, setActiveTool } from "./state/shellState";
import { terminalControl, terminalTransport } from "./state/terminals";
import { gitControl } from "./state/git";

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

  // The switcher lists authoring tools. The engine is a runtime with no
  // frontend — the orchestrator supervises it, tools talk to it over a pipe,
  // and it never gets a tab.
  const allTools = useMemo(
    () => (snapshot?.tools ?? []).filter((t) => t.kind === "dev-tool").map(toolPresentation),
    [snapshot],
  );

  const shell = useShellState();
  const placement = shell?.windows.find((w) => w.label === label) ?? null;

  // What this window actually holds, in the order Rust says it holds it.
  //
  // Both halves matter. The order is what makes dragging a tab sideways mean
  // anything — the drag layer reorders by calling `set_docked_tools`, and if
  // this rendered the manifest order instead, that call would land in Rust and
  // change nothing on screen. The filtering is what makes detaching mean
  // anything: a detached window holds one tool, and every window rendering
  // every tool would leave the tab sitting in the bar it was just dragged out
  // of. Falling back to the manifest list only covers the moment before the
  // first `shell:state` arrives.
  const tools = useMemo(() => {
    const order = placement?.toolIds;
    if (!order) return allTools;
    const byId = new Map(allTools.map((t) => [t.id, t]));
    return order.flatMap((id) => {
      const tool = byId.get(id);
      return tool ? [tool] : [];
    });
  }, [allTools, placement?.toolIds]);

  // Rust owns which tool is active, because a detached window has to be able to
  // take one away from this bar. But a click must paint on the next frame, not
  // after a round-trip — so this holds the selection locally and the effect
  // below defers to Rust whenever Rust says something different. Optimistic in
  // the ordinary sense: the local value is a prediction of the broadcast that
  // is already on its way.
  const [activeToolId, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (placement?.activeToolId) setActive(placement.activeToolId);
  }, [placement?.activeToolId]);

  // Nothing has ever been chosen — neither here nor in Rust. Fall to the first
  // tool the stack scan produced so the window opens on something.
  const shownToolId = activeToolId ?? tools[0]?.id ?? null;

  const onSelectTool = useCallback(
    (id: string) => {
      setActive(id);
      void setActiveTool(label, id);
    },
    [label],
  );

  // --- terminals ------------------------------------------------------------
  //
  // Sessions come from `shell:state` and nowhere else. They have to: a terminal
  // can be dragged into another window, so the list of what this panel holds is
  // a filter over shared state rather than anything this window owns. Each one
  // has a real pty behind it (src-tauri/src/pty.rs) — the panel is not showing
  // a fixture any more.
  const sessions = useMemo(
    () =>
      (shell?.terminals ?? [])
        .filter((t) => t.windowLabel === label)
        .map(({ id, title, agentFinished, groupId }) => ({ id, title, agentFinished, groupId })),
    [shell?.terminals, label],
  );

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

  const [engine, setEngine] = useState<EngineState>("idle");
  useEffect(() => idleEngineStatus.subscribe(setEngine), []);

  // The status bar and the source-control tab read one status. Two fetches
  // would be two chances to disagree about which branch is checked out, and the
  // whole point of the branch appearing in the status bar is that it is the
  // answer, not a second opinion. It also has to outlive the tab: the panel
  // keeps `worktreeView` mounted but hidden, and a status owned by the view
  // would still be re-fetched on every remount of it.
  const git = useGitStatus(gitControl, shownToolId);

  // The drag layer is the only thing in the shell that spans regions, so it is
  // the only thing that has to be handed down rather than owned locally. The
  // regions never import it — they take a handle factory and stay ignorant of
  // what a drag is.
  const drag = useDrag();

  useKeyboard({
    // ⌘1…⌘9 index into what this window is showing, which is why the hook
    // takes an index and never sees the list: only this component knows that
    // the bar renders `placement.toolIds`, and a detached window's ⌘1 means
    // its own one tool.
    selectToolByIndex: (index) => {
      const tool = tools[index];
      if (tool?.interactive) onSelectTool(tool.id);
    },
    rescan: onRescan,
    // ⌘. is drawn under the boot spinner, but nothing can act on it yet:
    // booting a tool is the iframe loading and running its own handshake, and
    // there is no cancel path through that. Wired as a deliberate no-op rather
    // than left unbound, so the day a cancel exists this is where it goes and
    // the accelerator does not have to be rediscovered.
    cancelBoot: () => {},
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
              title={tools.find((t) => t.id === shownToolId)?.name ?? ""}
              menus={defaultMenus({
                onNew: onNewTerminal,
                onSplit,
                onKill: onKillTerminal,
                onClear,
                enabled: Boolean(focusedPaneId),
              })}
            />
          ),
          // A detached window holds exactly one tool, so there is nothing to
          // switch between and the bar is omitted rather than emptied.
          switcherBar:
            kind === "main" ? (
              <ToolSwitcherBar
                tools={tools}
                activeToolId={shownToolId}
                onSelect={onSelectTool}
                onRescan={onRescan}
                searchExpanded={searchExpanded}
                dragHandleFor={(tool) => drag.toolHandle({ kind: "tool", toolId: tool.id, name: tool.name })}
                searchSlot={
                  <SearchSlot expanded={searchExpanded} onExpandedChange={setSearchExpanded} />
                }
              />
            ) : undefined,
          toolWindow: (
            <ToolWindow
              tools={tools}
              activeToolId={shownToolId}
              onOpenTool={onSelectTool}
              onRescan={onRescan}
            />
          ),
          secondaryPanel: (
            <SecondaryPanel
              sessions={sessions}
              activeTabId={panelTabId}
              collapsed={panelCollapsed}
              onSelectTab={setActivePanelTab}
              onNewTerminal={onNewTerminal}
              onToggleCollapse={() => setPanelCollapsed((c) => !c)}
              onRequestClose={requestCloseTab}
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
              worktreeView={<SourceControlView control={gitControl} toolId={shownToolId} git={git} />}
              dragHandleFor={(session) =>
                drag.terminalHandle({
                  kind: "terminal",
                  sessionId: session.id,
                  title: session.title,
                  agentFinished: session.agentFinished,
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
