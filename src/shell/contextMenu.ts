/**
 * What a right-click in the shell may act on, what it may do to it, and where
 * the menu that offers it goes.
 *
 * Everything here is pure: the DOM reading lives in `ContextMenuHost.tsx`,
 * which turns an event into a `ContextSubject` and hands it back. The split is
 * what lets the three decisions that actually have edge cases — which items are
 * live, where the surface lands near a viewport edge, and what closes it — be
 * tested without a browser, which is the only kind of test this repo's `node`
 * vitest can run.
 */
import type { MenuItem } from "./contract";

/**
 * What was under the pointer, reduced to the four facts the items need.
 *
 * Not "which element" and not "which region": a menu that knew it was over the
 * status bar would need a branch per region, and the items it offers are the
 * same four everywhere. The regions that want something of their own say so by
 * calling `preventDefault` — see `ContextMenuHost`.
 */
export interface ContextSubject {
  /** An `<input>`, a `<textarea>`, or something `contenteditable`. */
  editable: boolean;
  /** Editable *and* accepting changes — not `readonly`, not `disabled`. */
  writable: boolean;
  /** Some text is selected inside the subject right now. */
  hasSelection: boolean;
}

/** What the four items do when they are live. Supplied by the host. */
export interface ContextActions {
  cut: () => void;
  copy: () => void;
  selectAll: () => void;
}

/**
 * Why Paste is present and dead.
 *
 * The same decision the Edit menu made, for the same two reasons, and stated
 * once here rather than twice: no Chromium engine will run
 * `execCommand("paste")`, and `navigator.clipboard.readText()` is gated on a
 * permission whose behaviour in a Tauri v2 WebView2 window could not be
 * established without running the app. Shipping a Paste that silently does
 * nothing is worse than one that says why. `docs/design-notes/shell-chrome.md`
 * carries the full account for both menus.
 */
const PASTE_HINT =
  "Paste from a menu is blocked by the webview's clipboard permissions. Ctrl+V works — it is the browser's own paste and does not go through the menu.";

/**
 * The four items, with the reason for every dead one, under whatever the
 * calling surface contributed.
 *
 * Always four rows at the bottom. An item that cannot act is `disabled` with a
 * `hint`, never dropped — `menuItemList.css` argues the case at the row level
 * and it is the same argument here: a menu whose height changes with what
 * happens to be under the pointer is harder to learn than one whose items grey
 * out.
 *
 * `extra` is how a surface adds its own without owning a menu: ordinary
 * `MenuItem`s, so a submenu or a prompt works here exactly as it does in the
 * title bar. They go *above* the edit block, which then grows a separator —
 * what a surface contributes is about the thing clicked, and the four below are
 * about the text, so the specific comes first the way it does in every menu in
 * this shell.
 */
export function contextItems(
  subject: ContextSubject,
  actions: ContextActions,
  extra: MenuItem[] = [],
): MenuItem[] {
  const { editable, writable, hasSelection } = subject;

  const edits: MenuItem[] = [
    {
      label: "Cut",
      accelerator: "Ctrl+X",
      disabled: !(writable && hasSelection),
      hint: cutHint(subject),
      onSelect: actions.cut,
    },
    {
      label: "Copy",
      accelerator: "Ctrl+C",
      disabled: !hasSelection,
      hint: hasSelection ? undefined : "Nothing is selected.",
      onSelect: actions.copy,
    },
    {
      label: "Paste",
      accelerator: "Ctrl+V",
      disabled: true,
      hint: PASTE_HINT,
    },
    {
      label: "Select All",
      accelerator: "Ctrl+A",
      separatorBefore: true,
      disabled: !editable,
      // Deliberately field-only. `execCommand("selectAll")` over the shell
      // itself would select the title bar, the tab strip and the status bar —
      // every word of chrome on screen — which is not what anybody means by it.
      hint: editable ? undefined : "Select All belongs to a text field. Click into one first.",
      onSelect: actions.selectAll,
    },
  ];

  if (extra.length === 0) return edits;
  return [...extra, { ...edits[0], separatorBefore: true }, ...edits.slice(1)];
}

/** Which of the two things stops Cut, when something does. */
function cutHint(subject: ContextSubject): string | undefined {
  if (!subject.editable) return "Cut needs a text field. This is not one.";
  if (!subject.writable) return "This field is read-only.";
  if (!subject.hasSelection) return "Nothing is selected.";
  return undefined;
}

/** A point, or a size, in CSS pixels. Both halves of the placement arithmetic. */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Kept off the viewport edges so the border is never flush with the frame. */
export const EDGE_GAP = 4;

/**
 * Where the menu goes, given the click and the size the menu turned out to be.
 *
 * **Flip, then clamp.** A menu that does not fit to the right of the pointer is
 * drawn to its *left* rather than slid left until it fits — sliding leaves the
 * pointer sitting on top of the menu's own rows, and the first click after the
 * one that opened it lands on whichever row happened to slide under the cursor.
 * Flipping keeps the corner at the pointer, which is what every desktop menu
 * does. The same argument applies downward.
 *
 * The clamp is the floor under both: a menu taller or wider than the viewport
 * has no side it fits on, and the honest answer is the top-left corner rather
 * than a negative coordinate.
 */
export function placeMenu(at: Point, size: Size, viewport: Size): Point {
  const fitsRight = at.x + size.width + EDGE_GAP <= viewport.width;
  const fitsBelow = at.y + size.height + EDGE_GAP <= viewport.height;

  const x = fitsRight ? at.x : at.x - size.width;
  const y = fitsBelow ? at.y : at.y - size.height;

  return {
    x: clamp(x, viewport.width - size.width),
    y: clamp(y, viewport.height - size.height),
  };
}

/** Between the near edge and the far one, near edge winning when they cross. */
function clamp(value: number, max: number): number {
  return Math.max(EDGE_GAP, Math.min(value, max - EDGE_GAP));
}

/**
 * Everything that reaches an open menu, so the host can ask one question rather
 * than repeat the answer in six listeners.
 *
 * `pointer` is the only one with a second half. A menu anchored to a viewport
 * point is wrong the moment what it belongs to moves, so a scroll or a resize
 * closes it rather than being chased; a blur closes it because most of this
 * window is not this document — see `MenuBar`'s note on why that is the one
 * signal that crosses an iframe boundary.
 */
export type Dismissal =
  | { reason: "escape" }
  | { reason: "pointer"; insideMenu: boolean }
  | { reason: "blur" }
  | { reason: "scroll" }
  | { reason: "resize" }
  | { reason: "selected" };

/** Whether this event closes the menu. */
export function dismisses(event: Dismissal): boolean {
  return event.reason === "pointer" ? !event.insideMenu : true;
}
