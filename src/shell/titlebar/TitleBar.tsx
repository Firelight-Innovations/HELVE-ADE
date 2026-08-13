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
import type { Menu, WindowKind } from "../contract";
import { BrandGlyph } from "../../ui/Icon";
import MenuBar from "./MenuBar";
import HamburgerMenu from "./HamburgerMenu";
import WindowControls from "./WindowControls";
import { useNarrowTitlebar } from "./useNarrowTitlebar";
import "./titlebar.css";

export default function TitleBar({
  kind,
  title,
  menus,
}: {
  kind: WindowKind;
  title: string;
  /** Built by `defaultMenus()`, typically with the Terminal menu's four
   *  items wired against `WindowRoot`'s own terminal handlers. */
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
          there is no collision-avoidance logic to look for here. */}
      <div className="titlebar__title">
        HELVE Engine — <span className="titlebar__title-name">{title}</span>
      </div>

      <div className="titlebar__spacer" />

      <WindowControls />
    </div>
  );
}

/** What the Terminal menu's four items act on. Optional — a caller with
 *  nothing to wire yet (there is none today) gets the same inert items the
 *  other five menus still have. */
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
 * All six menus, with plausible items. Every `onSelect` except the
 * Terminal menu's is left undefined — the handoff's only requirement for
 * the other five is that they open and render their tree, not that they do
 * anything yet. The Terminal menu's four items are the one place that's no
 * longer true: New Terminal, Split Terminal, Kill Terminal, and Clear are
 * real controls now, wired against whatever `WindowRoot` passes as
 * `terminal`.
 */
export function defaultMenus(terminal?: TerminalMenuHandlers): Menu[] {
  return [
    {
      label: "File",
      items: [
        { label: "New File", accelerator: "⌘N" },
        { label: "New Window", accelerator: "⇧⌘N" },
        { label: "Open…", accelerator: "⌘O" },
        { label: "Open Recent" },
        { label: "Save", accelerator: "⌘S", separatorBefore: true },
        { label: "Save As…", accelerator: "⇧⌘S" },
        { label: "Close Window", accelerator: "⇧⌘W", separatorBefore: true },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", accelerator: "⌘Z" },
        { label: "Redo", accelerator: "⇧⌘Z" },
        { label: "Cut", accelerator: "⌘X", separatorBefore: true },
        { label: "Copy", accelerator: "⌘C" },
        { label: "Paste", accelerator: "⌘V" },
        { label: "Find", accelerator: "⌘F", separatorBefore: true },
        { label: "Replace", accelerator: "⇧⌘F" },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette…", accelerator: "⇧⌘P" },
        { label: "Toggle Secondary Panel", accelerator: "⌘B", separatorBefore: true },
        { label: "Toggle Terminal", accelerator: "⌃`" },
        { label: "Toggle Full Screen", accelerator: "⌃⌘F", separatorBefore: true },
        { label: "Zoom In", accelerator: "⌘+" },
        { label: "Zoom Out", accelerator: "⌘-" },
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
        // Accelerators are displayed only — wiring them live is
        // `useKeyboard.ts`'s job and a separate piece of work; this menu
        // item firing on click is independent of whether ⌃` also does.
        { label: "New Terminal", accelerator: "⌃`", onSelect: terminal?.onNew },
        { label: "Split Terminal", accelerator: "⌘\\", onSelect: terminal?.onSplit, disabled: !terminal?.enabled },
        {
          label: "Kill Terminal",
          separatorBefore: true,
          onSelect: terminal?.onKill,
          disabled: !terminal?.enabled,
        },
        { label: "Clear", accelerator: "⌘K", onSelect: terminal?.onClear, disabled: !terminal?.enabled },
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
