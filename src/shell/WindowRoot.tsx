import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import type { StackSnapshot } from "../bindings";
import Frame, { PANEL_COLLAPSED } from "./frame/Frame";
import { toolPresentation, type EngineState, type WindowKind } from "./contract";
import { snap } from "./motion";
import TitleBar, { defaultMenus } from "./titlebar/TitleBar";
import ToolSwitcherBar from "./switcher/ToolSwitcherBar";
import ToolWindow from "./toolwindow/ToolWindow";
import SecondaryPanel from "./panel/SecondaryPanel";
import StatusBar from "./statusbar/StatusBar";
import SearchSlot from "./search/SearchSlot";
import { useDrag } from "./drag/useDrag";
import { useKeyboard } from "./keys/useKeyboard";
import WorktreeView from "./worktree/WorktreeView";
import { stubTerminalSource } from "./stubs/terminal";
import { stubWorktreeSource } from "./stubs/worktree";
import type { Worktree } from "./contract";
import { idleEngineStatus } from "./stubs/engineStatus";
import { useShellState, windowLabel, setActiveTool } from "./state/shellState";
import type { TerminalSession } from "./contract";

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
  // through the backend would make one of them wrong.
  const [panelWidth, setPanelWidth] = useState(380);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

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
  // Session *identity* is Rust's (it survives a window closing, and sessions
  // drag between windows); session *content* is still the stub, because there
  // is no PTY yet. Subscribing to the stub keeps the panel real — tabs open and
  // close for real — and swapping in a live source later is one import.
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  useEffect(() => stubTerminalSource.subscribe(setSessions), []);
  const [activePanelTab, setActivePanelTab] = useState<string>("");
  const panelTabId = sessions.some((s) => s.id === activePanelTab)
    ? activePanelTab
    : activePanelTab === "worktree"
      ? "worktree"
      : (sessions[0]?.id ?? "");

  const [engine, setEngine] = useState<EngineState>("idle");
  useEffect(() => idleEngineStatus.subscribe(setEngine), []);

  // The status bar and the worktree tab read the same subscription. Two
  // subscriptions to one source would be two chances to disagree about which
  // branch is checked out, and the whole point of the branch appearing in the
  // status bar is that it is the answer, not a second opinion.
  const [tree, setTree] = useState<Worktree | null>(null);
  useEffect(() => stubWorktreeSource.subscribe(setTree), []);

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
        panelWidth={panelCollapsed ? PANEL_COLLAPSED : panelWidth}
        onPanelWidthChange={setPanelWidth}
        slots={{
          // The spec's title is "HELVE Engine — [tool]": the bar names what the
          // window is currently showing, not the application again.
          titleBar: (
            <TitleBar
              kind={kind}
              title={tools.find((t) => t.id === shownToolId)?.name ?? ""}
              menus={defaultMenus()}
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
              onNewTerminal={() => setActivePanelTab(stubTerminalSource.create())}
              onToggleCollapse={() => setPanelCollapsed((c) => !c)}
              worktreeView={<WorktreeView source={stubWorktreeSource} />}
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
              branch={tree && { name: tree.branch, ahead: tree.ahead, behind: tree.behind }}
              githubOk={!error}
            />
          ),
        }}
      />
    </MotionConfig>
  );
}
