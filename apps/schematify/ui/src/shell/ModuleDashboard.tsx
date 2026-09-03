/**
 * The Module dashboard (PRD §12.13, S-12): "read-only record", 5 counters,
 * budget history, reconciliation, contract change history, the lifecycle
 * audit log. Every counter and column cell is read off `Dashboard`
 * (`src-tauri/src/apps/schematify.rs`'s `module_dashboard`), computed fresh
 * on every open — nothing here stores a count (PRD §0.4).
 *
 * **Nothing on this page is editable.** No `<input>`, `<button>` that
 * changes any project state, `<select>`, `<textarea>`, or `contentEditable`
 * element anywhere below — `onClose` is the one interactive control, and it
 * navigates away rather than writing anything. `noLiteralHex.test.ts` and
 * this app's own eslint config catch a literal hex color; nothing catches an
 * editable control by itself, so this is asserted by reading the render tree
 * in the wave 9d handoff rather than by a runtime check this app's DOM-free
 * test suite (`vitest.config.ts`: `environment: "node"`) has a way to make.
 */
import {
  auditActorCell,
  auditTransition,
  budgetLatestValue,
  budgetsCounter,
  budgetsNote,
  budgetThreshold,
  CONTRACT_HISTORY_FOOTNOTE,
  latestRunLine,
  linterCounter,
  linterNote,
  noProbeCaption,
  reconciliationCounter,
  reconciliationNote,
  referenceContractHistory,
  runsPathLine,
  shortDate,
  signOffCaption,
  testsCounter,
  testsNote,
  type BudgetHistoryRow,
  type Dashboard,
} from "../graph";

export interface ModuleDashboardProps {
  dashboard: Dashboard | null;
  error: string | null;
  /** Leaves the dashboard — this page has nothing else that acts. */
  onClose: () => void;
}

export function ModuleDashboard({ dashboard, error, onClose }: ModuleDashboardProps) {
  return (
    <div className="kv-dashboard">
      <div className="kv-dashboard__header">
        <div>
          <div className="kv-dashboard__breadcrumb">
            {dashboard ? `Stack › … › ${dashboard.module.title}` : "Module dashboard"}
          </div>
          <div className="kv-dashboard__badge">READ ONLY · THE RECORD OF WHAT HAPPENED</div>
          {dashboard ? <div className="kv-dashboard__path">{runsPathLine(dashboard)}</div> : null}
        </div>
        <button type="button" className="kv-dashboard__close" onClick={onClose}>
          ← Back
        </button>
      </div>

      {error ? <p className="kv-dashboard__error">{error}</p> : null}
      {!error && !dashboard ? <p className="kv-dashboard__placeholder">Loading…</p> : null}

      {dashboard ? <ModuleDashboardBody dashboard={dashboard} /> : null}
    </div>
  );
}

function ModuleDashboardBody({ dashboard }: { dashboard: Dashboard }) {
  const contractHistory = referenceContractHistory(dashboard.module.slug);

  return (
    <div className="kv-dashboard__body">
      <div className="kv-dashboard__latest-run">{latestRunLine(dashboard.latestRun)}</div>

      <div className="kv-dashboard__counters">
        <CounterCard
          label="BUDGETS"
          accent="error"
          value={budgetsCounter(dashboard.budgets)}
          note={budgetsNote(dashboard.budgets)}
        />
        <CounterCard
          label="TESTS"
          accent="error"
          value={testsCounter(dashboard.tests)}
          note={testsNote(dashboard.tests)}
        />
        <CounterCard
          label="LINTER"
          accent="ok"
          value={linterCounter(dashboard.linter)}
          note={linterNote(dashboard.linter)}
        />
        <CounterCard
          label="RECONCILIATION"
          accent="warn"
          value={reconciliationCounter(dashboard.reconciliation)}
          note={reconciliationNote(dashboard.reconciliation)}
        />
      </div>

      <section className="kv-dashboard__section">
        <h3>BUDGET HISTORY — THRESHOLD DRAWN, SO A TREND IS VISIBLE BEFORE IT BREACHES</h3>
        {dashboard.budgetHistory.length === 0 ? (
          <p className="kv-dashboard__placeholder">No budgets declared.</p>
        ) : (
          <div className="kv-dashboard__budgets">
            {dashboard.budgetHistory.map((row) => {
              const noProbe = noProbeCaption(row);
              const signOff = signOffCaption(row);
              return (
                <div key={row.metric} className="kv-dashboard__budget-row">
                  <div className="kv-dashboard__budget-head">
                    <span className="kv-dashboard__budget-metric">{row.metric}</span>
                    <span
                      className={`kv-dashboard__budget-tier kv-dashboard__budget-tier--${row.tier}`}
                    >
                      {row.tier.toUpperCase()}
                    </span>
                    <span className="kv-dashboard__budget-value">
                      {budgetLatestValue(row)} · {budgetThreshold(row)}
                    </span>
                  </div>
                  {noProbe ? (
                    <div className="kv-dashboard__budget-noprobe">
                      <div>{noProbe[0]}</div>
                      <div>{noProbe[1]}</div>
                    </div>
                  ) : (
                    <BudgetSparkline row={row} />
                  )}
                  {signOff ? <div className="kv-dashboard__budget-signoff">{signOff}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="kv-dashboard__columns">
        <section className="kv-dashboard__section">
          <h3>RECONCILIATION — GRAPH TWIN AT SYMBOL GRANULARITY</h3>
          <table className="kv-dashboard__table">
            <thead>
              <tr>
                <th>OUTCOME</th>
                <th>SITE</th>
                <th>COUNT</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.reconciliationRows.map((row) => (
                <tr key={row.outcome}>
                  <td>{row.outcome}</td>
                  <td className="kv-dashboard__site">{row.site}</td>
                  <td className="kv-dashboard__count">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="kv-dashboard__section">
          <h3>CONTRACT CHANGE HISTORY — WHAT TRIGGERS STALENESS DOWNSTREAM</h3>
          {contractHistory.length === 0 ? (
            <p className="kv-dashboard__placeholder">No contract change history recorded yet.</p>
          ) : (
            <>
              <table className="kv-dashboard__table">
                <tbody>
                  {contractHistory.map((row) => (
                    <tr key={row.when}>
                      <td className="kv-dashboard__when">{shortDate(row.when)}</td>
                      <td>{row.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kv-dashboard__footnote">{CONTRACT_HISTORY_FOOTNOTE}</p>
            </>
          )}
        </section>
      </div>

      <section className="kv-dashboard__section">
        <h3>LIFECYCLE AUDIT LOG — APPEND-ONLY</h3>
        {dashboard.auditLog.length === 0 ? (
          <p className="kv-dashboard__placeholder">No lifecycle transitions recorded yet.</p>
        ) : (
          <table className="kv-dashboard__table">
            <thead>
              <tr>
                <th>WHEN</th>
                <th>TRANSITION</th>
                <th>ACTOR</th>
                <th>REASON</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.auditLog.map((row, index) => (
                // `when` alone is not a stable key across rows sharing one
                // minute in a busier project; the transition text makes the
                // pair unique in the same way `ProblemsPanel`'s own
                // `${finding.subject}-${index}` key falls back to an index.
                <tr key={`${row.when}-${index}`}>
                  <td className="kv-dashboard__when">{shortDate(row.when)}</td>
                  <td>{auditTransition(row)}</td>
                  <td className="kv-dashboard__actor">{auditActorCell(row)}</td>
                  <td className="kv-dashboard__reason">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="kv-dashboard__footnote">
          No agent row in this log can read → accepted. That transition is human-only by
          construction.
        </p>
      </section>
    </div>
  );
}

function CounterCard({
  label,
  accent,
  value,
  note,
}: {
  label: string;
  accent: "error" | "ok" | "warn";
  value: string;
  note: string;
}) {
  return (
    <div className={`kv-dashboard__counter kv-dashboard__counter--${accent}`}>
      <div className="kv-dashboard__counter-label">{label}</div>
      <div className="kv-dashboard__counter-value">{value}</div>
      {note ? <div className="kv-dashboard__counter-note">{note}</div> : null}
    </div>
  );
}

/**
 * A single-point sparkline: this app's own reference fixture ingests exactly
 * 1 run per node (`crates/schematify-core/tests/fixtures.rs`:
 * `assert_eq!(runs.len(), 1)`), so a real multi-run trend line has nothing to
 * draw from yet — see `signOffCaption`'s own doc comment for the same limit
 * on the sign-off note. Draws the threshold as a labelled line and the one
 * measured value as a dot, both real numbers off `row`, computed at draw
 * time, never stored.
 */
function BudgetSparkline({ row }: { row: BudgetHistoryRow }) {
  const width = 620;
  const height = 96;
  const pad = 10;
  if (row.latestValue === null) {
    return <div className="kv-dashboard__budget-nodata">No measurement yet.</div>;
  }
  // The higher of the threshold and the measured value sets the scale, so
  // a passing budget never draws its own dot above the chart.
  const scaleMax = Math.max(row.threshold, row.latestValue) * 1.15;
  const y = (value: number) => height - pad - (value / scaleMax) * (height - 2 * pad);
  const thresholdY = y(row.threshold);
  const valueY = y(row.latestValue);
  const dotX = width - pad - 24;

  return (
    <svg
      className="kv-dashboard__sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${row.metric}: ${row.latestValue} ${row.unit}, threshold ${row.threshold} ${row.unit}`}
    >
      <line
        x1={pad}
        y1={thresholdY}
        x2={width - pad}
        y2={thresholdY}
        className="kv-dashboard__sparkline-threshold"
      />
      <text x={pad} y={thresholdY - 4} className="kv-dashboard__sparkline-threshold-label">
        {row.threshold} {row.unit} {row.tier}
      </text>
      <circle
        cx={dotX}
        cy={valueY}
        r={3.5}
        className={
          row.pass
            ? "kv-dashboard__sparkline-dot kv-dashboard__sparkline-dot--pass"
            : "kv-dashboard__sparkline-dot kv-dashboard__sparkline-dot--fail"
        }
      />
    </svg>
  );
}
