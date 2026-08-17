/**
 * A question the app must put to the user before something irreversible
 * happens, or a report it must make about something that already did.
 *
 * This is the app's one dialog, and a bar rather than a modal. Decided before
 * delete existed and the reasoning still holds: **nothing here uses
 * `window.confirm`.** A native modal blocks the webview's event loop, and this
 * app runs in an iframe driven over a bridge — a blocked loop is a frozen frame
 * that cannot answer the host. A bar that waits beats a dialog that stops the
 * world.
 *
 * It moved up here from `tabs/` when the tree needed to ask a question too: a
 * file deleted from the explorer may not be open, so there is no tab to hang it
 * on. Same component, same look, two callers. The three rules that make it safe
 * to put a delete behind are documented where each is enforced —
 * `Notice.actions`, `NoticeAction.danger`, `onEscape`.
 */
import { useEffect, useRef } from "react";
import "./notice.css";

/** One button in a `Notice`. */
export interface NoticeAction {
  label: string;
  /** Drawn in `--err` and never focused first, so nothing can arrive at the
   *  destructive button by default. Delete sets this. */
  danger?: boolean;
  run(): void;
}

export interface Notice {
  tone: "warn" | "err";
  message: string;
  /**
   * Left-most first, and the left-most must be the one that loses nothing.
   * `NoticeBar` focuses it and Escape chooses it, so this ordering is load
   * bearing rather than cosmetic: Return, pressed by someone who did not read
   * the bar, cancels.
   */
  actions: NoticeAction[];
}

export default function NoticeBar({
  notice,
  onEscape,
}: {
  notice: Notice;
  /**
   * What Escape means, which is always the same thing as choosing the safe
   * action — a question the user backs out of has to leave the world alone. So
   * usually the same callback as the first action's. Omitted for a bar that is
   * a report rather than a question: there is nothing to back out of.
   */
  onEscape?: () => void;
}) {
  const safeRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The safe action takes focus, so a Return pressed reflexively cancels rather
   * than confirming. This is the whole reason a delete can live behind a bar.
   *
   * Only for a bar that is a *question*, marked by `onEscape` having something
   * to do. A report appears on its own schedule — the "changed on disk" notice
   * comes from a background poll, and pulling the caret out of the editor
   * mid-sentence because a file's mtime moved would interrupt rather than
   * inform.
   *
   * Keyed on the message rather than the notice object, which callers rebuild
   * every render — depending on the object would drag focus back to Cancel on
   * every re-render, out from under someone who had tabbed to the other button.
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
    // tree or the editor, and Escape has to work from wherever the keyboard is.
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
