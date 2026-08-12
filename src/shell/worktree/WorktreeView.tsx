/**
 * The worktree tab's body — plugs into `SecondaryPanel`'s `worktreeView` slot
 * (src/shell/panel/SecondaryPanel.tsx, `worktreeView?: ReactNode`). Renders
 * whatever the `WorktreeSource` reports: a branch row and its changed files,
 * or the no-worktree empty state.
 *
 * Measured against the handoff's "Worktree tab selected" and "Worktree tab,
 * repository with no worktree" crops (docs/handoffs/shell-spec.html, lines
 * ~213-249).
 *
 * PLACEHOLDER, NOT A REJECTION: the handoff (line 230, and again at line 463)
 * asks for an existing VS Code-style SCM list library rather than a
 * hand-rolled file list, but names none — the choice is explicitly still
 * open pending further design work. `ChangeRow` below is a small,
 * self-contained stand-in built directly against `WorktreeSource` so nothing
 * here blocks on that decision. It is deliberately kept tiny and dumb so it
 * can be swapped for a real SCM-list component later without touching
 * `WorktreeView`'s exported shape or anything above it in `SecondaryPanel`.
 *
 * No motion. The handoff's motion section is explicit that the worktree list
 * stays at native scroll speed: no `motion.*`, no `AnimatePresence`, no
 * `layout` prop, no animated reordering. Every element here is a plain
 * `<div>`/`<span>`/`<button>`.
 */
import { useEffect, useState } from "react";
import type { Worktree, WorktreeChange, WorktreeSource } from "../contract";
import { CHANGE_TOKEN } from "../contract";
import { GitBranch } from "../../ui/Icon";
import "./worktree.css";

export interface WorktreeViewProps {
  source: WorktreeSource;
  /** Inert unless supplied — the button renders either way. */
  onAddWorktree?: () => void;
}

export default function WorktreeView({ source, onAddWorktree }: WorktreeViewProps) {
  const [tree, setTree] = useState<Worktree | null>(null);

  useEffect(() => source.subscribe(setTree), [source]);

  if (!tree) {
    return <EmptyState onAddWorktree={onAddWorktree} />;
  }

  return (
    <div className="worktree">
      <BranchRow tree={tree} />
      <div className="worktree__changes">
        {tree.changes.map((change) => (
          <ChangeRow key={`${change.dir}/${change.file}`} change={change} />
        ))}
      </div>
    </div>
  );
}

/** The branch header: icon, branch name, a spacer, then the change count. */
function BranchRow({ tree }: { tree: Worktree }) {
  return (
    <div className="worktree__branch">
      <GitBranch size={13} />
      <span className="worktree__branch-name">{tree.branch}</span>
      <span className="worktree__branch-spacer" />
      <span className="worktree__branch-count">{tree.changes.length} changes</span>
    </div>
  );
}

/**
 * One changed-file row: the status letter, the file name, then the directory
 * as its own dimmer column — `WorktreeChange` already splits `file` and
 * `dir` for exactly this reason, so they are never concatenated back
 * together here. A deleted file's name is rendered in the dimmer `--text-dim`
 * rather than `--text`, matching the handoff's `legacy-bar.tsx` row.
 */
function ChangeRow({ change }: { change: WorktreeChange }) {
  const deleted = change.kind === "D";
  return (
    <div className="worktree__row">
      <span className="worktree__kind" style={{ color: CHANGE_TOKEN[change.kind] }}>
        {change.kind}
      </span>
      <span className={deleted ? "worktree__file worktree__file--deleted" : "worktree__file"}>{change.file}</span>
      <span className="worktree__dir">{change.dir}</span>
    </div>
  );
}

/** The no-worktree empty state. Every value here is lifted verbatim from the crop. */
function EmptyState({ onAddWorktree }: { onAddWorktree?: () => void }) {
  return (
    <div className="worktree__empty">
      <GitBranch size={28} strokeWidth={1.6} className="worktree__empty-glyph" />
      <div className="worktree__empty-title">No git worktree</div>
      <div className="worktree__empty-body">
        This project has no worktree attached. Add one to track changes alongside the active tool.
      </div>
      <button type="button" className="worktree__empty-button" onClick={onAddWorktree}>
        Add worktree
      </button>
    </div>
  );
}
