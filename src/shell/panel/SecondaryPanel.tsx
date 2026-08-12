/**
 * The secondary panel — its tab row, its terminal body, and its collapsed
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
 */
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { DragHandleProps, TerminalSession } from "../contract";
import { ChevronLeft, ChevronRight, GitBranch, Plus } from "../../ui/Icon";
import { snap } from "../motion";
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
  dragHandleFor,
}: SecondaryPanelProps) {
  if (collapsed) {
    return <CollapsedStrip sessions={sessions} activeTabId={activeTabId} onToggleCollapse={onToggleCollapse} />;
  }

  const activeSession = sessions.find((s) => s.id === activeTabId);

  return (
    <div className="panel">
      {/* Plain div, fixed height, no `layout` prop — the row itself never
          animates. Only the rule sliding inside it does. A tab lifting out to
          become a drag ghost is Parcel J's concern; this row's own height is
          unaffected either way. */}
      <div className="panel__tabs">
        {sessions.map((session) => (
          <SessionTab
            key={session.id}
            session={session}
            active={session.id === activeTabId}
            onSelect={onSelectTab}
            dragHandle={dragHandleFor?.(session)}
          />
        ))}

        <button type="button" className="panel__newbtn" onClick={onNewTerminal} aria-label="New terminal">
          <Plus />
        </button>

        <div className="panel__spacer" />

        <WorktreeTab active={activeTabId === WORKTREE_TAB} onSelect={onSelectTab} />

        <button type="button" className="panel__collapsebtn" onClick={onToggleCollapse} aria-label="Collapse panel">
          <ChevronRight />
        </button>
      </div>

      <div className="panel__body">
        {activeTabId === WORKTREE_TAB
          ? (worktreeView ?? null)
          : activeSession && <TerminalOutput session={activeSession} />}
      </div>
    </div>
  );
}

function SessionTab({
  session,
  active,
  onSelect,
  dragHandle,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: (id: string) => void;
  /** Undefined until the drag layer is wired in — the tab behaves exactly as
   *  before in that case. */
  dragHandle?: DragHandleProps;
}) {
  const classes = ["panel__tab"];
  if (active) classes.push("panel__tab--active");

  // `onClick` is untouched — a press that never moves is a click. Parcel J's
  // `onPointerDown` owns the movement threshold that turns a press into a
  // drag; this component doesn't debounce or replace either handler, it just
  // lets both listen.
  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-pressed={active}
      onClick={() => onSelect(session.id)}
      onPointerDown={dragHandle?.onPointerDown}
      style={dragHandle?.style}
    >
      <span className="panel__tab-label">{session.title}</span>
      {/* This dot means *this agent finished*. It is not tool health, and it
          never appears on a tool tab — only here. */}
      {session.agentFinished && <span className="panel__tab-dot" />}
      {active && <motion.div className="panel__rule" layoutId="panel-rule" transition={snap} />}
    </button>
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

/**
 * Plain `<div>`s, on purpose. No `motion.*`, no `AnimatePresence`, no
 * `layout` prop, no stagger, no fade-in on new lines — a terminal that
 * animates its own scrolling is unusable. The body's `overflow-y: auto`
 * lives on the shared scroll container in `SecondaryPanel` so it applies the
 * same way whether the active tab is a terminal or the worktree view.
 */
function TerminalOutput({ session }: { session: TerminalSession }) {
  const lastIndex = session.lines.length - 1;
  return (
    <div className="panel__terminal">
      {session.lines.map((line, i) => (
        <div key={i} className={`panel__line panel__line--${line.tone}`}>
          {line.text}
          {i === lastIndex && <span className="panel__cursor" />}
        </div>
      ))}
    </div>
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
