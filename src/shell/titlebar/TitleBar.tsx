/**
 * The title bar — logo, eight menus (or their hamburger collapse), the
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

/**
 * All eight menus, with plausible items. Every `onSelect` is left undefined —
 * the handoff's only requirement is that all eight open and render their
 * tree, not that they do anything yet.
 */
export function defaultMenus(): Menu[] {
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
      label: "Selection",
      items: [
        { label: "Select All", accelerator: "⌘A" },
        { label: "Expand Selection", accelerator: "⇧⌥→" },
        { label: "Shrink Selection", accelerator: "⇧⌥←" },
        { label: "Add Cursor Above", accelerator: "⌥⌘↑", separatorBefore: true },
        { label: "Add Cursor Below", accelerator: "⌥⌘↓" },
        { label: "Select Line", accelerator: "⌘L", separatorBefore: true },
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
      label: "Go",
      items: [
        { label: "Go to File…", accelerator: "⌘P" },
        { label: "Go to Line…", accelerator: "⌃G" },
        { label: "Back", accelerator: "⌃-", separatorBefore: true },
        { label: "Forward", accelerator: "⌃⇧-" },
        { label: "Go to Tool…", separatorBefore: true },
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
        { label: "New Terminal", accelerator: "⌃`" },
        { label: "Split Terminal", accelerator: "⌘\\" },
        { label: "Kill Terminal", separatorBefore: true },
        { label: "Clear", accelerator: "⌘K" },
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
