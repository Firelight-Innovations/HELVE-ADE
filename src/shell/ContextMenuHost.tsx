/**
 * The shell's right-click menu: one listener on the document, one menu, mounted
 * once per window.
 *
 * WebView2's own menu is off — `src-tauri/src/webview.rs` turns it off for
 * every window this process opens — so a right-click that nothing answers now
 * shows nothing at all. This is what answers it.
 *
 * **A surface that wants its own says so with `preventDefault`.** That is the
 * web's existing signal for "this right-click is handled", it is already what
 * the Files and Viewer apps do inside their own documents, and it needs no
 * registry here of which regions have opinions. This host reads
 * `defaultPrevented` and stands down; anything nearer to the target has already
 * run by then, because the listener is on `document` in the bubble phase.
 *
 * It still calls `preventDefault` itself when it opens. On Windows that is
 * redundant with the setting above, and it is the whole behaviour on a build
 * where that setting could not be applied — see the note on the non-Windows
 * half of `webview.rs`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import MenuItemList, { inMenuSurface } from "./MenuItemList";
import { popover } from "./motion";
import type { MenuItem } from "./contract";
import {
  contextItems,
  dismisses,
  placeMenu,
  type ContextSubject,
  type Dismissal,
  type Point,
} from "./contextMenu";
import "./contextMenu.css";

/**
 * A right-click that has been read but not yet drawn.
 *
 * The selection is captured *here*, at the moment of the click, rather than
 * read again when an item is chosen: opening the menu moves focus onto it, and
 * in Chromium a pointer down outside a document selection collapses that
 * selection. By the time Copy is pressed there is frequently nothing left to
 * copy, and reading late is how a Copy that looked live comes back empty.
 */
interface Opened {
  at: Point;
  subject: ContextSubject;
  /** The field the click landed in, and where its selection was. */
  field: FieldSelection | null;
  /** The selected text, for a selection that is not inside a field. */
  selectedText: string;
}

interface FieldSelection {
  element: HTMLElement;
  /** Both `null` for a `contenteditable`, which has no index pair to remember. */
  start: number | null;
  end: number | null;
}

/** The two elements that carry a selection as a pair of indices. */
type IndexedField = HTMLInputElement | HTMLTextAreaElement;

function indexed(element: HTMLElement): IndexedField | null {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element
    : null;
}

export default function ContextMenuHost({
  extend,
}: {
  /**
   * What this surface adds above the four edit items. Called with the same
   * subject the items are built from, so a caller can offer different rows over
   * a field than over a selection, and returning `[]` means "nothing to add".
   *
   * Nothing supplies one today. It is here because the alternative — a second
   * context-menu component the first time a region wants one row of its own —
   * is how the shell would end up with a menu per surface, which is the shape
   * this deliberately does not have.
   */
  extend?: (subject: ContextSubject) => MenuItem[];
}) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [at, setAt] = useState<Point>({ x: 0, y: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpened(null), []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      // Somebody closer has drawn their own menu, or deliberately suppressed
      // one. Either way this one stands down — and gets out of the way, unless
      // the click was on its own surface, which is the one place a suppressed
      // right-click is not a request to go elsewhere.
      if (event.defaultPrevented) {
        if (!surfaceRef.current?.contains(event.target as Node)) close();
        return;
      }
      event.preventDefault();

      const read = readTarget(event.target);
      setOpened({ at: { x: event.clientX, y: event.clientY }, ...read });
      setAt({ x: event.clientX, y: event.clientY });
    };

    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [close]);

  // Everything that closes it, asked as one question. `scroll` is captured
  // because it does not bubble, and a menu anchored to a viewport point is
  // wrong the moment the surface under it moves.
  useEffect(() => {
    if (opened === null) return;

    const on = (event: Dismissal) => {
      if (dismisses(event)) close();
    };
    const onPointerDown = (e: PointerEvent) => {
      // A right button is not a dismissal. The `contextmenu` that follows it
      // decides — it either moves this menu to the new point or stands down for
      // whoever handled it — and closing here first would unmount the surface
      // and remount it a millisecond later, animation and all.
      if (e.button === 2) return;
      const inside =
        surfaceRef.current?.contains(e.target as Node) === true || inMenuSurface(e.target);
      on({ reason: "pointer", insideMenu: inside });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") on({ reason: "escape" });
    };
    const onScroll = () => on({ reason: "scroll" });
    const onResize = () => on({ reason: "resize" });
    const onBlur = () => on({ reason: "blur" });

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    };
  }, [opened, close]);

  // Placed after layout, so the corrected position is in the first painted
  // frame rather than one frame later. It cannot be worked out before the
  // surface exists: the width depends on the longest label a caller
  // contributed, and the height on how many rows there are.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (opened === null || !surface) return;

    const rect = surface.getBoundingClientRect();
    setAt(
      placeMenu(
        opened.at,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );

    // Focused here rather than with `autoFocus`, which React only honours on
    // form controls — this is a `div`. The container rather than the first row,
    // because which row is first depends on what the caller contributed and on
    // which of the four are live. `preventScroll` because the surface is fixed
    // at the pointer and has nothing to scroll into view.
    surface.focus({ preventScroll: true });
  }, [opened]);

  // The wrapper is always rendered so `AnimatePresence` can watch the menu
  // leave; an empty one draws no DOM. The same shape `WindowRoot` uses for the
  // search overlay, and for the same reason.
  return createPortal(
    <AnimatePresence>
      {opened !== null && (
        <motion.div
          ref={surfaceRef}
          className="context-menu"
          role="menu"
          tabIndex={-1}
          style={{ top: at.y, left: at.x }}
          variants={popover}
          initial="initial"
          animate="animate"
          exit="exit"
          // A right-click *on* the menu should do nothing rather than reopen it
          // one row further in.
          onContextMenu={(event) => event.preventDefault()}
        >
          <MenuItemList
            items={contextItems(opened.subject, actionsFor(opened), extend?.(opened.subject) ?? [])}
            onAfterSelect={close}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** What the live items do, bound to the click that opened the menu. */
function actionsFor(opened: Opened) {
  const { field, selectedText } = opened;

  /**
   * Put the caret back before acting.
   *
   * `execCommand` acts on wherever the selection is, and by the time an item is
   * clicked that is the menu. The same refocus `useEditTarget` does for the
   * Edit menu, and for the same reason — with the range restored explicitly,
   * because unlike the Edit menu this menu can be opened over a field that
   * never had focus in the first place.
   */
  const restore = () => {
    if (!field) return false;
    field.element.focus();

    const input = indexed(field.element);
    if (input && field.start !== null && field.end !== null) {
      // Guarded for `rangeIn`'s reason: an `<input type="email">` refuses a
      // range as flatly as it refuses to report one.
      try {
        input.setSelectionRange(field.start, field.end);
      } catch {
        // Nothing to restore, and the item that asked was disabled anyway.
      }
    }
    return true;
  };

  return {
    cut: () => {
      if (restore()) document.execCommand("cut");
    },
    // Clipboard *write* is not affected by the permission that blocks Paste,
    // and the captured text is what makes this independent of where focus went.
    copy: () => {
      void navigator.clipboard.writeText(selectedText);
    },
    selectAll: () => {
      if (!field) return;
      field.element.focus();
      const input = indexed(field.element);
      if (input) input.select();
      // A `contenteditable` has no `select()` of its own, and `selectAll` after
      // the focus above is scoped to it rather than to the document.
      else document.execCommand("selectAll");
    },
  };
}

/**
 * Anything that takes typing. The three `contenteditable` spellings are listed
 * because the attribute is true for all of them and `[contenteditable]` alone
 * would also match `contenteditable="false"`, which is how a subtree opts *out*.
 */
const EDITABLE =
  "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

/**
 * The click, reduced to a subject and the selection as it stood.
 *
 * `closest` rather than the target itself: a right-click inside a `<textarea>`
 * lands on the textarea, but one inside a `contenteditable` lands on whatever
 * span the caret happens to be in.
 */
function readTarget(target: EventTarget | null): Omit<Opened, "at"> {
  const element = target instanceof Element ? target : null;
  const field = element?.closest<HTMLElement>(EDITABLE) ?? null;

  if (field === null) {
    const text = window.getSelection()?.toString() ?? "";
    return {
      subject: { editable: false, writable: false, hasSelection: text !== "" },
      field: null,
      selectedText: text,
    };
  }

  const range = rangeIn(field);
  const selectedText = textIn(field, range);

  return {
    subject: {
      editable: true,
      writable: !isReadOnly(field),
      hasSelection: selectedText !== "",
    },
    field: { element: field, ...range },
    selectedText,
  };
}

/**
 * Where the selection is inside a field.
 *
 * `selectionStart` **throws** on an `<input>` whose type does not support one —
 * `email`, `number` and the rest — so this is guarded rather than trusted. A
 * throw here would be a throw inside the `contextmenu` handler, which would
 * lose the menu entirely rather than one item on it.
 */
function rangeIn(field: HTMLElement): { start: number | null; end: number | null } {
  const input = indexed(field);
  if (input === null) return { start: null, end: null };
  try {
    return { start: input.selectionStart, end: input.selectionEnd };
  } catch {
    return { start: null, end: null };
  }
}

/** What is selected inside a field: its own range, or the document's. */
function textIn(field: HTMLElement, range: { start: number | null; end: number | null }): string {
  const input = indexed(field);
  if (input !== null && range.start !== null && range.end !== null) {
    return input.value.slice(range.start, range.end);
  }
  return window.getSelection()?.toString() ?? "";
}

/** Disabled counts: neither takes an edit, and Cut on either would do nothing. */
function isReadOnly(field: HTMLElement): boolean {
  const input = indexed(field);
  return input === null ? false : input.readOnly || input.disabled;
}
