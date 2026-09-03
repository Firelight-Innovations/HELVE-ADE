/**
 * The project title bar (PRD §12.1, WIREFRAME-EXTRACT.md §1.1).
 *
 * The shell's real window chrome already draws a title bar of its own
 * (`src/shell/`) — this one is Schematify's own copy of the wireframe's
 * strings, drawn inside this app's iframe exactly as PRD §17 Wave 2 asks for.
 * See `docs/overnight-jobs/overnight-2/handoffs/w2-shell.md` for why that
 * duplication is left as-is rather than resolved this wave.
 *
 * `project`, `path`, `branch`, and `uncommittedCount` are props rather than
 * fixture reads, so a later wave can pass the shell's own state in without
 * touching this file — see PRD §12.1: "The count string shows when the count
 * is above 0 and hides at 0."
 */
export interface TitleBarProps {
  project: string;
  path: string;
  branch: string;
  uncommittedCount: number;
}

export function TitleBar({ project, path, branch, uncommittedCount }: TitleBarProps) {
  const uncommitted = uncommittedCount > 0 ? ` · ${uncommittedCount} uncommitted` : "";

  return (
    <div className="kv-titlebar">
      <span className="kv-titlebar__project">{project}</span>
      <span className="kv-titlebar__path">
        {path} · {branch}
        {uncommitted}
      </span>
      <span className="kv-titlebar__controls" aria-hidden="true">
        <span>–</span>
        <span>□</span>
        <span>✕</span>
      </span>
    </div>
  );
}
