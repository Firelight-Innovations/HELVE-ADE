import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { EngineState } from "../contract";
import { ENGINE_LABEL, ENGINE_TOKEN } from "../contract";
import { Sliders } from "../../ui/Icon";
import SettingsPopover from "./SettingsPopover";
import "./statusbar.css";

export interface StatusBarProps {
  engine: EngineState;
  /** `null` renders nothing in the branch slot — no worktree attached. */
  branch: { name: string; ahead: number; behind: number } | null;
  githubOk: boolean;
}

/**
 * Left to right: engine status, a spacer, the branch line, GitHub status,
 * then settings. The bar's own height is `.frame__statusbar`'s — this
 * component only lays out its contents and never touches that box.
 *
 * Settings is the shell's only entry point for it: there is no left rail,
 * and settings moved here when the rail was removed.
 */
export default function StatusBar({ engine, branch, githubOk }: StatusBarProps) {
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

      {branch !== null && <span className="statusbar__branch">{branchText(branch)}</span>}

      <div className="statusbar__github">
        {/* The handoff only draws GitHub healthy (--ok). --err is this
            component's own extrapolation for `githubOk === false` — the
            spec has no failure-state crop for this dot to check against. */}
        <span className="statusbar__dot" style={{ background: githubOk ? "var(--ok)" : "var(--err)" }} />
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
function branchText(branch: { name: string; ahead: number; behind: number }): string {
  if (branch.ahead === 0 && branch.behind === 0) return branch.name;
  return `${branch.name} · ↑${branch.ahead} ↓${branch.behind}`;
}
