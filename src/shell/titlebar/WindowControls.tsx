/**
 * Minimise, maximise, close.
 *
 * `@tauri-apps/api/window` is safe to import in a plain browser — nothing at
 * module scope talks to the runtime. It is only *calling* `getCurrentWindow()`
 * or its methods that requires the Tauri internals to exist, so that's what's
 * guarded, right before every command. `isTauri` itself lives in
 * `../hostWindow`, which is where the menu bar's window commands are too — one
 * definition of "is there a real window here", not two that could drift.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../hostWindow";
import { WindowClose, WindowMaximise, WindowMinimise } from "../../ui/Icon";

function run(fn: (win: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) {
  return () => {
    if (!isTauri()) return;
    void fn(getCurrentWindow());
  };
}

export default function WindowControls() {
  return (
    <div className="titlebar__controls">
      <button
        type="button"
        className="titlebar__control"
        aria-label="Minimise"
        onClick={run((w) => w.minimize())}
      >
        <WindowMinimise />
      </button>
      <button
        type="button"
        className="titlebar__control"
        aria-label="Maximise"
        onClick={run((w) => w.toggleMaximize())}
      >
        <WindowMaximise />
      </button>
      <button
        type="button"
        className="titlebar__control titlebar__control--close"
        aria-label="Close"
        onClick={run((w) => w.close())}
      >
        <WindowClose />
      </button>
    </div>
  );
}
