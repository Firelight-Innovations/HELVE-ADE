/**
 * A question the app must put to the user before something irreversible
 * happens, or a report it must make about something that already did.
 *
 * This is the app's one dialog, and it is a bar rather than a modal. That was
 * decided before delete existed and the reasoning still holds: **nothing here
 * uses `window.confirm`.** A native modal blocks the webview's event loop, and
 * this app runs in an iframe driven over a bridge — a blocked loop is a frozen
 * frame that cannot answer the host. A bar that waits is strictly better than a
 * dialog that stops the world.
 *
 * It moved up here from `tabs/` when the tree needed to ask a question too: a
 * file deleted from the explorer may not be open, so there is no tab to hang
 * the question on. Same component, same look, two callers.
 *
 * ## The rules that make it safe to put a delete behind
 *
 * - **The first action is the safe one**, and it is the one that takes focus.
 *   So Return, pressed by someone who did not read the bar, cancels.
 * - **Destructive actions are marked and drawn in `--err`**, and they are never
 *   first. Nothing can arrive at the destructive button by default.
 * - **Escape dismisses**, which is always the same thing as choosing the safe
 *   action — a question the user backs out of has to leave the world alone.
 */
import { useEffect, useRef } from "react";
import "./notice.css";

/** One button in a `Notice`. */
export interface NoticeAction {
  label: string;
  /** Drawn in `--err` and never focused first. Delete sets this. */
  danger?: boolean;
  run(): void;
}

export interface Notice {
  tone: "warn" | "err";
  message: string;
  /**
   * Left-most first, and the left-most must be the one that loses nothing.
   * `NoticeBar` focuses it and Escape chooses it, so this ordering is load
   * bearing rather than cosmetic.
   */
  actions: NoticeAction[];
}

export default function NoticeBar({
  notice,
  onEscape,
}: {
  notice: Notice;
  /**
   * What Escape means. Usually the same callback as the first action's.
   * Omitted for a bar that is a report rather than a question — there is
   * nothing to back out of.
   */
  onEscape?: () => void;
}) {
  const safeRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The safe action takes focus, so a Return pressed reflexively cancels rather
   * than confirming. This is the whole reason a delete can live behind a bar.
   *
   * Only for a bar that is a *question* — one the user just triggered, marked
   * by `onEscape` having something to do. A bar that is a report appears on its
   * own schedule: the "changed on disk" notice arrives from a background poll,
   * and taking the caret out of the editor mid-sentence because a file's mtime
   * moved would be the app interrupting rather than informing.
   *
   * Keyed on the message rather than the notice object, which callers rebuild
   * on every render — depending on the object would drag focus back to Cancel
   * every time anything re-rendered, including out from under someone who had
   * deliberately tabbed to the other button.
   */
  useEffect(() => {
    if (!onEscape) return;
    safeRef.current?.focus({ preventScroll: true });
  }, [notice.message, onEscape]);

  useEffect(() => {
    if (!onEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    // On the window rather than the bar: the user may still be looking at the
    // tree or the editor when they decide to back out, and Escape has to work
    // from wherever the keyboard happens to be.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onEscape]);

  return (
    <div className={`notice notice--${notice.tone}`} role="alert">
      <span className="notice__text">{notice.message}</span>
      {notice.actions.map((action, index) => (
        <button
          key={action.label}
          type="button"
          ref={index === 0 ? safeRef : undefined}
          className={`notice__action${action.danger ? " notice__action--danger" : ""}`}
          onClick={action.run}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
