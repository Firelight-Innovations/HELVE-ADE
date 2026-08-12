/**
 * The shell's global keyboard shortcuts — everything except ⌘K and Escape,
 * which `SearchSlot` already owns (its own `keydown` listener opens on ⌘K
 * and its field's `onKeyDown` closes on Escape). Binding either of those
 * here too would give the shell two handlers racing for the same key, with
 * the outcome depending on listener order — so this hook deliberately
 * leaves them alone. Confirmed by reading `src/shell/search/SearchSlot.tsx`
 * before writing anything below.
 *
 * Bindings, straight from `docs/handoffs/shell-spec.html` — the only four
 * accelerators the spec states anywhere (search the file for `⌘`):
 *
 *   ⌘1…⌘9   "Open Forger" chip on the empty tool window → select the
 *            nth tool in this window's switcher bar.
 *   ⌘R       "Re-scan tools" chip, same empty state → re-scan.
 *   ⌘.       "cancel ⌘." under the booting-tool spinner → cancel the
 *            tool that's currently booting.
 *
 * Nothing here resolves *which* tool is at a given index, or what "the
 * booting tool" is — that's `WindowRoot`'s job, passed in as callbacks.
 */
import { useEffect, useRef } from "react";

export interface KeyboardActions {
  /** ⌘1…⌘9 — select the nth tool in this window's bar. */
  selectToolByIndex(index: number): void;
  /** ⌘R — re-scan tools. */
  rescan(): void;
  /** ⌘. — cancel the tool that is currently booting. */
  cancelBoot(): void;
}

/** True for `<input>`, `<textarea>`, and anything `contenteditable`. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function useKeyboard(actions: KeyboardActions): void {
  // The listener below is installed exactly once (empty deps). If it closed
  // over `actions` directly, every render that passed a new actions object
  // (a new inline `{ selectToolByIndex, rescan, cancelBoot }` from
  // `WindowRoot`, as is typical) would force the effect to tear down and
  // re-add the `document` listener. A ref sidesteps that: the effect that
  // keeps it current is cheap and runs every render, but the `keydown`
  // listener itself never moves, so there's no window where a keystroke can
  // land between a remove and an add.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Never steal a key while the user is typing — the search field in
      // particular is a real <input>, and "r" typed into it must stay "r".
      if (isTextEntryTarget(e.target)) return;

      // One predicate for both platforms rather than sniffing navigator.
      // platform: the shell already treats "the primary modifier key" as
      // metaKey on macOS and ctrlKey elsewhere everywhere else it binds a
      // shortcut (see SearchSlot's own ⌘K handler), so this matches that
      // convention instead of introducing a second way to test for it.
      const primary = e.metaKey || e.ctrlKey;
      if (!primary) return;

      if (e.key >= "1" && e.key <= "9") {
        // preventDefault: Ctrl/Cmd+1…9 is bound by every major browser to
        // jump to a tab by position. The shell only runs inside a Tauri
        // webview in production, but in dev it's also reachable in an
        // ordinary browser tab (see the project's own warning against
        // `pnpm app` orphaning Vite on :1420) — so without this, the same
        // keystroke that should switch tools would instead switch the
        // browser's tab.
        e.preventDefault();
        actionsRef.current.selectToolByIndex(Number(e.key) - 1);
        return;
      }

      if (e.key.toLowerCase() === "r") {
        // preventDefault: required — Ctrl/Cmd+R reloads the page, which
        // would restart the whole shell out from under itself.
        e.preventDefault();
        actionsRef.current.rescan();
        return;
      }

      if (e.key === ".") {
        // preventDefault: no browser binds Ctrl/Cmd+. to anything, but the
        // shell is consuming the keystroke as a real command, so it's
        // prevented for the same reason the other two are — consistent
        // with "once matched, the shell owns it," not because anything
        // else is competing for it.
        e.preventDefault();
        actionsRef.current.cancelBoot();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
