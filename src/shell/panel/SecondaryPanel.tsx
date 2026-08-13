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
 * session tabs and the `+` button) and a pinned end group that never moves
 * (the worktree tab and the collapse button) — see the CSS header in
 * panel.css for the geometry.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import type { DragHandleProps, TerminalBusy, TerminalSession } from "../contract";
import { Close, ChevronLeft, ChevronRight, GitBranch, Plus } from "../../ui/Icon";
import { snap } from "../motion";
import CloseConfirm from "./CloseConfirm";
import "./panel.css";

const WORKTREE_TAB = "worktree";

export interface SecondaryPanelProps {
  sessions: TerminalSession[];
  /** A session id, or the literal `"worktree"`. */
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
   * This is the whole deck, not one session's output: which session is
   * showing inside it is that parcel's business, not this component's. What
   * this component owns is only which of the two *slots* — this one, or
   * `worktreeView`'s — is visible, and making sure neither is ever unmounted
   * to switch between them.
   */
  terminalView?: ReactNode;
  /**
   * Asked once, at the moment the × is clicked. Resolves to null when the
   * session is idle — that close needs no dialog. Never polled and never
   * subscribed to, which is what keeps this cheap.
   */
  checkBusy: (id: string) => Promise<TerminalBusy | null>;
  onCloseTab: (id: string) => void;
  /**
   * Supplied by the drag layer. Spread onto each terminal tab to make it a
   * drag source; terminals move between windows by being dropped into a
   * panel. Only session tabs are drag sources — the worktree segment, the
   * new-terminal button, and the collapse chevron are not sessions and
   * nothing about them is draggable.
   */
  dragHandleFor?: (session: TerminalSession) => DragHandleProps | undefined;
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
  checkBusy,
  onCloseTab,
  dragHandleFor,
}: SecondaryPanelProps) {
  // The session named here is only ever the one a × was clicked on, kept
  // long enough to ask `checkBusy` and, if it answers, to name the dialog —
  // not a general "which tab is selected" concept, that's `activeTabId`.
  const [pendingClose, setPendingClose] = useState<{ id: string; title: string; busy: TerminalBusy } | null>(null);

  if (collapsed) {
    return <CollapsedStrip sessions={sessions} activeTabId={activeTabId} onToggleCollapse={onToggleCollapse} />;
  }

  async function requestClose(session: TerminalSession) {
    const busy = await checkBusy(session.id);
    if (busy) {
      setPendingClose({ id: session.id, title: session.title, busy });
    } else {
      onCloseTab(session.id);
    }
  }

  const onWorktree = activeTabId === WORKTREE_TAB;

  return (
    <div className="panel">
      {/* Plain div, fixed height, no `layout` prop — the row itself never
          animates. Only the rule sliding inside it does, and (since this
          split) the strip's own scroll position, which is native and not
          animated either. A tab lifting out to become a drag ghost is
          Parcel J's concern; this row's own height is unaffected either
          way. */}
      <div className="panel__tabs">
        <div className="panel__tabs-strip">
          {sessions.map((session) => (
            <SessionTab
              key={session.id}
              session={session}
              active={session.id === activeTabId}
              onSelect={onSelectTab}
              onRequestClose={requestClose}
              dragHandle={dragHandleFor?.(session)}
            />
          ))}

          <button type="button" className="panel__newbtn" onClick={onNewTerminal} aria-label="New terminal">
            <Plus />
          </button>
        </div>

        {/* The pinned end group. Not wrapped in anything beyond itself — its
            own opaque background is what makes a tab scrolling past the
            trailing edge disappear behind these two buttons instead of
            clipping at a hard edge beside them. */}
        <div className="panel__tabs-end">
          <WorktreeTab active={onWorktree} onSelect={onSelectTab} />
          <button type="button" className="panel__collapsebtn" onClick={onToggleCollapse} aria-label="Collapse panel">
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Both slots render on every pass. The inactive one is hidden with
          `display: none`, never unmounted — an unmounted terminal emulator
          loses its scrollback and its running process's own rendering
          state, so switching to the worktree tab and back has to be free. */}
      <div className="panel__body">
        <div className={`panel__body-slot panel__body-slot--worktree${onWorktree ? "" : " panel__body-slot--hidden"}`}>
          {worktreeView ?? null}
        </div>
        <div className={`panel__body-slot panel__body-slot--terminal${onWorktree ? " panel__body-slot--hidden" : ""}`}>
          {terminalView ?? null}
        </div>
      </div>

      <AnimatePresence>
        {pendingClose && (
          <CloseConfirm
            title={pendingClose.title}
            busy={pendingClose.busy}
            onCancel={() => setPendingClose(null)}
            onConfirm={() => {
              onCloseTab(pendingClose.id);
              setPendingClose(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionTab({
  session,
  active,
  onSelect,
  onRequestClose,
  dragHandle,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: (id: string) => void;
  onRequestClose: (session: TerminalSession) => void;
  /** Undefined until the drag layer is wired in — the tab behaves exactly as
   *  before in that case. */
  dragHandle?: DragHandleProps;
}) {
  const classes = ["panel__tab"];
  if (active) classes.push("panel__tab--active");

  // A `<button>` can't nest a `<button>` — the close button below is a real,
  // independently focusable control, so the tab itself has to stop being one.
  // `role="tab"` + `aria-selected` + `tabIndex` reproduce what the native
  // button gave up: a keyboard-reachable, screen-reader-legible tab.
  //
  // `onClick` and `onPointerDown` are untouched otherwise — a press that
  // never moves is still a click, and Parcel J's `onPointerDown` still owns
  // the movement threshold that turns a press into a drag. This component
  // doesn't debounce or replace either handler, it just lets both listen.
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      className={classes.join(" ")}
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(session.id);
        }
      }}
      onPointerDown={dragHandle?.onPointerDown}
      style={dragHandle?.style}
    >
      <span className="panel__tab-label">{session.title}</span>

      {/* One box, two mutually exclusive occupants — the agent-finished dot
          normally, the close button on hover or keyboard focus. Never both,
          and the box's own footprint never changes size between them, which
          is what keeps the tab's width fixed while hovering. */}
      <span className="panel__tab-end">
        {session.agentFinished && <span className="panel__tab-dot" />}
        <button
          type="button"
          className="panel__tab-close"
          aria-label={`Close ${session.title}`}
          onClick={(e) => {
            // Otherwise this bubbles to the tab's own onClick and selects a
            // tab that may be a heartbeat away from closing.
            e.stopPropagation();
            onRequestClose(session);
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
  // The strip shows one terminal name. When the worktree tab was the one
  // active before collapsing, there is no session to name — the handoff
  // doesn't cover that case, so this falls back to the first session rather
  // than showing nothing.
  const activeSession = sessions.find((s) => s.id === activeTabId) ?? sessions[0];

  return (
    <div className="panel panel__collapsed">
      <button type="button" className="panel__restorebtn" onClick={onToggleCollapse} aria-label="Restore panel">
        <ChevronLeft />
      </button>
      {activeSession && <div className="panel__collapsed-label">{activeSession.title}</div>}
      <div className="panel__collapsed-branch">
        <GitBranch size={14} />
      </div>
    </div>
  );
}
