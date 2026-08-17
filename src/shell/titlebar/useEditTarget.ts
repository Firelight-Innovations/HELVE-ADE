/**
 * What the Edit menu would act on — which is *not* always the app.
 *
 * Undo, Cut, Find and the rest belong to whatever has focus: usually Monaco in
 * the Files iframe, but just as easily the switcher bar's search field, or
 * nothing. An Edit menu that always fired into the iframe would cut text out of
 * a file the user was not typing in — worse than one that does nothing.
 *
 * Focus is *remembered*, not read: by the time an item is clicked, focus is on
 * the menu's own button, so `document.activeElement` answers a question nobody
 * asked. This tracks `focusin` and ignores anything inside the title bar, which
 * leaves exactly "where focus was before the menu opened".
 */
import { useEffect, useState } from "react";
import type { CommandHandlers } from "./menus";
import { APP_COMMAND } from "./menus";

/**
 * Where focus was, in the only three shapes the Edit menu routes on: `app`, a
 * mounted app frame (see the iframe note in `onFocusIn`); `field`, a shell
 * `<input>`, `<textarea>` or contenteditable, of which `SearchSlot`'s is the one
 * that exists today; and `none` — a button, the document body, anything with no
 * editing surface behind it, where every Edit item disables.
 */
export type EditTarget =
  { kind: "app" } | { kind: "field"; element: HTMLElement } | { kind: "none" };

/**
 * Where the Edit menu would land, as state — not a ref, because **opening a
 * menu does not re-render `WindowRoot`**: `MenuBar` owns `openLabel`, so a
 * click on "Edit" re-renders `MenuBar` alone, and the `menus` array it renders
 * was built on whatever render happened last. A ref would be read at the wrong
 * moment every time, and the Edit menu would reflect focus from renders ago.
 *
 * The cost is a render when focus moves between kinds of target, bounded by the
 * `same` guard: moving between two buttons, or around inside the editor, is not
 * a change and does not set state. It is clicking from the tree into a field,
 * and back, that does — a gesture per second at worst, not per keystroke.
 */
export function useEditTarget(): EditTarget {
  const [target, setTarget] = useState<EditTarget>({ kind: "none" });

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement)) return;

      // The menu bar taking focus is not a change of subject — it is the user
      // reaching for the menu that is about to act on whatever they left. This
      // is the whole reason focus is *remembered* rather than read at the click.
      if (element.closest(".titlebar")) return;

      const next: EditTarget =
        // When focus is inside an iframe, this document's `activeElement` is
        // the <iframe> element. Which frame is not worked out: only the active
        // tool's is visible, and a `visibility: hidden` element cannot take
        // focus, so there is only ever one candidate.
        element instanceof HTMLIFrameElement
          ? { kind: "app" }
          : isTextEntry(element)
            ? { kind: "field", element }
            : { kind: "none" };

      setTarget((was) => (same(was, next) ? was : next));
    };

    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  return target;
}

/** Two readings that would produce the same Edit menu and act the same way. */
function same(a: EditTarget, b: EditTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "field" && b.kind === "field") return a.element === b.element;
  return true;
}

/** True for `<input>`, `<textarea>`, and anything `contenteditable`. */
function isTextEntry(element: HTMLElement): boolean {
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
}

/**
 * The Edit menu's seven items, routed by where focus was. Each of the three
 * branches below carries the note for its own case.
 */
export function editHandlers(target: EditTarget, app: CommandHandlers): CommandHandlers {
  /** Which `execCommand` a command id maps to in a plain field, if any. */
  const NATIVE: Record<string, string> = {
    [APP_COMMAND.undo]: "undo",
    [APP_COMMAND.redo]: "redo",
    [APP_COMMAND.cut]: "cut",
    [APP_COMMAND.copy]: "copy",
  };

  /**
   * **Paste is disabled on both branches**, and that is a decision rather than a
   * consequence: no Chromium engine will run `execCommand("paste")`, and the
   * `clipboard-read` replacement could not be verified here. The full account,
   * including what Ctrl+V still does and why clipboard *write* is unaffected, is
   * in `docs/design-notes/shell-chrome.md`.
   */
  const PASTE_HINT =
    "Paste from a menu is blocked by the webview's clipboard permissions. Ctrl+V works — it is the browser's own paste and does not go through the menu.";

  // Straight through to `app`, which posts a menu command to the active frame
  // and disables anything the frame has not declared. Nothing here knows that
  // the app is Files or that the editor is Monaco.
  if (target.kind === "app") {
    return {
      run: (command) => app.run(command),
      blocked: (command) => (command === APP_COMMAND.paste ? PASTE_HINT : app.blocked(command)),
    };
  }

  // A shell `<input>` has no such channel — it is a DOM node in this document,
  // so the editing operations are the browser's own. `document.execCommand` is
  // deprecated and is still the only way to ask for them synchronously; there
  // is no replacement API for "undo this input".
  if (target.kind === "field") {
    const { element } = target;
    return {
      run: (command) => {
        const native = NATIVE[command];
        if (!native) return;
        // Focus the field first: `execCommand` acts on wherever the selection
        // is, and by this point that is the menu button, so without the refocus
        // Cut on a search field would cut nothing at all. An `<input>` remembers
        // its own selection across a blur, so this puts the caret and the
        // selection back exactly where the user left them.
        element.focus();
        document.execCommand(native);
      },
      blocked: (command) => {
        if (command === APP_COMMAND.paste) return PASTE_HINT;
        if (NATIVE[command]) return undefined;
        // Find and Replace are app-only: they are an editor's widgets, and a
        // one-line `<input>` has nothing for them to open onto.
        return "Find and Replace belong to an editor. Click into a file first.";
      },
    };
  }

  return {
    run: () => {},
    blocked: () => "Nothing has focus that this could act on. Click into a file or a field first.",
  };
}
