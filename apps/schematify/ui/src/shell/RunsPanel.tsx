/**
 * The Runs dock tab's own content (PRD §12.2, S-14: "Run number, timestamp,
 * commit, workflow file, ingest state"). No wireframe screen draws this
 * panel — WIREFRAME-EXTRACT.md's §8.1 table already lists S-14 among the
 * surfaces this build has no drawing for — so the column set and layout
 * below follow the exact 5 nouns S-14 names, in that order, the same
 * "simplest reading" rule `00-AGENT-CONTEXT.md` states for a silent source.
 *
 * Project-wide, not scoped to the currently open Schematic — the same choice
 * `ProblemsPanel` already made for the Problems tab (wave 7b), since a run
 * belongs to whichever module or service it was filed under, not to
 * whichever tier happens to be on screen.
 */
import { formatRunAt, type RunsRow } from "../graph";

export interface RunsPanelProps {
  /** `null` while the first `schematify/runs` call is in flight. */
  runs: readonly RunsRow[] | null;
  error: string | null;
  /** A run row names the module it was filed under; clicking it opens that
   *  module's dashboard. Omitted draws every row inert. */
  onSelect?: (moduleId: string) => void;
}

export function RunsPanel({ runs, error, onSelect }: RunsPanelProps) {
  if (error) {
    return <p className="kv-runs__error">{error}</p>;
  }
  if (runs === null) {
    return <p className="kv-runs__placeholder">Loading runs…</p>;
  }
  if (runs.length === 0) {
    return <p className="kv-runs__placeholder">No runs ingested yet.</p>;
  }

  return (
    <table className="kv-runs">
      <thead>
        <tr>
          <th>RUN</th>
          <th>MODULE</th>
          <th>WHEN</th>
          <th>COMMIT</th>
          <th>WORKFLOW</th>
          <th>INGEST STATE</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((row) => {
          const clickable = Boolean(onSelect);
          return (
            <tr
              key={`${row.module.id}-${row.run}`}
              className={clickable ? "kv-runs__row kv-runs__row--clickable" : "kv-runs__row"}
              onClick={clickable ? () => onSelect?.(row.module.id) : undefined}
            >
              <td className="kv-runs__run">#{row.run}</td>
              <td className="kv-runs__module">{row.module.title}</td>
              <td className="kv-runs__when">{formatRunAt(row.at)}</td>
              <td className="kv-runs__commit">{row.commit}</td>
              <td className="kv-runs__workflow">{row.workflow}</td>
              <td className="kv-runs__state">Ingested</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
