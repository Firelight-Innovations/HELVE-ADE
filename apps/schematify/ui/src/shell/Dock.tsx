/**
 * The bottom dock frame (PRD §12.1): 4 tabs at the stated 196 px height.
 * `Problems` is wave 7b's own content (PRD §12.14, S-13); `Runs` is this
 * wave's (PRD §12.2 S-14) — see `./RunsPanel.tsx`. The library and rule
 * `Registries` and `Rules` are Wave 8's, still drawn as the frame's own
 * placeholder text, unchanged from Wave 2.
 *
 * **The collapse toggle.** PRD §12.1: "The dock collapses to a status strip,
 * and both badges stay visible on that strip." No wireframe screen draws the
 * collapsed state or names its trigger (WIREFRAME-EXTRACT.md's 6 screens are
 * all drawn "problems open") — the chevron button and the default-expanded
 * state are `[P]`, recorded in the wave 7b handoff. The 2 badges live in the
 * tab row itself, outside the block `collapsed` hides, so collapsing can
 * never take them with it — this is the acceptance condition "both badges
 * stay visible on the collapsed strip", true by construction rather than by
 * a runtime check this app's DOM-free test suite has no way to make.
 */
import { useState } from "react";
import { problemBadges, type Finding, type RunsRow } from "../graph";
import { ProblemsPanel } from "./ProblemsPanel";
import { RunsPanel } from "./RunsPanel";

const TABS = ["Problems", "Runs", "Registries", "Rules"] as const;
type DockTab = (typeof TABS)[number];

export interface DockProps {
  /** `null` while the first `schematify/lint` call is in flight. */
  findings?: Finding[] | null;
  error?: string | null;
  /** Called with the finding a Problems row was clicked on. Omitted draws
   *  every row inert. */
  onSelectFinding?: (finding: Finding) => void;
  /** `null` while the first `schematify/runs` call is in flight. */
  runs?: RunsRow[] | null;
  runsError?: string | null;
  /** Called with the module id a Runs row was clicked on. Omitted draws
   *  every row inert. */
  onSelectRun?: (moduleId: string) => void;
}

export function Dock({
  findings = null,
  error = null,
  onSelectFinding,
  runs = null,
  runsError = null,
  onSelectRun,
}: DockProps) {
  const [tab, setTab] = useState<DockTab>("Problems");
  const [collapsed, setCollapsed] = useState(false);
  // `null`, not `problemBadges(findings ?? [])` — the latter draws a
  // guessed `0`/`0` both while the first `schematify/lint` call is in
  // flight and forever on failure, the exact "invented zero" shape flagged
  // in review against wave 7b's own version of this line. Blank until real
  // data lands, the same `findings ? … : ""` convention `StatusBar.tsx`'s
  // cell 3 already uses.
  const badges = findings ? problemBadges(findings) : null;

  return (
    <div className={`kv-dock${collapsed ? " kv-dock--collapsed" : ""}`}>
      <div className="kv-dock__tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === tab}
            className={`kv-dock__tab${entry === tab ? " kv-dock__tab--active" : ""}`}
            onClick={() => setTab(entry)}
          >
            {entry}
            {entry === "Problems" ? (
              <span className="kv-dock__badges">
                <span className="kv-dock__badge kv-dock__badge--error">{badges?.errors ?? ""}</span>
                <span className="kv-dock__badge kv-dock__badge--warn">
                  {badges?.warnings ?? ""}
                </span>
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className="kv-dock__collapse"
          aria-label={collapsed ? "Expand the dock" : "Collapse the dock"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "▴" : "▾"}
        </button>
      </div>
      {collapsed ? null : (
        <>
          <div className="kv-dock__note">Errors first · never hidden</div>
          {tab === "Problems" ? (
            <ProblemsPanel findings={findings} error={error} onSelect={onSelectFinding} />
          ) : tab === "Runs" ? (
            <RunsPanel runs={runs} error={runsError} onSelect={onSelectRun} />
          ) : (
            <p className="kv-dock__placeholder">{tab} — Wave 8.</p>
          )}
        </>
      )}
    </div>
  );
}
