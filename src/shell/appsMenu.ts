/**
 * The Apps menu and its Presets branch — the single definition of both.
 *
 * Directly under `src/shell/` rather than inside `titlebar/` because two regions
 * draw it: the title bar's Apps menu, and the switcher row's add-app button.
 * STANDARDS.md §1.2 lets a region import nothing but `contract.ts`, so a shared
 * menu definition kept inside one of the two would make the other reach across.
 * Two hand-built lists would agree today and disagree the first time an app was
 * added to the registry — one surface would show it, the other would not, and
 * nothing would fail.
 *
 * Only the list is here. Where it is drawn stays with each region: `MenuBar`
 * puts it between Edit and View, `AddAppButton` puts it in a popover under a +.
 */
import type { Openable } from "../bindings";
import type { LayoutPreset, Menu, MenuItem } from "./contract";

/**
 * The Apps menu: what this build ships, as things you can open another of.
 *
 * `available` comes from Rust rather than being written out here, so an app
 * added in `apps::REGISTRY` appears in the menu without a second edit in a file
 * whose author would have no reason to look.
 *
 * **A terminal is one of the rows, and it is not an app.** It has no frontend to
 * mount and no Rust half to call, so it comes from `apps::openables` — the union
 * of the registry and a terminal — rather than from the app list, which carries
 * a mountable URL that a terminal cannot have. `Openable.kind` is what `open`
 * routes on, which is why the whole entry is handed back rather than just its
 * id: the menu should not have to know which magic string means "spawn a shell".
 */
export interface AppsMenuHandlers {
  available: Openable[];
  /** Opens a new one. There is no "already open" to disable it for. */
  open: (entry: Openable) => void;
  /**
   * Why nothing here can be opened right now, or `undefined` when it can.
   *
   * One reason exists and it is not about any app: a surface opens into a
   * *pane*, and a window whose clusters have all been closed has none. The
   * backend refuses such an open, so without this every entry would be a live
   * item that silently does nothing — which is the one thing the menu is not
   * allowed to do (see `MenuItem.disabled`).
   *
   * A single string for the whole list rather than a predicate per app,
   * because the obstacle is the window's and every app hits it identically.
   *
   * It disables the presets below too, and correctly: applying one and saving
   * one are both about the cluster this window is showing, and a window with no
   * cluster has nothing to rearrange and nothing to capture.
   */
  blocked?: string;
  /** The presets branch. See [`PresetsMenuHandlers`]. */
  presets: PresetsMenuHandlers;
}

/**
 * The Presets submenu: apply one, or save the arrangement you are looking at.
 *
 * Carried on `AppsMenuHandlers` rather than as a menu of its own, and that is
 * the decision worth stating. `appsMenu()` is the single definition that feeds
 * both the title bar's Apps menu and the switcher row's `+` — so hanging presets
 * off it puts them in both surfaces at once, with nothing to keep in sync, and
 * puts "apply an arrangement" directly under "open one more app". Those are the
 * same question at two scales, and the `+` at the end of a cluster's own tabs is
 * exactly where someone stands when they ask either one.
 *
 * It also means `ClusterBar` needs no change at all: it already forwards one
 * `AppsMenuHandlers` from `WindowRoot` to `AddAppButton` without inspecting it.
 */
export interface PresetsMenuHandlers {
  /** The merged list from Rust: the built-ins, then the user's own. */
  available: LayoutPreset[];
  /** Rearranges the active cluster. Never closes anything — see `presets::plan`. */
  apply: (presetId: string) => void;
  /**
   * Capture the active cluster under this name.
   *
   * Rejects with a sentence to show under the field — a blank name, or one of
   * the built-ins'. The menu shows it and stays open; see `MenuPrompt`.
   */
  save: (name: string) => Promise<void>;
  /** What the name field starts with. The cluster's own name. */
  suggestedName: string;
}

/**
 * The Apps menu — **the** definition of it, and the only one.
 *
 * Pulled out of `defaultMenus` below because the menu bar is no longer the only
 * place this list appears: the switcher row's add-app button
 * (`switcher/AddAppButton.tsx`) shows the same items, and hands them to the same
 * `MenuItemList`. Two hand-built lists would agree today and disagree the first
 * time an app is added to the registry — one surface would show it, the other
 * would not, and nothing would fail. There is one list because there is one
 * function that builds it.
 *
 * Apps sits between Edit and View, where a menu about *what is open* reads more
 * naturally than one buried under File. Every entry opens a new instance; none
 * is disabled for being open already, because "already open" stopped being a
 * state an app can be in. They are disabled together, or not at all, when the
 * window has nowhere to put one — see `AppsMenuHandlers.blocked`.
 *
 * The apps themselves are a flat list, and that has not changed: every entry
 * does one thing, and nesting a one-item branch under each would be a caret to
 * click before the click that opens anything.
 *
 * **Presets are the exception, and they are why `MenuItem` has a `submenu` at
 * all.** There are three built-ins and however many the user saves, they are a
 * column of names, and flattened in here they would put "open one more Files"
 * and "rearrange this entire cluster" in one undifferentiated list where a
 * mis-click between neighbours does something very different from what was
 * meant. Open Recent went the other way for a reason that does not apply here —
 * what it had to show was a path, a date, and whether the folder still exists,
 * which is a surface rather than a list.
 */
export function appsMenu(apps: AppsMenuHandlers): Menu {
  return {
    label: "Apps",
    items: [
      ...apps.available.map((entry) => ({
        label: entry.name,
        onSelect: () => apps.open(entry),
        disabled: apps.blocked !== undefined,
        // The registry's own description, which for most rows says nothing the
        // label does not. It earns its place on the Terminal row, where there
        // *is* something non-obvious to say: the panel below already has a `+`
        // that makes a terminal, and this makes a different one.
        hint: apps.blocked ?? entry.description,
      })),
      {
        label: "Presets",
        separatorBefore: true,
        submenu: presetItems(apps.presets, apps.blocked),
        disabled: apps.blocked !== undefined,
        hint:
          apps.blocked ??
          "Arrangements you can drop onto this cluster: which panes, and what goes in each.",
      },
    ],
  };
}

/**
 * The rows inside Presets: every preset, then the one that makes another.
 *
 * The built-ins come first because Rust merges them first, and the separator
 * before the user's own is drawn only when there *are* any — a separator with
 * nothing under it is a line that promises a section.
 *
 * Save is last and behind its own separator, because it is the only row here
 * that does not rearrange anything. It carries the prompt rather than raising a
 * dialog; see `MenuPrompt` for why not `window.prompt`.
 */
function presetItems(presets: PresetsMenuHandlers, blocked?: string): MenuItem[] {
  const firstUser = presets.available.findIndex((preset) => !preset.builtin);

  return [
    ...presets.available.map((preset, i) => ({
      label: preset.name,
      onSelect: () => presets.apply(preset.id),
      separatorBefore: i === firstUser && i > 0,
      disabled: blocked !== undefined,
      hint:
        blocked ??
        (preset.builtin
          ? undefined
          : // Worth saying on a user's own rows and not on the built-ins':
            // someone who saved this five minutes ago knows what is in it,
            // and what they may not know is that applying it will not throw
            // away whatever else is open.
            "Rearranges this cluster. Nothing open is closed — anything the preset does not mention moves to the last pane."),
    })),
    {
      label: "Save Current Layout…",
      separatorBefore: true,
      disabled: blocked !== undefined,
      hint: blocked ?? "Captures this cluster's panes and which app is in each.",
      prompt: {
        label: "Save this cluster's panes, and which app is in each, as a preset.",
        placeholder: "Preset name",
        initialValue: presets.suggestedName,
        confirmLabel: "Save",
        onSubmit: presets.save,
      },
    },
  ];
}
