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

/** Which of the panel's views is on screen. A union rather than a boolean so a
 *  third view is a case to handle rather than a rewrite. */
export type PanelView = "worktree" | "github";

const VIEW_LABEL: Record<PanelView, string> = {
  worktree: "Source Control",
  github: "GitHub",
};

export interface SecondaryPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** The cluster's branch, named by the collapsed strip. Absent draws nothing. */
  branch?: string | null;
  /** Another parcel fills this. Undefined renders nothing, not a placeholder. */
  worktreeView?: ReactNode;
  /** The GitHub view, filled the same way. A window given neither view gets a
   *  header with no name in it, which is a state nothing constructs. */
  githubView?: ReactNode;
  view: PanelView;
  onSelectView: (view: PanelView) => void;
}

export default function SecondaryPanel({
  collapsed,
  onToggleCollapse,
  branch,
  worktreeView,
  githubView,
  view,
  onSelectView,
}: SecondaryPanelProps) {
  if (collapsed) {
    return <CollapsedStrip branch={branch} onToggleCollapse={onToggleCollapse} />;
  }

  // Only the views this window was actually handed. Checked rather than
  // assumed: a name in the header that switches to nothing is worse than one
  // name and no switcher.
  const available: PanelView[] = [
    ...(worktreeView ? (["worktree"] as const) : []),
    ...(githubView ? (["github"] as const) : []),
  ];
  const active = available.includes(view) ? view : (available[0] ?? view);

  return (
    <div className="panel">
      {/* The list of views the note here used to promise, now that there is a
          second one to list. Deliberately not the segmented tab row that left
          with the terminals: that scrolled and pinned groups for an unbounded
          number of tabs, and this has two and will have few. With one view it
          falls back to a plain title, so a window given only source control
          looks exactly as it did before this existed. */}
      <div className="panel__head">
        {available.length < 2 ? (
          <span className="panel__headtitle">{VIEW_LABEL[active]}</span>
        ) : (
          <div className="panel__views" role="tablist" aria-label="Panel view">
            {available.map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === active}
                className={`panel__view${candidate === active ? " panel__view--on" : ""}`}
                onClick={() => onSelectView(candidate)}
              >
                {VIEW_LABEL[candidate]}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="panel__collapsebtn"
          onClick={onToggleCollapse}
          aria-label="Collapse panel"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Both mounted, one hidden — the arrangement the two-slot body used to
          have for terminals, brought back for the same kind of reason. The
          GitHub view holds a filter somebody has typed and a list fetched over
          the network, and unmounting it on every switch would discard both and
          spend a GitHub request coming back. There it was a scrollback; here it
          is a quota. */}
      <div className="panel__body" hidden={active !== "worktree"}>
        {worktreeView ?? null}
      </div>
      <div className="panel__body" hidden={active !== "github"}>
        {githubView ?? null}
      </div>
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
