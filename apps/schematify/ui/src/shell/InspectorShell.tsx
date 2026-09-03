/**
 * The Inspector shell — the panel frame and its 5-tab strip (PRD §12.12),
 * with no tab's content built yet. `Identity` through `References` (S-04
 * through S-11) are Wave 6 scope; this wave only reserves the 360 px column
 * and draws the tab labels the wireframe names.
 *
 * **Wave 5's one exception**: PRD §12.9 puts the Stack Schematic's own empty
 * state — `CANVAS PROPERTIES` plus the derived tech stack — in this same
 * panel, and names it as this wave's own acceptance item. It draws only when
 * nothing is selected on the Stack Schematic; a selection, or any other
 * tier, falls back to the tab-strip placeholder Wave 6 fills in.
 */
import { countEdges, countServices, computeDepth, type SchematicGraph } from "../graph";

const TABS = ["Identity", "Lifecycle", "Contract", "Tests", "More"] as const;

export interface InspectorShellProps {
  /** Omitted keeps the plain tab-strip placeholder — every caller before
   *  Wave 5 rendered `<InspectorShell />` with no props at all. */
  graph?: SchematicGraph;
  selectionCount?: number;
}

export function InspectorShell({ graph, selectionCount = 0 }: InspectorShellProps) {
  if (graph && graph.tier === "stack" && selectionCount === 0) {
    return <CanvasProperties graph={graph} />;
  }
  return (
    <div className="kv-inspector">
      <div className="kv-inspector__tabs" role="tablist">
        {TABS.map((tab, index) => (
          <span
            key={tab}
            className={`kv-inspector__tab${index === 0 ? " kv-inspector__tab--active" : ""}`}
            role="tab"
            aria-selected={index === 0}
          >
            {tab}
          </span>
        ))}
      </div>
      <p className="kv-inspector__placeholder">Inspector content — Wave 6.</p>
    </div>
  );
}

/** PRD §12.9's `CANVAS PROPERTIES` empty state, drawn when the Stack
 *  Schematic has no selection. Every number computed except the layout
 *  save time — no real timestamp exists yet this wave (`layoutDirty` tells
 *  clean/modified, not when), so the wireframe's own literal `4m ago` is
 *  kept as a placeholder rather than invented precision. `[P]`, recorded in
 *  the Wave 5 handoff. */
function CanvasProperties({ graph }: { graph: SchematicGraph }) {
  const services = countServices(graph);
  const edges = countEdges(graph);
  const depth = computeDepth(graph.nodes);
  return (
    <div className="kv-inspector kv-inspector--canvas-properties">
      <div className="kv-inspector__header">CANVAS PROPERTIES</div>
      <p className="kv-inspector__body">
        Nothing selected. The inspector shows canvas-level properties:{" "}
        {`${services} services, ${edges} dependency edges, containment depth ${depth}, layout saved 4m ago.`}
      </p>
      {graph.techStack && graph.techStack.length > 0 ? (
        <div className="kv-inspector__techstack">
          <div className="kv-inspector__header">DERIVED TECH STACK</div>
          <table className="kv-inspector__techstack-table">
            <tbody>
              {graph.techStack.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>
                    {row.version} · {row.license}
                  </td>
                  <td>{row.moduleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-inspector__footer">
            Read-only. Derived from per-module allowed_libraries against the registry.
          </p>
        </div>
      ) : null}
    </div>
  );
}
