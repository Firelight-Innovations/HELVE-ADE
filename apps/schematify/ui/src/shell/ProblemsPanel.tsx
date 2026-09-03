/**
 * The Problems dock tab's own content (PRD §12.14, S-13): 4 columns
 * (`SEVERITY`, `RULE`, `NODE`, `LOCATION`), grouped by severity, click-through
 * to the offending node. Every cell is read off a `Finding` and nothing is
 * computed here beyond the severity glyph — see `graph/problems.ts`'s own
 * header for why that one is not "the panel inventing a cell".
 *
 * **Grouped by severity, not sorted here.** `schematify_core::lint` already
 * returns errors before warnings (PRD §12.14: "A user shall never scroll to
 * discover that an error exists") — this component draws `findings` in the
 * order it receives them and adds a `<tbody>` break only where the severity
 * actually changes, so a 2nd, disagreeing sort can never enter the picture.
 */
import { Fragment } from "react";
import {
  drillTargetForLocation,
  locationCell,
  severityGlyph,
  severityWord,
  type Finding,
} from "../graph";

export interface ProblemsPanelProps {
  /** `null` while the first `schematify/lint` call is in flight. */
  findings: Finding[] | null;
  error: string | null;
  /** Omitted draws every row inert, the same "no prop, no gesture"
   *  convention `Breadcrumb.tsx`'s own `onNavigate` uses. */
  onSelect?: (finding: Finding) => void;
}

export function ProblemsPanel({ findings, error, onSelect }: ProblemsPanelProps) {
  if (error) {
    return <p className="kv-problems__error">{error}</p>;
  }
  if (findings === null) {
    return <p className="kv-problems__placeholder">Linting…</p>;
  }
  if (findings.length === 0) {
    return <p className="kv-problems__placeholder">No problems found.</p>;
  }

  return (
    <table className="kv-problems">
      <thead>
        <tr>
          <th>SEVERITY</th>
          <th>RULE</th>
          <th>NODE</th>
          <th>LOCATION</th>
        </tr>
      </thead>
      <tbody>
        {findings.map((finding, index) => {
          // A severity-group break draws right before the first row of a
          // new severity — never before row 0, and never when the previous
          // row already carried the same severity. This is the "grouped by
          // severity" PRD §12.14 asks for, drawn from the backend's own
          // order rather than a 2nd sort.
          const startsGroup = index === 0 || findings[index - 1].severity !== finding.severity;
          const target = drillTargetForLocation(finding.location);
          const clickable = Boolean(onSelect) && target !== null;

          return (
            <Fragment key={`${finding.subject}-${index}`}>
              {startsGroup && index > 0 ? (
                <tr className="kv-problems__group-break" aria-hidden="true">
                  <td colSpan={4} />
                </tr>
              ) : null}
              <tr
                className={`kv-problems__row kv-problems__row--${finding.severity}${clickable ? " kv-problems__row--clickable" : ""}`}
                onClick={clickable ? () => onSelect?.(finding) : undefined}
              >
                <td className="kv-problems__severity">
                  {severityGlyph(finding.severity)} {severityWord(finding.severity)}
                </td>
                <td>{finding.ruleName}</td>
                <td className="kv-problems__node">{finding.nodeCell}</td>
                <td className="kv-problems__location">{locationCell(finding.location)}</td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
