/**
 * The title bar — logo, six menus (or their hamburger collapse), the
 * centred window title, and the three window controls.
 *
 * Every geometry number below is lifted from `docs/handoffs/shell-spec.html`
 * (search `>File<` and the `REFERENCE` table's Title bar row) rather than
 * chosen — see `titlebar.css`'s header comment for the one place that isn't.
 *
 * This component does not set the bar's height or background: `Frame`
 * already renders it into `.frame__titlebar`, which is 34px with the surface
 * colour and the bottom hairline. Setting either here would be two owners of
 * one property.
 */
import type { Openable } from "../../bindings";
import type { LayoutPreset, Menu, MenuItem, WindowKind } from "../contract";
import { BrandGlyph } from "../../ui/Icon";
import MenuBar from "./MenuBar";
import HamburgerMenu from "./HamburgerMenu";
import WindowControls from "./WindowControls";
import { useNarrowTitlebar } from "./useNarrowTitlebar";
import "./titlebar.css";

export default function TitleBar({
  kind,
  project,
  worktree,
  menus,
}: {
  kind: WindowKind;
  /** The **active cluster's** project name, or `null` when that cluster has
   *  none — or when this window has no cluster at all. A project belongs to a
   *  cluster, so this is what lets two windows name two projects at once. */
  project: string | null;
  /** The active cluster's worktree branch, or `null`. `Cluster.worktree` is a
   *  stub nothing populates, so this is `null` today and the segment is dropped
   *  — see the note on the title element below for why an approximation from
   *  the stack's git status would be worse than an absence. */
  worktree: string | null;
  /** Built by `defaultMenus()`, wired against `WindowRoot`'s state and the
   *  active app frame. Rebuilt on every render, because half the items read
   *  live state — Save disables when nothing is dirty, the toggles say which
   *  way they will go. */
  menus: Menu[];
}) {
  const narrow = useNarrowTitlebar();

  return (
    // The drag region lives on this element only. The logo, the menus, the
    // title, and the window controls are all separate elements without the
    // attribute, so pointer-downs on them never start a window drag —
    // clicking through to this element's own background is what does.
    <div className="titlebar" data-window-kind={kind} data-tauri-drag-region>
      <div className="titlebar__logo">
        <BrandGlyph size={15} className="titlebar__logo-icon" />
      </div>

      {narrow ? <HamburgerMenu menus={menus} /> : <MenuBar menus={menus} />}

      {/* Absolutely centred across the whole bar, pointer-events: none, and
          deliberately allowed to sit under the menu block or the window
          controls at narrow widths — the spec calls that out by name, so
          there is no collision-avoidance logic to look for here.

          The spec's title was "HELVE Engine — [tool]", and that has been
          replaced: the surface you are looking at is already named by the tab
          you clicked to get to it, an arm's length below this, so repeating it
          here spent the most legible strip in the window on the one fact
          nothing else could hide. What the tabs cannot say is *which project*
          and *which checkout* — both of which change under you (Open Recent, a
          branch switched in a terminal) and both of which decide what every
          other action in this window will touch.

          Both segments name the **active cluster's** own facts, which is what
          lets two windows on two monitors show two projects at once. The
          project comes from `useClusterProject`, asked about whichever cluster
          this window is showing.

          The worktree is `Cluster.worktree`, and today that is a **placeholder
          shape rather than a live value**: nothing populates the field yet, so
          the segment is simply absent and the layout is right for the day it
          is not. It used to draw `useGitStatus`'s branch — the checkout the
          *stack manifest* resolved, which was never this cluster's worktree and
          only looked like it while there was one project in the process.
          Naming the wrong branch beside the right project is worse than naming
          none, so it waits for the git work rather than approximating.

          Segments with no answer are dropped rather than drawn as a placeholder
          or an em-dash. With nothing open this reads "HELVE Engine", which is
          true; "HELVE Engine | — | —" would be three claims where there is
          one. */}
      <div className="titlebar__title">
        <span>HELVE Engine</span>
        {project !== null && (
          <>
            <span className="titlebar__title-sep">|</span>
            <span className="titlebar__title-name">{project}</span>
          </>
        )}
        {worktree !== null && (
          <>
            <span className="titlebar__title-sep">|</span>
            <span className="titlebar__title-worktree">{worktree}</span>
          </>
        )}
      </div>

      <div className="titlebar__spacer" />

      <WindowControls />
    </div>
  );
}

/**
 * Every command the shell's menus can ask a mounted app frame to carry out.
 *
 * The shell knows these strings and nothing else about them. It does not know
 * that `file/save` writes a file, or that only Files can do it — it posts the
 * string to the active frame and greys the item out when that frame has not
 * declared it (see `helve/commands` in `docs/tool-protocol.md` §3). That is
 * what keeps one app's capability list out of the title bar, so the next app to
 * arrive does not break the menu.
 *
 * The Files app restates these ids in `apps/files/ui/src/commands.ts` rather
 * than importing them, for the reason that file's header gives about an app's
 * only coupling to its host being `@helve/bridge`. Two copies of a small table
 * is the price; the alternative is `apps/` reaching into `src/`.
 */
export const APP_COMMAND = {
  newFile: "file/new-file",
  save: "file/save",
  saveAs: "file/save-as",
  duplicate: "file/duplicate",
  delete: "file/delete",
  trash: "file/trash",
  undo: "edit/undo",
  redo: "edit/redo",
  cut: "edit/cut",
  copy: "edit/copy",
  paste: "edit/paste",
  find: "edit/find",
  replace: "edit/replace",
} as const;

/**
 * One family of menu items that act on something other than the shell itself.
 *
 * `blocked` answers both questions an item needs — whether to disable, and what
 * to say about why — from one call, so the two can never disagree. `run` is only
 * ever reached for a command `blocked` cleared.
 */
export interface CommandHandlers {
  run(command: string): void;
  /** `undefined` when the command can run now; otherwise the sentence to show. */
  blocked(command: string): string | undefined;
}

/** What the File menu's items that act on the *shell* do. */
export interface FileMenuHandlers {
  /** Open an empty window. `undefined` disables the item. */
  newWindow?: () => void;
  /**
   * Native folder picker, through Home's `home/open-project`.
   *
   * `undefined` when this window has no cluster to open a project *into* —
   * every cluster in it has been closed. A project belongs to a cluster, so
   * with none there is nowhere for the answer to go, and the backend refuses
   * the call for exactly that reason. Better to say so on the item than to
   * raise a picker whose result has nowhere to land.
   */
  openProject?: () => void;
  /**
   * Show Home, whose Recent list is the real thing being asked for.
   *
   * `undefined` when there is no cluster to show it in. `MenuItem` has no
   * submenu, and the handoff is explicit that faking one is not an option; this
   * is the other branch it offers. See the note on the item itself.
   */
  openRecent?: () => void;
  closeWindow(): void;
}

/** The View menu. Almost all of it is `WindowRoot`'s own state. */
export interface ViewMenuHandlers {
  commandPalette(): void;
  panelCollapsed: boolean;
  togglePanel(): void;
  /** Whether the panel is open *and* showing a terminal rather than the worktree. */
  terminalShowing: boolean;
  toggleTerminal(): void;
  fullscreen: boolean;
  toggleFullscreen(): void;
  zoomIn(): void;
  zoomOut(): void;
  /**
   * Why zoom cannot go further in each direction, or `undefined`.
   *
   * Two fields rather than one, because the two ends of the ladder are reached
   * separately: at 250% Zoom In is done and Zoom Out is not. They also carry
   * the "there is no webview here" case, which blocks both.
   */
  zoomInBlocked?: string;
  zoomOutBlocked?: string;
}

/** What the Terminal menu's four items act on. */
export interface TerminalMenuHandlers {
  onNew: () => void;
  onSplit: () => void;
  onKill: () => void;
  onClear: () => void;
  /** False when there's no session to act on — the worktree tab is active,
   *  or (momentarily) every terminal has closed. Split/Kill/Clear disable;
   *  New Terminal never needs a session, so it stays live regardless. */
  enabled: boolean;
}

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

/** Everything the five wired menus act on. */
export interface MenuHandlers {
  /** File items that go to the active app frame as a menu command. */
  app: CommandHandlers;
  /** Edit items, which go to the app frame *or* to a focused shell field. */
  edit: CommandHandlers;
  apps: AppsMenuHandlers;
  file: FileMenuHandlers;
  view: ViewMenuHandlers;
  terminal: TerminalMenuHandlers;
}

/**
 * All six menus. File, Edit, View and Terminal operate the app; Run and Help
 * are still scaffolding.
 *
 * ## Accelerators are bound, and that is a change
 *
 * This file used to say "accelerators are displayed only". It no longer does.
 * Every accelerator that appears below is one the keystroke actually performs,
 * by one of two routes:
 *
 *   - `keys/useKeyboard.ts` binds it. That is the File and View menus, and
 *     Terminal's two.
 *   - **The focused text surface already binds it.** That is the whole Edit
 *     menu: Ctrl+Z, Ctrl+X, Ctrl+F and the rest are Monaco's own keybindings
 *     inside the Files iframe, and the browser's inside a shell `<input>`. A
 *     second binding in `useKeyboard` would be the shell racing the surface the
 *     user is typing in for a key that already works — the exact failure that
 *     hook's header was written to avoid.
 *
 * Anything that could be neither is not shown. New Window has no accelerator
 * because it has no action; Kill Terminal and Clear lost theirs because Ctrl+K
 * belongs to `SearchSlot`, and the rule is bind it or drop it.
 *
 * They are also Windows glyphs now — `Ctrl+N`, not `⌘N`. This is a Windows-only
 * app and the Mac forms were never anything but decoration.
 *
 * Run and Help keep both their inert items and their Mac glyphs, deliberately:
 * they are out of this work's scope and were to be left exactly as they are.
 */
export function defaultMenus(handlers: MenuHandlers): Menu[] {
  const { app, edit, apps, file, view, terminal } = handlers;

  /** One File/Edit row, disabled with an explanation when it cannot act. */
  const command = (
    label: string,
    handlers: CommandHandlers,
    id: string,
    extra?: Partial<Menu["items"][number]>,
  ): Menu["items"][number] => {
    const hint = handlers.blocked(id);
    return {
      label,
      onSelect: () => handlers.run(id),
      disabled: hint !== undefined,
      hint,
      ...extra,
    };
  };

  return [
    {
      label: "File",
      items: [
        command("New File", app, APP_COMMAND.newFile, { accelerator: "Ctrl+N" }),
        {
          // This was disabled, with a hint saying the build had no way to open a
          // second window — true when a window label was derived from the tool
          // inside it, so a window could only ever be made by taking a tab out
          // of another one. Labels are opaque now and `windows::create` opens a
          // window on its own terms, so the item does what it says.
          label: "New Window",
          onSelect: file.newWindow,
          disabled: file.newWindow === undefined,
          hint: file.newWindow === undefined ? "This window cannot open another." : undefined,
        },
        {
          label: "Open…",
          accelerator: "Ctrl+O",
          onSelect: file.openProject,
          disabled: file.openProject === undefined,
          hint:
            file.openProject === undefined
              ? "A project opens into a cluster, and this window has none. Make one with the + in the bar."
              : undefined,
        },
        {
          // `MenuItem` has no submenu, and the handoff forbids faking one. Of
          // the two branches it offers, this is the second: the item shows
          // Home, whose Recent list is the real, complete answer — with the
          // folder's path, when it was last opened, whether it is still there,
          // and a way to forget it. A submenu could carry at most the names.
          label: "Open Recent",
          onSelect: file.openRecent,
          disabled: file.openRecent === undefined,
          hint:
            file.openRecent === undefined
              ? "There is no cluster in this window to show Home in."
              : "Opens Home, which lists every recent project.",
        },
        command("Save", app, APP_COMMAND.save, {
          accelerator: "Ctrl+S",
          separatorBefore: true,
        }),
        command("Save As…", app, APP_COMMAND.saveAs, { accelerator: "Ctrl+Shift+S" }),
        command("Duplicate", app, APP_COMMAND.duplicate, {
          accelerator: "Ctrl+D",
          separatorBefore: true,
        }),
        command("Delete", app, APP_COMMAND.delete),
        command("Trash", app, APP_COMMAND.trash),
        {
          label: "Close Window",
          accelerator: "Ctrl+Shift+W",
          separatorBefore: true,
          onSelect: file.closeWindow,
        },
      ],
    },
    {
      label: "Edit",
      items: [
        command("Undo", edit, APP_COMMAND.undo, { accelerator: "Ctrl+Z" }),
        command("Redo", edit, APP_COMMAND.redo, { accelerator: "Ctrl+Y" }),
        command("Cut", edit, APP_COMMAND.cut, { accelerator: "Ctrl+X", separatorBefore: true }),
        command("Copy", edit, APP_COMMAND.copy, { accelerator: "Ctrl+C" }),
        command("Paste", edit, APP_COMMAND.paste, { accelerator: "Ctrl+V" }),
        command("Find", edit, APP_COMMAND.find, { accelerator: "Ctrl+F", separatorBefore: true }),
        command("Replace", edit, APP_COMMAND.replace, { accelerator: "Ctrl+H" }),
      ],
    },
    // Not built here. `appsMenu` above is the one definition, shared with the
    // switcher row's add-app button — see its comment.
    appsMenu(apps),
    {
      label: "View",
      items: [
        { label: "Command Palette…", accelerator: "Ctrl+Shift+P", onSelect: view.commandPalette },
        // The three toggles say which way they will go rather than reading
        // "Toggle …", so the menu answers "is the panel open?" without the user
        // having to close it to find out.
        {
          label: view.panelCollapsed ? "Show Secondary Panel" : "Hide Secondary Panel",
          accelerator: "Ctrl+B",
          separatorBefore: true,
          onSelect: view.togglePanel,
        },
        {
          label: view.terminalShowing ? "Hide Terminal" : "Show Terminal",
          accelerator: "Ctrl+`",
          onSelect: view.toggleTerminal,
        },
        {
          label: view.fullscreen ? "Exit Full Screen" : "Enter Full Screen",
          accelerator: "F11",
          separatorBefore: true,
          onSelect: view.toggleFullscreen,
        },
        {
          label: "Zoom In",
          accelerator: "Ctrl+=",
          onSelect: view.zoomIn,
          disabled: view.zoomInBlocked !== undefined,
          hint: view.zoomInBlocked,
        },
        {
          label: "Zoom Out",
          accelerator: "Ctrl+-",
          onSelect: view.zoomOut,
          disabled: view.zoomOutBlocked !== undefined,
          hint: view.zoomOutBlocked,
        },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Run Active Tool", accelerator: "⌘R" },
        { label: "Stop", accelerator: "⌃C", separatorBefore: true },
        { label: "Re-run Last", accelerator: "⇧⌘R", separatorBefore: true },
      ],
    },
    {
      label: "Terminal",
      items: [
        // Ctrl+Shift+` rather than Ctrl+`, which View's Show/Hide Terminal now
        // holds — one key cannot mean both "reveal the panel" and "open another
        // pty", and VS Code splits them the same way round.
        { label: "New Terminal", accelerator: "Ctrl+Shift+`", onSelect: terminal.onNew },
        {
          label: "Split Terminal",
          accelerator: "Ctrl+\\",
          onSelect: terminal.onSplit,
          disabled: !terminal.enabled,
        },
        {
          label: "Kill Terminal",
          separatorBefore: true,
          onSelect: terminal.onKill,
          disabled: !terminal.enabled,
        },
        // No accelerator: this used to claim ⌘K, which `SearchSlot` binds to
        // open the search field. Two handlers for one key is the failure
        // `useKeyboard.ts`'s header exists to prevent, and search was there
        // first — so the display goes rather than the binding.
        { label: "Clear", onSelect: terminal.onClear, disabled: !terminal.enabled },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Documentation" },
        { label: "Keyboard Shortcuts" },
        { label: "Report Issue", separatorBefore: true },
        { label: "About HELVE Engine", separatorBefore: true },
      ],
    },
  ];
}
