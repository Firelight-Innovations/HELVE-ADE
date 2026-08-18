/**
 * The secondary panel: source control, and a collapsed strip.
 *
 * This renders into `.frame__panel`, which already carries the panel's width,
 * its background, and the collapse animation (src/shell/frame/Frame.tsx,
 * frame.css) — nothing here repeats those, and nothing here sets a width.
 *
 * ## What left
 *
 * Terminals used to share this panel. Its row listed a tab per session plus a
 * `+` to make another, with the change list as one more segment at the end, and
 * the body swapped between the two. They are in the band under the tool window
 * now (`BottomPanel`), which is where a terminal wants to be: wide, short, and
 * across the bottom of the work rather than beside it.
 */
import { type ReactNode } from "react";
import { ChevronLeft, ChevronRight, GitBranch } from "../../ui/Icon";
import "./panel.css";

export interface SecondaryPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** The cluster's branch, named by the collapsed strip. Absent draws nothing. */
  branch?: string | null;
  /** Another parcel fills this. Undefined renders nothing, not a placeholder. */
  worktreeView?: ReactNode;
}

export default function SecondaryPanel({
  collapsed,
  onToggleCollapse,
  branch,
  worktreeView,
}: SecondaryPanelProps) {
  if (collapsed) {
    return <CollapsedStrip branch={branch} onToggleCollapse={onToggleCollapse} />;
  }

  return (
    <div className="panel">
      {/* A header rather than a tab row. It names what is below it and holds
          the one control the panel still has of its own. The row went with the
          terminals rather than staying behind, because a tab row with one tab
          in it is a control that can only ever be in one state. What is left is
          one view, so the panel shows it and says its name. */}
      <div className="panel__head">
        <span className="panel__headtitle">Source Control</span>
        <button
          type="button"
          className="panel__collapsebtn"
          onClick={onToggleCollapse}
          aria-label="Collapse panel"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Deliberately more room than source control currently fills. The panel
          is meant to grow other things beside it, and the shape it will need
          then is a list of views rather than the segmented row that just left —
          so this stops short of building a row for one view and calling it the
          pattern. */}
      <div className="panel__body">{worktreeView ?? null}</div>
    </div>
  );
}

/**
 * The 34px strip a collapsed panel leaves behind.
 *
 * It names the branch now, where it used to name whichever terminal was last
 * showing — the branch is what this panel is about, and it is the one thing
 * worth 34px of a window that has given the rest of them away.
 */
function CollapsedStrip({
  branch,
  onToggleCollapse,
}: {
  branch?: string | null;
  onToggleCollapse: () => void;
}) {
  return (
    <div className="panel panel__collapsed">
      <button
        type="button"
        className="panel__restorebtn"
        onClick={onToggleCollapse}
        aria-label="Restore panel"
      >
        <ChevronLeft />
      </button>
      <div className="panel__collapsed-branch">
        <GitBranch size={14} />
      </div>
      {branch && <div className="panel__collapsed-label">{branch}</div>}
    </div>
  );
}
