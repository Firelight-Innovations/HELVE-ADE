/**
 * The shell's global keyboard shortcuts — everything except Ctrl+K and Escape,
 * which `SearchSlot` already owns (its own `keydown` listener opens on Ctrl+K
 * and its field's `onKeyDown` closes on Escape). Binding either of those
 * here too would give the shell two handlers racing for the same key, with
 * the outcome depending on listener order — so this hook deliberately
 * leaves them alone. Confirmed by reading `src/shell/search/SearchSlot.tsx`
 * before writing anything below.
 *
 * The first three bindings come from `docs/handoffs/shell-spec.html` — the only
 * accelerators that document states anywhere (search the file for `⌘`):
 *
 *   Ctrl+1…9  "Open Forger" chip on the empty tool window → select the
 *             nth tool in this window's switcher bar.
 *   Ctrl+R    "Re-scan tools" chip, same empty state → re-scan.
 *   Ctrl+.    "cancel ⌘." under the booting-tool spinner → cancel the
 *             tool that's currently booting.
 *
 * **Everything after them is here because the menu bar displays it.** The rule
 * in `titlebar/TitleBar.tsx` is bind it or drop it — an accelerator drawn beside
 * a menu item is a promise the keystroke does that thing — so every File,
 * View and Terminal accelerator on display has a case below.
 *
 * The Edit menu's do not, and that is the same rule rather than an exception to
 * it. Ctrl+Z, Ctrl+X, Ctrl+F and the rest are already bound by the surface that
 * has focus: Monaco inside the Files iframe, the browser inside a shell
 * `<input>`. A key event inside a cross-document iframe never reaches this
 * listener, so a binding here could only ever fire when focus was *outside* the
 * editor — and where it did fire it would be a second handler racing the
 * browser's own for a key that already works. That is exactly the collision
 * this header opens by describing.
 *
 * Nothing here resolves *which* tool is at a given index, what "the booting
 * tool" is, or whether Save is even possible right now — that is `WindowRoot`'s
 * job, passed in as callbacks. An action that cannot run is a callback that
 * does nothing, decided by the same `blocked()` that greys the menu item out,
 * so a keystroke and a click can never disagree.
 */
import { useEffect, useRef } from "react";

export interface KeyboardActions {
  /** Ctrl+1…Ctrl+9 — select the nth tool in this window's bar. */
  selectToolByIndex(index: number): void;
  /** Ctrl+R — re-scan tools. */
  rescan(): void;
  /** Ctrl+. — cancel the tool that is currently booting. */
  cancelBoot(): void;

  // --- File -----------------------------------------------------------------
  /** Ctrl+N */
  newFile(): void;
  /** Ctrl+O */
  openProject(): void;
  /** Ctrl+S */
  save(): void;
  /** Ctrl+Shift+S */
  saveAs(): void;
  /** Ctrl+D */
  duplicate(): void;
  /** Ctrl+Shift+W */
  closeWindow(): void;

  // --- View -----------------------------------------------------------------
  /** Ctrl+Shift+P */
  commandPalette(): void;
  /** Ctrl+B */
  togglePanel(): void;
  /** Ctrl+` */
  toggleTerminal(): void;
  /** F11 */
  toggleFullscreen(): void;
  /** Ctrl+= and Ctrl++ — both, because the two are the same physical key. */
  zoomIn(): void;
  /** Ctrl+- */
  zoomOut(): void;

  // --- Terminal -------------------------------------------------------------
  /** Ctrl+Shift+` */
  newTerminal(): void;
  /** Ctrl+\ */
  splitTerminal(): void;
}

/**
 * The menu-bar accelerators, in one table. `true` when the key was ours.
 *
 * Split out of the listener because it is a lookup rather than a decision:
 * every row is "this keystroke, that action", and the listener above still owns
 * the two things that *are* decisions — whether a field has focus, and which
 * bindings that suppresses.
 *
 * `preventDefault` on all of them, unconditionally, for the reason the ⌘1…9
 * case below already gives: the shell reaches an ordinary browser tab in
 * development, and several of these are bound there (Ctrl+N opens a window,
 * Ctrl+O a file picker, Ctrl+S saves the page, Ctrl+D bookmarks it, Ctrl+- and
 * Ctrl+= zoom the *browser*). Once a keystroke is matched, the shell owns it.
 *
 * `e.code` for the backquote pair rather than `e.key`, because `key` is what
 * the layout produces and a non-US keyboard does not put a backtick there.
 * `Backquote` is the physical key, which is what "the key under Escape" means
 * to everyone who reaches for it.
 */
function matched(e: KeyboardEvent, a: KeyboardActions): boolean {
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();

  const fire = (run: () => void) => {
    e.preventDefault();
    run();
    return true;
  };

  if (e.code === "Backquote") return fire(shift ? a.newTerminal : a.toggleTerminal);

  switch (key) {
    case "n":
      // Shift+Ctrl+N is New Window, which this build cannot do — see the
      // item's own note in `TitleBar.tsx`. Unbound rather than bound to
      // nothing, so the browser's "new incognito window" is at least honest
      // about being the browser's.
      return shift ? false : fire(a.newFile);
    case "o":
      return shift ? false : fire(a.openProject);
    case "s":
      return fire(shift ? a.saveAs : a.save);
    case "d":
      return shift ? false : fire(a.duplicate);
    case "w":
      // Only with Shift. Plain Ctrl+W closes a *tab* everywhere it is bound,
      // and this window is not one — binding it to "close the window" would be
      // the most destructive possible reading of a very common keystroke.
      return shift ? fire(a.closeWindow) : false;
    case "p":
      return shift ? fire(a.commandPalette) : false;
    case "b":
      return shift ? false : fire(a.togglePanel);
    case "\\":
      return shift ? false : fire(a.splitTerminal);
    // The same physical key on a US layout, and which one arrives depends on
    // Shift and on the layout. Both mean zoom in; nobody reaching for it is
    // thinking about which.
    case "=":
    case "+":
      return fire(a.zoomIn);
    case "-":
    case "_":
      return fire(a.zoomOut);
    default:
      return false;
  }
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
      const a = actionsRef.current;

      // F11 first: the one binding with no modifier, and the one Windows
      // convention strong enough that it is worth taking even from a field —
      // nothing anyone types into an <input> is F11.
      if (e.key === "F11" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        a.toggleFullscreen();
        return;
      }

      // One predicate for both platforms rather than sniffing navigator.
      // platform: the shell already treats "the primary modifier key" as
      // metaKey on macOS and ctrlKey elsewhere everywhere else it binds a
      // shortcut (see SearchSlot's own ⌘K handler), so this matches that
      // convention instead of introducing a second way to test for it.
      const primary = e.metaKey || e.ctrlKey;
      if (!primary) return;

      // The menu-bar accelerators, before the text-entry guard below.
      //
      // The guard is there so a bare-ish keystroke does not get stolen out of
      // the search field, and every binding in this block is a command the user
      // could not possibly have meant as typing: Ctrl+S in a search box is
      // still Save. Ctrl+1…9, Ctrl+R and Ctrl+. stay behind the guard, because
      // those three are chips on an empty tool window and firing them from
      // inside a field the user is filling in would be a surprise.
      if (matched(e, a)) return;

      // Never steal a key while the user is typing — the search field in
      // particular is a real <input>, and "r" typed into it must stay "r".
      if (isTextEntryTarget(e.target)) return;

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
