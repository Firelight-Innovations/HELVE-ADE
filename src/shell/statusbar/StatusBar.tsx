import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { EngineState, GitStatus } from "../contract";
import { ENGINE_LABEL, ENGINE_TOKEN } from "../contract";
import { Sliders } from "../../ui/Icon";
import SettingsPopover from "./SettingsPopover";
import "./statusbar.css";

export interface StatusBarProps {
  engine: EngineState;
  /**
   * One status, read for both the branch line and the diff-stat readout
   * beside it — the same handle the source-control view reads, cluster-scoped
   * (see `useGitStatus` in `WindowRoot.tsx`). `null` renders neither slot: no
   * repository for the active cluster, or the fetch has not landed yet.
   */
  git: GitStatus | null;
  githubOk: boolean;
}

/**
 * Left to right: engine status, a spacer, the branch line, the diff-stat
 * readout, GitHub status, then settings. The bar's own height is
 * `.frame__statusbar`'s — this component only lays out its contents and never
 * touches that box.
 *
 * Settings is the shell's only entry point for it: there is no left rail,
 * and settings moved here when the rail was removed.
 */
export default function StatusBar({ engine, git, githubOk }: StatusBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement>(null);

  // Dismiss like every other popover in the shell: a click outside, or Escape.
  useEffect(() => {
    if (!settingsOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!settingsWrapRef.current?.contains(e.target as Node)) setSettingsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  return (
    <div className="statusbar">
      <div className="statusbar__engine">
        <span className="statusbar__dot" style={{ background: ENGINE_TOKEN[engine] }} />
        <span className="statusbar__label">{ENGINE_LABEL[engine]}</span>
      </div>

      <div className="statusbar__spacer" />

      {git !== null && <span className="statusbar__branch">{branchText(git)}</span>}

      {git !== null && filesTouched(git) > 0 && <DiffStat status={git} />}

      <div className="statusbar__github">
        {/* The handoff only draws GitHub healthy (--ok). --err is this
            component's own extrapolation for `githubOk === false` — the
            spec has no failure-state crop for this dot to check against. */}
        <span
          className="statusbar__dot"
          style={{ background: githubOk ? "var(--ok)" : "var(--err)" }}
        />
        <span className="statusbar__label">GitHub</span>
      </div>

      <div className="statusbar__settings-wrap" ref={settingsWrapRef}>
        <button
          type="button"
          className="statusbar__settings"
          aria-expanded={settingsOpen}
          aria-label="Settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Sliders size={14} knobFill="var(--surface)" />
        </button>
        <AnimatePresence>{settingsOpen && <SettingsPopover />}</AnimatePresence>
      </div>
    </div>
  );
}

/**
 * `main · ↑1 ↓0` — the spec's exact separator (a middle dot, not a pipe) and
 * arrows, confirmed verbatim against the handoff crop. The arrows are not
 * separately coloured there, so this stays one plain-text run rather than
 * wrapping them in their own span.
 *
 * The handoff doesn't draw the no-upstream case. `ahead`/`behind` have no way
 * to say "no upstream" distinctly from "even with it" (see the doc comment on
 * `Worktree` in contract.ts) — this treats zero-and-zero as no upstream and
 * prints the bare branch name, on the read that a branch evenly caught up
 * with its remote is the less useful thing to call out in a status bar.
 */
function branchText(status: { branch: string; ahead: number; behind: number }): string {
  if (status.ahead === 0 && status.behind === 0) return status.branch;
  return `${status.branch} · ↑${status.ahead} ↓${status.behind}`;
}

/**
 * How many distinct files this status touches, for the diff-stat readout's
 * `· M files`.
 *
 * Not `staged.length + unstaged.length`: a file that is staged and then
 * edited again appears once in each list (see the doc comment on
 * `GitFileChange` in `contract.ts`), and counting it twice would make this
 * number disagree with what `git status` itself would call one changed file.
 * The de-dupe is by `path` — the field every `GitFileChange` command takes
 * back as an argument, and so the one guaranteed to identify "the same file"
 * across both lists.
 */
function filesTouched(status: GitStatus): number {
  return new Set([...status.staged, ...status.unstaged].map((f) => f.path)).size;
}

/**
 * `+142 -63 · 9 files` — additions and deletions in the same green/red the
 * spec's token table already assigns an added/deleted file (`--ok`/`--err`
 * in tokens.css), the file count left in the bar's ordinary dim text rather
 * than a third colour. Coloured inline, the same way the engine and GitHub
 * dots above set their own `background` — this is the one other place in the
 * bar a value picks its own colour instead of taking the row's.
 *
 * Only ever mounted by the caller once `filesTouched(status) > 0` — a status
 * bar is not the place to spend width saying "no changes".
 */
function DiffStat({ status }: { status: GitStatus }) {
  const files = filesTouched(status);
  return (
    <span className="statusbar__diffstat">
      <span style={{ color: "var(--ok)" }}>+{status.insertions}</span>{" "}
      <span style={{ color: "var(--err)" }}>-{status.deletions}</span>
      <span className="statusbar__diffstat-files">
        {" "}
        · {files} {files === 1 ? "file" : "files"}
      </span>
    </span>
  );
}
