/**
 * The command registry, and it is the menu bar.
 *
 * There is no second table of commands here, and adding one was the obvious
 * shape to reject: two lists of the same actions agree on the day they are
 * written, and then a row renamed in the menu keeps its old name in the palette
 * and nothing fails. The menu model is already rebuilt from live state every
 * render and already carries every field a palette row needs, so this flattens
 * it. One source of truth by construction rather than by discipline.
 *
 * What that costs: a command has to be *in a menu* to be in the palette — and
 * that is the right constraint, since a palette-only command would be an action
 * with no discoverable home, which is the problem a palette exists to solve.
 */
import type { Menu, MenuItem, MenuPrompt } from "../contract";
import { fuzzyMatch } from "./fuzzy";

/** One runnable row, flattened out of the menu tree. */
export interface Command {
  /** The menu path it came from — `"View"`, or `"Apps › Presets"`. */
  category: string;
  /** The row's own label, ellipsis and all. */
  title: string;
  /** `"View: Zoom In"`. What the field matches against and the row draws, so
   *  the two can never highlight different characters. */
  label: string;
  accelerator?: string;
  /** Carries the menu's own meaning: inert and unclickable, never dimmed but
   *  live. `hint` is the sentence saying why. */
  disabled: boolean;
  hint?: string;
  onSelect?: () => void;
  /** A command that wants one line of text first. The palette asks for it in
   *  its own field rather than sending you to the menu to find the row. */
  prompt?: MenuPrompt;
}

/** A command the field matched, with the characters it matched on. */
export interface RankedCommand {
  command: Command;
  /** Indices into `command.label`, for drawing the match. */
  positions: number[];
}

/** How a menu path is written when it goes more than one level deep. */
const PATH_SEPARATOR = " › ";

/**
 * Every command in the menu tree, in menu order.
 *
 * A branch row contributes its children and not itself — Apps ▸ Presets opens
 * rather than acts, so a palette entry for it would be a row that runs nothing.
 * A leaf with neither an action nor a `disabled` of its own is dropped for the
 * same reason: that is scaffolding, not a command, and Help ▸ Documentation is
 * the one row in the tree it currently describes.
 */
export function commandsFromMenus(menus: Menu[]): Command[] {
  return menus.flatMap((menu) => itemsToCommands(menu.items, menu.label));
}

function itemsToCommands(items: MenuItem[], category: string): Command[] {
  return items.flatMap((item) => {
    if (item.submenu) {
      return itemsToCommands(item.submenu, `${category}${PATH_SEPARATOR}${item.label}`);
    }
    if (item.onSelect === undefined && item.prompt === undefined && item.disabled !== true) {
      return [];
    }
    return [
      {
        category,
        title: item.label,
        label: `${category}: ${item.label}`,
        accelerator: item.accelerator,
        disabled: item.disabled === true,
        hint: item.hint,
        onSelect: item.onSelect,
        prompt: item.prompt,
      },
    ];
  });
}

/**
 * The rows the field should show, best first.
 *
 * A command that cannot act is ranked and drawn like any other rather than
 * filtered out, which is the decision most likely to be argued with. VS Code
 * hides it; here the row already carries the sentence saying why, and "Save is
 * greyed out because nothing is open" beats an empty list. It stays
 * unselectable, so nothing runs by accident.
 *
 * Ties break on the label so the order is stable between keystrokes: an
 * unstable sort under a moving highlight moves the row out from under Enter.
 */
export function rankCommands(commands: Command[], query: string): RankedCommand[] {
  const needle = query.trim();
  if (needle === "") return commands.map((command) => ({ command, positions: [] }));

  return commands
    .flatMap((command) => {
      const hit = fuzzyMatch(needle, command.label);
      return hit === null ? [] : [{ command, positions: hit.positions, score: hit.score }];
    })
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .map(({ command, positions }) => ({ command, positions }));
}

/**
 * Which row the highlight starts on: the first that can actually run.
 *
 * Not simply zero, because a disabled row can outrank every live one — search
 * for "save" with nothing open and every match is greyed. Enter would then do
 * nothing on a palette that looks ready, which is the same "the menu lies"
 * failure `disabled` exists to prevent. Falls back to zero when no row can run,
 * so the list still has a highlight to read the reason off.
 */
export function initialIndex(rows: RankedCommand[]): number {
  const live = rows.findIndex((row) => !row.command.disabled);
  return live === -1 ? 0 : live;
}
