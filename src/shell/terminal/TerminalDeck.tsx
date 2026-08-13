import type { TerminalSession, TerminalTransport } from "../contract";
import XTermView from "./XTermView";
import "./terminal.css";

/**
 * Every session's emulator, one visible.
 *
 * The same problem `ToolWindow`/`ToolMount` solve for tool iframes — keep
 * every instance mounted so it never loses state, show exactly one — solved
 * the same way here rather than a second way: one `XTermView` per session,
 * all mounted at once, hidden with `display: none` rather than unmounted or
 * `visibility: hidden`. `display: none` (not `visibility`) is deliberate —
 * it's what makes a hidden container measure 0×0, which is the signal
 * `XTermView`'s `ResizeObserver` relies on to skip fitting a terminal nobody
 * can see and to catch the moment it becomes visible again.
 *
 * Mounting and unmounting follows `sessions` appearing and disappearing —
 * nothing else. `activeId === ""` means the worktree tab is the active one
 * in the panel, in which case every terminal here is hidden and none of them
 * is "the" active one.
 */
export default function TerminalDeck({
  sessions,
  activeId,
  transport,
}: {
  sessions: TerminalSession[];
  /** A session id, or "" when the worktree tab is the active one. */
  activeId: string;
  transport: TerminalTransport;
}) {
  return (
    <div className="terminal__deck">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="terminal__slot"
          data-active={session.id === activeId || undefined}
        >
          <XTermView id={session.id} transport={transport} />
        </div>
      ))}
    </div>
  );
}
