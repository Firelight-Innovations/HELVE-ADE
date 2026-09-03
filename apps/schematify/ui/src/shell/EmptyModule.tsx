/**
 * The Module Schematic's first-run empty state (PRD §12.20, §17 Wave 5):
 * "SAME CANVAS, EMPTY — FIRST RUN," with 3 pre-seeded, dashed placeholder
 * cards so the shape of a module is obvious before anyone has filled one in.
 *
 * Not the default view: `App.tsx` opens the populated Module Schematic for
 * `token-verifier` per this wave's own acceptance conditions — reachable
 * with `?view=empty-module` for a human to look at, the same convention
 * `EmptyStack.tsx` already established for `?view=empty-stack`. Every
 * control below is drawn disabled: seeding a real first facet needs a
 * semantic write this wave's seam does not yet make (`schematify_write_node`
 * lands with a later wiring wave), the same reasoning `EmptyStack.tsx`
 * already gives for its own disabled action.
 */
const LEAD = "A module is one unit of implementable work.";
const BODY =
  "It carries a public contract, the test cases that cover it, resource budgets with probes, and the libraries it may use. Three facets are pre-seeded so the shape is obvious.";
const BOUNDARY_NOTE =
  "User-facing behaviour, flows and wireframes belong in Journeyman. Forger references them; it does not hold them.";

const PLACEHOLDERS = [
  { kind: "CONTRACT-METHOD", placeholder: "name the first method…" },
  { kind: "TEST-CASE", placeholder: "given / when / then…" },
  { kind: "BUDGET", placeholder: "metric, threshold, probe…" },
] as const;

export function EmptyModule() {
  return (
    <div className="kv-empty-module">
      <div className="kv-empty-module__heading">SAME CANVAS, EMPTY — FIRST RUN</div>
      <p className="kv-empty-module__lead">{LEAD}</p>
      <p className="kv-empty-module__body">{BODY}</p>

      <div className="kv-empty-module__cards">
        {PLACEHOLDERS.map((card) => (
          <div key={card.kind} className="kv-empty-module__card">
            <div className="kv-empty-module__card-kind">{card.kind}</div>
            <div className="kv-empty-module__card-placeholder">{card.placeholder}</div>
          </div>
        ))}
      </div>

      <div className="kv-empty-module__boundary">
        <div className="kv-empty-module__boundary-heading">◈ NOT HERE</div>
        <p className="kv-empty-module__boundary-body">{BOUNDARY_NOTE}</p>
      </div>
    </div>
  );
}
