/**
 * Minimise, maximise, close.
 *
 * The Tauri calls themselves live in `bindings.ts` now (STANDARDS.md §1.1 —
 * one door). `isTauri` is what's guarded here, right before every command —
 * it lives in `../hostWindow`, which is where the menu bar's window commands
 * are too, one definition of "is there a real window here", not two that
 * could drift.
 */
import { closeHostWindow, minimizeHostWindow, toggleHostMaximize } from "../../bindings";
import { isTauri } from "../hostWindow";
import { WindowClose, WindowMaximise, WindowMinimise } from "../../ui/Icon";

function run(fn: () => Promise<unknown>) {
  return () => {
    if (!isTauri()) return;
    void fn();
  };
}

export default function WindowControls() {
  return (
    <div className="titlebar__controls">
      <button
        type="button"
        className="titlebar__control"
        aria-label="Minimise"
        onClick={run(minimizeHostWindow)}
      >
        <WindowMinimise />
      </button>
      <button
        type="button"
        className="titlebar__control"
        aria-label="Maximise"
        onClick={run(toggleHostMaximize)}
      >
        <WindowMaximise />
      </button>
      <button
        type="button"
        className="titlebar__control titlebar__control--close"
        aria-label="Close"
        onClick={run(closeHostWindow)}
      >
        <WindowClose />
      </button>
    </div>
  );
}
