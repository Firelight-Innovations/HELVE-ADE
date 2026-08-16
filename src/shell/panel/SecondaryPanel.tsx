/**
 * The secondary panel — its tab row, its dual-slot body, and its collapsed
 * strip.
 *
 * Measured against the handoff's SCREEN 01/02 panel crops and the isolated
 * "Panel collapsed" crop (docs/handoffs/shell-spec.html). This component
 * renders into `.frame__panel`, which already carries the panel's width, its
 * background, and the collapse animation (src/shell/frame/Frame.tsx,
 * frame.css) — nothing here repeats those, and nothing here sets a width.
 *
 * The tab row is explicitly "the same segment style as the tool switcher
 * bar" (src/shell/switcher/ToolSwitcherBar.tsx): full height, hairline
 * dividers, a single sliding accent rule shared by whichever segment is
 * active. The worktree tab is built the same way as a terminal tab — it is
 * just another segment that can be the active one — so it shares the rule.
 *
 * The row is no longer one flat sequence, though. Terminals are unbounded and
 * this panel is not, so the row splits into a strip that scrolls (the
 * session tabs and the `+` button) and two pinned groups that never move —
 * the worktree tab and the collapse button, each its own container rather
 * than two children of one shared wrapper, on a standing instruction that
 * those two controls must not share a parent — see the CSS header in
 * panel.css for the geometry.
 *
 * ## Why the tabs are here and not only in the cluster bar
 *
 * They were briefly moved up there, on the theory that a terminal was a
 * cluster's content like any surface. It is not: a terminal in this panel
 * belongs to the *window* (see `TerminalSessionState.windowLabel`), so it
 * stays put while the cluster above it changes, and no cluster's group in
 * that bar could list it without claiming something untrue. The panel is an
 * independent region and names its own contents.
 *
 * A terminal dragged into the layout is the other case, and it needs nothing
 * here: it becomes a tab in a pane tree and the cluster bar lists it as one,
 * because that is what it now is. `sessions` excludes it, so it leaves this
 * row on the same frame — one home each way, never both.
 *
 * Sessions that share a `groupId` (set by Rust when a split happens — see
 * `TerminalSession` in contract.ts) render as one tab here, via
 * `groupTerminalTabs`: a split still needs exactly one clickable tab before
 * `TerminalDeck` has anything to lay out side by side, and that tab has to
 * come from somewhere the row itself draws. Splitting, clearing, and killing
 * a terminal are not this bar's job, though — they live on the Terminal menu
 * in the title bar (`titlebar/TitleBar.tsx`) — so this file owns only that
 * one tab shows per group, not any control over what happens to it.
 *
 * The close confirmation is owned by `WindowRoot` now rather than here — the
 * Terminal menu's Kill item has to be able to raise the same "still running,
 * close anyway?" dialog a tab's own × does, and a dialog whose state lived
 * only in this file could never be reached from there. This component still
 * *renders* `CloseConfirm`, since the dialog is visually scoped to the panel;
 * it just no longer decides when to show it.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useRef, type ReactNode } from "react";
import {
  groupTerminalTabs,
  type DragHandleProps,
  type TerminalBusy,
  type TerminalSession,
  type TerminalTabGroup,
} from "../contract";
import { useDropZone } from "../drag/dropZones";
import { Close, ChevronLeft, ChevronRight, GitBranch, Plus } from "../../ui/Icon";
import { snap } from "../motion";
import OverlayScrollbar from "../scrollbar/OverlayScrollbar";
import CloseConfirm from "./CloseConfirm";
import "./panel.css";

const WORKTREE_TAB = "worktree";

export interface SecondaryPanelProps {
  /**
   * Every terminal in this window's panel — the window's, not any cluster's,
   * and already excluding any that have been dragged into the layout.
   */
  sessions: TerminalSession[];
  /** A session id, a group id, or the literal `"worktree"`. */
  activeTabId: string;
  collapsed: boolean;
  onSelectTab: (id: string) => void;
  onNewTerminal: () => void;
  onToggleCollapse: () => void;
  /** Another parcel fills this. Undefined renders nothing, not a placeholder. */
  worktreeView?: ReactNode;
  /**
   * The terminal emulator deck. Another parcel supplies it. Undefined renders
   * nothing, not a placeholder — matching `worktreeView`.
   *
   * This is the whole deck, not one session's output: which session (or, for
   * a split tab, which sessions) are showing inside it is that parcel's
   * business, not this component's. What this component owns is only which
   * of the two *slots* — this one, or `worktreeView`'s — is visible, and
   * making sure neither is ever unmounted to switch between them.
   */
  terminalView?: ReactNode;
  /**
   * A tab's own × asks through here, passing the whole tab rather than a
   * single session — `WindowRoot` is the one that resolves which pane that
   * means (the focused one, if this is the active tab; the tab's first
   * session otherwise), through the exact same function the Terminal menu's
   * Kill item calls. This component stays ignorant of which pane is
   * focused; it only ever has "the tab that was clicked".
   */
  onRequestClose: (tab: TerminalTabGroup) => void;
  /**
   * The pending "still running, close anyway?" dialog, or null. Owned by
   * `WindowRoot` — see this file's own doc comment for why.
   */
  pendingClose: { id: string; title: string; busy: TerminalBusy } | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  /**
   * Supplied by the drag layer. Spread onto each terminal tab to make it a
   * drag source.
   *
   * Not optional in spirit, whatever the type says: this handle is the only
   * way a panel terminal can be dragged into a cluster's layout at all, which
   * is half of what the panel is for. Only session tabs are drag sources — the
   * worktree segment, the new-terminal button and the collapse chevron are not
   * sessions and nothing about them is draggable.
   */
  dragHandleFor?: (session: TerminalSession) => DragHandleProps | undefined;
  /**
   * A drag is currently over this panel and would land here on release.
   *
   * Passed in rather than read from the drag layer, so the panel stays a
   * component that draws what it is told — the same arrangement the panes use
   * for their own indicators.
   */
  dropActive?: boolean;
}

export default function SecondaryPanel({
  sessions,
  activeTabId,
  collapsed,
  onSelectTab,
  onNewTerminal,
  onToggleCollapse,
  worktreeView,
  terminalView,
  onRequestClose,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  dragHandleFor,
  dropActive = false,
}: SecondaryPanelProps) {
  // Every hook first, and the collapse checked after them. This component used
  // to return `CollapsedStrip` above these three, which is a hook count that
  // changes with a prop — React throws "rendered fewer hooks than expected" and
  // tears down the tree the first time Ctrl+B is pressed. It survived only
  // because nothing had collapsed the panel yet.
  //
  // `useDropZone` in particular must not be skipped: it is what unregisters the
  // panel's drop zone, and a panel that collapsed without running it would have
  // left a zone pointing at an element that is no longer drawn.
  const panelZone = useDropZone({ kind: "panel" });
  const onWorktree = activeTabId === WORKTREE_TAB;
  const tabs = groupTerminalTabs(sessions);
  const stripRef = useRef<HTMLDivElement | null>(null);

  if (collapsed) {
    return (
      <CollapsedStrip
        sessions={sessions}
        activeTabId={activeTabId}
        onToggleCollapse={onToggleCollapse}
      />
    );
  }

  return (
    // Registered as a drop zone so a terminal dragged out into the layout can
    // be dragged back. The drag layer used to find this element by querying
    // `[data-region="panel"]`; it now has to be told, because there is no query
    // that can enumerate an arbitrary number of panes as well.
    <div className="panel" ref={panelZone} data-drop-active={dropActive || undefined}>
      {/* Plain div, fixed height, no `layout` prop — the row itself never
          animates. Only the rule sliding inside it does, and (since this
          split) the strip's own scroll position, which is native and not
          animated either. A tab lifting out to become a drag ghost is the
          drag layer's concern; this row's own height is unaffected either
          way. */}
      <div className="panel__tabs">
        <div className="panel__tabs-strip" ref={stripRef}>
          {tabs.map((tab) => (
            <SessionTab
              key={tab.id}
              group={tab}
              active={tab.id === activeTabId}
              onSelect={onSelectTab}
              onRequestClose={onRequestClose}
              dragHandle={dragHandleFor?.(tab.sessions[0])}
            />
          ))}

          <button
            type="button"
            className="panel__newbtn"
            onClick={onNewTerminal}
            aria-label="New terminal"
          >
            <Plus />
          </button>
        </div>

        {/* Not a child of the strip above — see the header comment in
            panel.css on why `.panel__tabs` is the box this has to be
            anchored in instead, and why it's rendered before the two pinned
            groups below rather than after. */}
        <OverlayScrollbar targetRef={stripRef} />

        {/* Two pinned groups, each its own parent — not one wrapper holding
            both. The worktree tab and the collapse button must not share a
            parent (a standing instruction), so each gets its own
            absolutely-positioned box with its own opaque background; see
            panel.css for how they still read as one contiguous pinned
            strip despite being two separate elements. */}
        <div className="panel__worktreegroup">
          <WorktreeTab active={onWorktree} onSelect={onSelectTab} />
        </div>

        <div className="panel__collapsegroup">
          <button
            type="button"
            className="panel__collapsebtn"
            onClick={onToggleCollapse}
            aria-label="Collapse panel"
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Both slots render on every pass. The inactive one is hidden with
          `display: none`, never unmounted — an unmounted terminal emulator
          loses its scrollback and its running process's own rendering
          state, so switching to the worktree tab and back has to be free. */}
      <div className="panel__body">
        <div
          className={`panel__body-slot panel__body-slot--worktree${onWorktree ? "" : " panel__body-slot--hidden"}`}
        >
          {worktreeView ?? null}
        </div>
        <div
          className={`panel__body-slot panel__body-slot--terminal${onWorktree ? " panel__body-slot--hidden" : ""}`}
        >
          {terminalView ?? null}
        </div>
      </div>

      <AnimatePresence>
        {pendingClose && (
          <CloseConfirm
            title={pendingClose.title}
            busy={pendingClose.busy}
            onCancel={onCancelClose}
            onConfirm={onConfirmClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionTab({
  group,
  active,
  onSelect,
  onRequestClose,
  dragHandle,
}: {
  /** One or more sessions sharing this tab — more than one only when this is
   *  a split. */
  group: TerminalTabGroup;
  active: boolean;
  onSelect: (id: string) => void;
  onRequestClose: (tab: TerminalTabGroup) => void;
  /** The drag source. Undefined only leaves the tab undraggable; nothing else
   *  about it changes. */
  dragHandle?: DragHandleProps;
}) {
  // The label and the native tooltip show the group's first pane's title —
  // enumerating every pane's name wouldn't fit the row, and which pane is
  // which once the tab is open is the split's own concern, not this row's.
  const primary = group.sessions[0];
  // A group's dot means *some* pane in it finished — either one could be the
  // agent that just wrapped up, and this tab has only one dot to show it
  // with.
  const finished = group.sessions.some((s) => s.agentFinished);

  const classes = ["panel__tab"];
  if (active) classes.push("panel__tab--active");

  // A `<button>` can't nest a `<button>` — the close button below is a real,
  // independently focusable control, so the tab itself has to stop being one.
  // `role="tab"` + `aria-selected` + `tabIndex` reproduce what the native
  // button gave up: a keyboard-reachable, screen-reader-legible tab.
  //
  // `onClick` and `onPointerDown` are untouched otherwise — a press that
  // never moves is still a click, and the drag layer's `onPointerDown` still
  // owns the movement threshold that turns a press into a drag. This
  // component doesn't debounce or replace either handler, it just lets both
  // listen.
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      className={classes.join(" ")}
      // The label itself is clipped with an ellipsis once a reported title
      // runs long (see `.panel__tab-label` in panel.css) — this is what
      // makes the full string available anyway, on hover.
      title={primary.title}
      onClick={() => onSelect(group.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(group.id);
        }
      }}
      onPointerDown={dragHandle?.onPointerDown}
      style={dragHandle?.style}
    >
      <span className="panel__tab-label">{primary.title}</span>

      {/* One box, two mutually exclusive occupants — the agent-finished dot
          normally, the close button on hover or keyboard focus. Never both,
          and the box's own footprint never changes size between them, which
          is what keeps the tab's width fixed while hovering. */}
      <span className="panel__tab-end">
        {finished && <span className="panel__tab-dot" />}
        <button
          type="button"
          className="panel__tab-close"
          aria-label={`Close ${primary.title}`}
          onClick={(e) => {
            // Otherwise this bubbles to the tab's own onClick and selects a
            // tab that may be a heartbeat away from closing.
            e.stopPropagation();
            onRequestClose(group);
          }}
          // A pointerdown here must never reach the tab's onPointerDown —
          // that's the drag handle, and a click meant to close a tab must
          // never be read as the start of a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Close />
        </button>
      </span>

      {active && <motion.div className="panel__rule" layoutId="panel-rule" transition={snap} />}
    </div>
  );
}

/** The worktree tab: a trailing segment, built the same way as a session tab. */
function WorktreeTab({ active, onSelect }: { active: boolean; onSelect: (id: string) => void }) {
  const classes = ["panel__worktreebtn"];
  if (active) classes.push("panel__tab--active");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-pressed={active}
      aria-label="Worktree"
      onClick={() => onSelect(WORKTREE_TAB)}
    >
      <GitBranch size={15} />
      {active && <motion.div className="panel__rule" layoutId="panel-rule" transition={snap} />}
    </button>
  );
}

function CollapsedStrip({
  sessions,
  activeTabId,
  onToggleCollapse,
}: {
  sessions: TerminalSession[];
  activeTabId: string;
  onToggleCollapse: () => void;
}) {
  // The strip shows one terminal name. `activeTabId` can now name a group
  // rather than a session directly, so this matches either — and when the
  // worktree tab was the one active before collapsing, there is no session
  // to name at all, so it falls back to the first session rather than
  // showing nothing (the handoff doesn't cover that case).
  const activeSession =
    sessions.find((s) => s.id === activeTabId || s.groupId === activeTabId) ?? sessions[0];

  return (
    <div className="panel panel__collapsed">
      <button
        type="button"
        className="panel__restorebtn"
        onClick={onToggleCollapse}
        aria-label="Restore panel"
      >
        <ChevronLeft />
      </button>
      {activeSession && <div className="panel__collapsed-label">{activeSession.title}</div>}
      <div className="panel__collapsed-branch">
        <GitBranch size={14} />
      </div>
    </div>
  );
}
