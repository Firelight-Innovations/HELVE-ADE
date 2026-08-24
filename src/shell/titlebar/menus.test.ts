/**
 * The View menu: every row acts, and the three toggles say which state the
 * window is actually in.
 *
 * `defaultMenus` is a pure function of the handlers it is given, which is what
 * makes the menu testable with no DOM under it (STANDARDS.md §8.3). The bar
 * rebuilds it from live state on every render, so a `Menu[]` built here from a
 * known `ViewMenuHandlers` is the same tree the dropdown would draw.
 *
 * The regression these guard is a row that renders live and silently does
 * nothing — a menu that lies, which `MenuItem.disabled` exists to prevent. That
 * invariant is asserted over the whole menu rather than row by row: every row
 * carries an `onSelect`, whatever state the window is in. It is stated once in
 * `defaultMenus`' header as a rule, and a rule nothing checks is one that
 * decays.
 */
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { MenuItem } from "../contract";
import { defaultMenus, type MenuHandlers, type ViewMenuHandlers } from "./menus";

/** A `ViewMenuHandlers` whose six actions are spies, over a stated window state. */
type ViewSpies = ViewMenuHandlers & {
  commandPalette: Mock;
  togglePanel: Mock;
  toggleTerminal: Mock;
  toggleFullscreen: Mock;
  zoomIn: Mock;
  zoomOut: Mock;
};

/**
 * The half of `ViewMenuHandlers` that is a *reading* rather than an action —
 * what the window is doing right now. Overriding only these keeps the six spies
 * spies: spreading a `Partial<ViewMenuHandlers>` over them would widen each one
 * back to a plain function and take `toHaveBeenCalled` with it.
 */
type ViewState = Pick<
  ViewMenuHandlers,
  "panelCollapsed" | "terminalShowing" | "fullscreen" | "zoomInBlocked" | "zoomOutBlocked"
>;

function viewHandlers(state: Partial<ViewState> = {}): ViewSpies {
  return {
    commandPalette: vi.fn(),
    panelCollapsed: false,
    togglePanel: vi.fn(),
    terminalShowing: false,
    toggleTerminal: vi.fn(),
    fullscreen: false,
    toggleFullscreen: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    ...state,
  };
}

/**
 * The other six menus' handlers, inert. `defaultMenus` builds all seven from one
 * object, so a View test still has to hand it a whole `MenuHandlers` — none of
 * these is called, and a spy that is never invoked is the point.
 */
function otherHandlers(): Omit<MenuHandlers, "view"> {
  const commands = { run: vi.fn(), blocked: () => undefined };
  return {
    app: commands,
    edit: commands,
    apps: {
      available: [],
      open: vi.fn(),
      presets: {
        available: [],
        apply: vi.fn(),
        save: () => Promise.resolve(),
        suggestedName: "Cluster 1",
      },
    },
    file: { closeWindow: vi.fn() },
    terminal: {
      onNew: vi.fn(),
      onSplit: vi.fn(),
      onKill: vi.fn(),
      onClear: vi.fn(),
      enabled: true,
    },
    help: { checkForUpdates: vi.fn() },
  };
}

/** The View menu's rows, built against `view`. */
function viewMenu(view: ViewMenuHandlers): MenuItem[] {
  const menu = defaultMenus({ ...otherHandlers(), view }).find((one) => one.label === "View");
  if (menu === undefined) throw new Error("defaultMenus() built no View menu");
  return menu.items;
}

/** One row by label. Throws rather than returning `undefined`, so a renamed row
 *  fails on the row that is missing instead of on a null dereference later. */
function row(items: MenuItem[], label: string): MenuItem {
  const found = items.find((item) => item.label === label);
  if (found === undefined) {
    throw new Error(`no View row labelled "${label}"; rows are ${labels(items).join(", ")}`);
  }
  return found;
}

const labels = (items: MenuItem[]): string[] => items.map((item) => item.label);

/** Build the menu in one state, pick one row, and click it. */
function select(state: Partial<ViewState>, label: string): ViewSpies {
  const view = viewHandlers(state);
  row(viewMenu(view), label).onSelect?.();
  return view;
}

describe("the View menu", () => {
  /**
   * The whole of issue #41 in one assertion: a row with no `onSelect` renders
   * live, closes the menu when clicked, and does nothing. Zoom is the shape a
   * row that cannot act is allowed to take — `disabled` with a `hint` — and it
   * still carries its handler, so this holds for all six.
   */
  it("gives every row something to do", () => {
    const items = viewMenu(viewHandlers());
    const inert = items.filter((item) => item.onSelect === undefined).map((item) => item.label);
    expect(inert).toEqual([]);
  });

  it("has the six rows the menu declares", () => {
    expect(labels(viewMenu(viewHandlers()))).toEqual([
      "Command Palette…",
      "Hide Secondary Panel",
      "Show Terminal",
      "Enter Full Screen",
      "Zoom In",
      "Zoom Out",
    ]);
  });

  it("opens the command palette", () => {
    expect(select({}, "Command Palette…").commandPalette).toHaveBeenCalledTimes(1);
  });
});

/**
 * The three toggles name the state they will move *to*, so the menu answers
 * "is the panel open?" without the user having to close it to find out. That
 * makes the label the whole of the state readout, and a label that stopped
 * following the flag would be the menu quietly lying about the window.
 */
describe("the View menu's toggles", () => {
  it("offer to hide the secondary panel while it is showing", () => {
    const items = viewMenu(viewHandlers({ panelCollapsed: false }));
    expect(labels(items)).toContain("Hide Secondary Panel");
    expect(labels(items)).not.toContain("Show Secondary Panel");
  });

  it("offer to show the secondary panel while it is collapsed", () => {
    expect(labels(viewMenu(viewHandlers({ panelCollapsed: true })))).toContain(
      "Show Secondary Panel",
    );
  });

  it("flip the panel from either state", () => {
    expect(
      select({ panelCollapsed: false }, "Hide Secondary Panel").togglePanel,
    ).toHaveBeenCalled();
    expect(select({ panelCollapsed: true }, "Show Secondary Panel").togglePanel).toHaveBeenCalled();
  });

  it("offer to hide the terminal only while it is showing", () => {
    expect(labels(viewMenu(viewHandlers({ terminalShowing: true })))).toContain("Hide Terminal");
    expect(labels(viewMenu(viewHandlers({ terminalShowing: false })))).toContain("Show Terminal");
  });

  it("flip the terminal from either state", () => {
    expect(select({ terminalShowing: true }, "Hide Terminal").toggleTerminal).toHaveBeenCalled();
    expect(select({ terminalShowing: false }, "Show Terminal").toggleTerminal).toHaveBeenCalled();
  });

  it("offer to leave full screen only while the window is in it", () => {
    expect(labels(viewMenu(viewHandlers({ fullscreen: true })))).toContain("Exit Full Screen");
    expect(labels(viewMenu(viewHandlers({ fullscreen: false })))).toContain("Enter Full Screen");
  });

  it("flip full screen from either state", () => {
    expect(select({ fullscreen: true }, "Exit Full Screen").toggleFullscreen).toHaveBeenCalled();
    expect(select({ fullscreen: false }, "Enter Full Screen").toggleFullscreen).toHaveBeenCalled();
  });
});

/**
 * Zoom is the one pair that can be unable to act — at the ends of the ladder,
 * and in a plain browser where there is no webview to scale. `zoomInBlocked`
 * and `zoomOutBlocked` answer both questions at once, and the rows have to keep
 * them together: a row disabled with no `hint` is a dead row with no
 * explanation, and a `hint` on a live row is a reason for nothing.
 */
describe("the View menu's zoom rows", () => {
  it("zoom the window when the ladder has somewhere to go", () => {
    const view = viewHandlers();
    const items = viewMenu(view);
    row(items, "Zoom In").onSelect?.();
    row(items, "Zoom Out").onSelect?.();
    expect(view.zoomIn).toHaveBeenCalledTimes(1);
    expect(view.zoomOut).toHaveBeenCalledTimes(1);
  });

  it("stay live while nothing blocks them", () => {
    const items = viewMenu(viewHandlers());
    for (const label of ["Zoom In", "Zoom Out"]) {
      expect(row(items, label).disabled).not.toBe(true);
      expect(row(items, label).hint).toBeUndefined();
    }
  });

  it("disable each direction independently, carrying its reason", () => {
    const items = viewMenu(viewHandlers({ zoomInBlocked: "Already at the largest size (250%)." }));
    expect(row(items, "Zoom In").disabled).toBe(true);
    expect(row(items, "Zoom In").hint).toBe("Already at the largest size (250%).");
    expect(row(items, "Zoom Out").disabled).toBe(false);
  });

  it("disable both when there is no webview to scale", () => {
    const nothing = "Zoom scales the desktop app's webview.";
    const items = viewMenu(viewHandlers({ zoomInBlocked: nothing, zoomOutBlocked: nothing }));
    expect(row(items, "Zoom In").disabled).toBe(true);
    expect(row(items, "Zoom Out").disabled).toBe(true);
  });
});

describe("the View menu's accelerators", () => {
  /**
   * Half of "bind it or drop it": every View row displays a keystroke. The
   * other half — that `useKeyboard` fires the row's action for it — cannot be
   * asserted from here. `CHORDS` lives in the `keys` region and STANDARDS.md
   * §1.2 forbids `titlebar` from reaching into it, in either direction. What
   * covers that edge instead is `keys/shortcuts.test.ts`, which holds the
   * shortcuts screen's View group against `CHORDS`; between the two, an
   * accelerator drawn here that nothing binds shows up as a row the screen
   * cannot account for.
   */
  it("are on every row, since each one has a keystroke", () => {
    const bare = viewMenu(viewHandlers())
      .filter((item) => item.accelerator === undefined)
      .map((item) => item.label);
    expect(bare).toEqual([]);
  });
});
