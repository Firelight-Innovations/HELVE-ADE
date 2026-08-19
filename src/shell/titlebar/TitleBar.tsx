/**
 * The title bar — logo, six menus (or their hamburger collapse), the centred
 * window title, and the three window controls.
 *
 * Every geometry number below is lifted from `docs/handoffs/shell-spec.html`
 * (search `>File<` and the `REFERENCE` table's Title bar row) rather than
 * chosen — see `titlebar.css`'s header comment for the one place that isn't.
 *
 * This component does not set the bar's height or background: `Frame` already
 * renders it into `.frame__titlebar`, which is 34px with the surface colour and
 * the bottom hairline. Setting either here would be two owners of one property.
 */
import type { Menu, WindowKind } from "../contract";
import { PRODUCT_NAME } from "../../branding.generated";
import { BrandGlyph } from "../../ui/Icon";
import MenuBar from "./MenuBar";
import HamburgerMenu from "./HamburgerMenu";
import WindowControls from "./WindowControls";
import { useNarrowTitlebar } from "./useNarrowTitlebar";
import "./titlebar.css";

export interface TitleBarProps {
  kind: WindowKind;
  /**
   * The **active cluster's** project name, or `null` when that cluster has none
   * — or when this window has no cluster at all. A project belongs to a cluster,
   * so this is what lets two windows name two projects at once. It comes from
   * `useClusterProject`, asked about whichever cluster this window is showing.
   */
  project: string | null;
  /**
   * The active cluster's worktree branch, or `null`.
   *
   * A **placeholder shape rather than a live value**: nothing populates
   * `Cluster.worktree` yet, so the segment is absent and the layout is right for
   * the day it is not. It used to draw `useGitStatus`'s branch — the checkout the
   * *stack manifest* resolved, which was never this cluster's worktree and only
   * looked like it while one project was in the process. Naming the wrong branch
   * beside the right project is worse than naming none, so it waits for the git work.
   */
  worktree: string | null;
  /**
   * Built by `defaultMenus()`, wired against `WindowRoot`'s state and the active
   * app frame. Rebuilt on every render, because half the items read live state —
   * Save disables when nothing is dirty, the toggles say which way they will go.
   */
  menus: Menu[];
}

/**
 * The title is two segments the tabs cannot show.
 *
 * The spec's title was "the product — [tool]", and that has been replaced: the
 * surface you are looking at is already named by the tab an arm's length below,
 * so repeating it here spent the most legible strip in the window on the one
 * fact nothing else could hide. What the tabs cannot say is *which project* and
 * *which checkout* — both change under you (Open Recent, a branch switched in a
 * terminal) and both decide what every other action in this window will touch.
 */
export default function TitleBar({ kind, project, worktree, menus }: TitleBarProps) {
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
          deliberately allowed to sit under the menu block or the window controls
          at narrow widths — the spec calls that out by name, so there is no
          collision-avoidance logic to look for here.

          A segment with no answer is dropped rather than drawn as a placeholder.
          With nothing open this reads as the product's name alone, which is
          true; "HELVE | — | —" would be three claims where there is one.

          It used to read "HELVE Engine", which was a different bug: the engine
          is a separate repository and this shell is not it. The name now comes
          from branding.toml through the generated module, so there is one place
          left that can be wrong. */}
      <div className="titlebar__title">
        <span>{PRODUCT_NAME}</span>
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
