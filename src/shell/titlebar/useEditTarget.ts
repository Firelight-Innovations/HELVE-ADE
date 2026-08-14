/**
 * What the Edit menu would act on — which is *not* always the app.
 *
 * Undo, Cut, Find and the rest belong to whatever has focus. Usually that is
 * the Monaco editor inside the Files iframe, but it can just as easily be the
 * search field in the switcher bar, or nothing at all. An Edit menu that always
 * fired into the iframe would cut text out of a file the user was not typing
 * in, which is worse than an Edit menu that does nothing.
 *
 * ## Why focus has to be *remembered* rather than read
 *
 * By the time a menu item is clicked, focus is on the menu's own button —
 * opening the menu took it. So `document.activeElement` at that moment answers
 * a question nobody asked. This tracks `focusin` instead and ignores anything
 * inside the title bar, which leaves exactly "where focus was before the menu
 * opened".
 *
 * ## The three answers
 *
 * - **`app`** — focus is in a mounted app frame. When focus is inside an
 *   iframe, the host document's `activeElement` is the `<iframe>` element
 *   itself, which is what this recognises. It does not work out *which* frame:
 *   only the active tool's is visible, and a `visibility: hidden` element
 *   cannot take focus, so there is only ever one candidate.
 * - **`field`** — focus is in a shell `<input>`, `<textarea>` or
 *   contenteditable. The `SearchSlot` field is the one that exists today.
 * - **`none`** — focus is on a button, the document body, or somewhere else
 *   with no editing surface behind it. Every Edit item disables.
 */
import { useEffect, useState } from "react";
import type { CommandHandlers } from "./TitleBar";
import { APP_COMMAND } from "./TitleBar";

export type EditTarget =
  | { kind: "app" }
  | { kind: "field"; element: HTMLElement }
  | { kind: "none" };

/**
 * Where the Edit menu would land, as state.
 *
 * State and not a ref, and the reason is worth stating because a ref looks like
 * the cheaper answer: **opening a menu does not re-render `WindowRoot`.**
 * `MenuBar` owns `openLabel`, so a click on "Edit" re-renders `MenuBar` alone —
 * and the `menus` array it renders was built on whatever render happened last.
 * A ref would therefore be read at the wrong moment every time, and the Edit
 * menu would reflect where focus was some renders ago.
 *
 * The cost is a render of the window when focus moves between kinds of target.
 * That is bounded by the guard below: moving between two buttons, or around
 * inside the editor, is not a change and does not set state. It is clicking
 * from the tree into a field, and back, that does — a gesture per second at
 * worst, not per keystroke.
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
 * The Edit menu's seven items, routed by where focus was.
 *
 * ## The app branch
 *
 * Straight through to `app`, which posts a menu command to the active frame and
 * disables anything the frame has not declared. Nothing here knows that the app
 * is Files or that the editor is Monaco.
 *
 * ## The field branch, and `execCommand`
 *
 * A shell `<input>` has no such channel — it is a DOM node in this document, so
 * the editing operations are the browser's own. `document.execCommand` is
 * deprecated and is still the only way to ask for them synchronously; there is
 * no replacement API for "undo this input".
 *
 * The field is focused first. `execCommand` acts on wherever the selection is,
 * and by this point that is the menu button — so without the refocus, Cut on a
 * search field would cut nothing at all. An `<input>` remembers its own
 * selection across a blur, so focusing it puts the caret and the selection back
 * exactly where the user left them.
 *
 * **Paste is disabled on both branches**, and this is the one item where that
 * is a decision rather than a consequence:
 *
 * - `document.execCommand("paste")` has been refused in web content by every
 *   Chromium-based engine for years — it resolves `false` and does nothing.
 *   WebView2 is Chromium. So the field branch has no mechanism at all.
 * - `navigator.clipboard.readText()` is the replacement, and it is gated on the
 *   `clipboard-read` permission. What a Tauri v2 WebView2 window does with that
 *   request is not something this work could establish without running the app,
 *   and browser verification is unavailable in this environment.
 *
 * The handoff's own instruction for exactly this case is to disable it and say
 * why rather than ship a Paste that silently does nothing — so it is disabled,
 * and the hint names Ctrl+V, which works, because it is the *browser's* paste
 * and never goes through this code at all. Clipboard **write** is not affected:
 * Cut and Copy go through `navigator.clipboard.writeText` on the app side,
 * which this repo already relies on in the Files context menu's "Copy path".
 *
 * ## Find and Replace
 *
 * App-only. They are an editor's widgets, and a one-line `<input>` has nothing
 * for them to open onto.
 */
export function editHandlers(target: EditTarget, app: CommandHandlers): CommandHandlers {
  /** Which `execCommand` a command id maps to in a plain field, if any. */
  const NATIVE: Record<string, string> = {
    [APP_COMMAND.undo]: "undo",
    [APP_COMMAND.redo]: "redo",
    [APP_COMMAND.cut]: "cut",
    [APP_COMMAND.copy]: "copy",
  };

  const PASTE_HINT =
    "Paste from a menu is blocked by the webview's clipboard permissions. Ctrl+V works — it is the browser's own paste and does not go through the menu.";

  if (target.kind === "app") {
    return {
      run: (command) => app.run(command),
      blocked: (command) => (command === APP_COMMAND.paste ? PASTE_HINT : app.blocked(command)),
    };
  }

  if (target.kind === "field") {
    const { element } = target;
    return {
      run: (command) => {
        const native = NATIVE[command];
        if (!native) return;
        element.focus();
        document.execCommand(native);
      },
      blocked: (command) => {
        if (command === APP_COMMAND.paste) return PASTE_HINT;
        if (NATIVE[command]) return undefined;
        return "Find and Replace belong to an editor. Click into a file first.";
      },
    };
  }

  return {
    run: () => {},
    blocked: () => "Nothing has focus that this could act on. Click into a file or a field first.",
  };
}
