import { describe, expect, it, vi } from "vitest";
import {
  contextItems,
  dismisses,
  EDGE_GAP,
  placeMenu,
  type ContextActions,
  type ContextSubject,
} from "./contextMenu";
import type { MenuItem } from "./contract";

/** A subject with nothing true, so each test turns on only what it is about. */
const INERT: ContextSubject = { editable: false, writable: false, hasSelection: false };

const NOTHING: ContextActions = { cut: () => {}, copy: () => {}, selectAll: () => {} };

/** The one item by that label, which is how every assertion below reads. */
function row(items: MenuItem[], label: string): MenuItem {
  const found = items.find((item) => item.label === label);
  if (!found) throw new Error(`no ${label} item`);
  return found;
}

describe("contextItems", () => {
  it("offers the same four rows whatever was clicked", () => {
    const labels = contextItems(INERT, NOTHING).map((item) => item.label);
    expect(labels).toEqual(["Cut", "Copy", "Paste", "Select All"]);
  });

  it("disables everything over a surface that is not text", () => {
    const items = contextItems(INERT, NOTHING);
    expect(items.every((item) => item.disabled === true)).toBe(true);
    expect(items.every((item) => item.hint !== undefined)).toBe(true);
  });

  it("enables Copy for a selection outside a field, and nothing else", () => {
    const items = contextItems({ ...INERT, hasSelection: true }, NOTHING);
    expect(row(items, "Copy").disabled).toBe(false);
    // Cut would have to remove the text, and there is no field to remove it
    // from; Select All is deliberately field-only.
    expect(row(items, "Cut").disabled).toBe(true);
    expect(row(items, "Select All").disabled).toBe(true);
  });

  it("enables Cut only when the field takes edits and something is selected", () => {
    const empty: ContextSubject = { editable: true, writable: true, hasSelection: false };
    expect(row(contextItems(empty, NOTHING), "Cut").disabled).toBe(true);

    const selected = { ...empty, hasSelection: true };
    expect(row(contextItems(selected, NOTHING), "Cut").disabled).toBe(false);

    const readOnly = { ...selected, writable: false };
    expect(row(contextItems(readOnly, NOTHING), "Cut").disabled).toBe(true);
    expect(row(contextItems(readOnly, NOTHING), "Cut").hint).toMatch(/read-only/);
  });

  it("enables Select All for any field, empty or not", () => {
    const field: ContextSubject = { editable: true, writable: true, hasSelection: false };
    expect(row(contextItems(field, NOTHING), "Select All").disabled).toBe(false);
    expect(row(contextItems(field, NOTHING), "Select All").hint).toBeUndefined();
  });

  it("keeps Paste dead and says why, even in a writable field with a selection", () => {
    const best: ContextSubject = { editable: true, writable: true, hasSelection: true };
    const paste = row(contextItems(best, NOTHING), "Paste");
    expect(paste.disabled).toBe(true);
    expect(paste.hint).toMatch(/Ctrl\+V/);
    expect(paste.onSelect).toBeUndefined();
  });

  it("runs the action the caller supplied", () => {
    const copy = vi.fn();
    const items = contextItems({ ...INERT, hasSelection: true }, { ...NOTHING, copy });
    row(items, "Copy").onSelect?.();
    expect(copy).toHaveBeenCalledOnce();
  });

  it("puts contributed items above the edit block, behind a separator", () => {
    const extra: MenuItem[] = [{ label: "Reveal in File Explorer" }];
    const items = contextItems(INERT, NOTHING, extra);

    expect(items.map((item) => item.label)).toEqual([
      "Reveal in File Explorer",
      "Cut",
      "Copy",
      "Paste",
      "Select All",
    ]);
    expect(row(items, "Cut").separatorBefore).toBe(true);
  });

  it("leaves the first row unseparated when nothing was contributed", () => {
    expect(row(contextItems(INERT, NOTHING), "Cut").separatorBefore).toBeUndefined();
  });
});

describe("placeMenu", () => {
  const VIEWPORT = { width: 1000, height: 800 };
  const SIZE = { width: 200, height: 160 };

  it("hangs from the pointer when there is room", () => {
    expect(placeMenu({ x: 100, y: 100 }, SIZE, VIEWPORT)).toEqual({ x: 100, y: 100 });
  });

  it("flips left rather than sliding, so the pointer stays off the rows", () => {
    // 60px of room on the right, and the menu is 200 wide.
    expect(placeMenu({ x: 940, y: 100 }, SIZE, VIEWPORT)).toEqual({ x: 740, y: 100 });
  });

  it("flips up when the pointer is near the bottom", () => {
    expect(placeMenu({ x: 100, y: 700 }, SIZE, VIEWPORT)).toEqual({ x: 100, y: 540 });
  });

  it("flips both ways at once in the far corner", () => {
    expect(placeMenu({ x: 995, y: 795 }, SIZE, VIEWPORT)).toEqual({ x: 795, y: 635 });
  });

  it("keeps a gap when a flip would put it off the near edge", () => {
    // Flipping left from x=10 lands at -190; the clamp is what saves it.
    expect(placeMenu({ x: 10, y: 10 }, { width: 990, height: 160 }, VIEWPORT).x).toBe(EDGE_GAP);
  });

  it("gives up on the far edge rather than the near one when it cannot fit", () => {
    const at = placeMenu({ x: 500, y: 500 }, { width: 2000, height: 2000 }, VIEWPORT);
    expect(at).toEqual({ x: EDGE_GAP, y: EDGE_GAP });
  });

  it("treats the last pixel that fits as fitting", () => {
    const exact = { x: VIEWPORT.width - SIZE.width - EDGE_GAP, y: 0 };
    expect(placeMenu(exact, SIZE, VIEWPORT).x).toBe(exact.x);
  });
});

describe("dismisses", () => {
  it("closes on Escape", () => {
    expect(dismisses({ reason: "escape" })).toBe(true);
  });

  it("closes on a pointer down outside, and stays open for one inside", () => {
    expect(dismisses({ reason: "pointer", insideMenu: false })).toBe(true);
    expect(dismisses({ reason: "pointer", insideMenu: true })).toBe(false);
  });

  it("closes rather than chasing when the surface under it moves", () => {
    expect(dismisses({ reason: "scroll" })).toBe(true);
    expect(dismisses({ reason: "resize" })).toBe(true);
  });

  it("closes when focus leaves the document, which is what a click in an app frame looks like", () => {
    expect(dismisses({ reason: "blur" })).toBe(true);
  });

  it("closes once an item has acted", () => {
    expect(dismisses({ reason: "selected" })).toBe(true);
  });
});
