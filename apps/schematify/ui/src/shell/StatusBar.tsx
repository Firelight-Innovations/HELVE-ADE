/**
 * The status bar (PRD §12.1, §17 Wave 2): 5 cells on the Service Schematic.
 * Cell 1 and cell 2 draw as of Wave 2/3, computed from the graph. Cell 3
 * (errors and warnings) is wave 7b's own, read off the same `schematify/lint`
 * answer the Problems panel draws. Cell 4 (the latest run) reads
 * `schematify/runs`' newest row, project-wide like cell 3. Cell 2's `clean`/
 * `modified` came in with Wave 3's layout write.
 *
 * Cell 5 is later still, and reads `engine.semanticWrites` rather than the
 * graph: `seam.writeSemantic` (a reparent, duplicate, or dragged-in edge)
 * stays an in-memory `Map`, not a real file — see `graph/backend.ts`'s
 * `createBackendSeam` doc comment — so this cell says so, in words, rather
 * than leaving that gesture looking saved. See `statusCell5` (`graph/
 * index.ts`) for the exact wording.
 */
import {
  statusCell1,
  statusCell2,
  statusCell3,
  statusCell4,
  statusCell5,
  type DashboardRun,
  type Finding,
  type ServiceGraph,
} from "../graph";

export interface StatusBarProps {
  graph: ServiceGraph;
  /** False once the Schematic engine has written the layout file, which is
   *  what cell 2 reports as `modified` (PRD §12.1). */
  layoutClean?: boolean;
  /** `null` while the first `schematify/lint` call is in flight, or once it
   *  has failed — cell 3 draws blank rather than a guessed `0 errors · 0
   *  warnings`, the same "no invented placeholder" rule the rest of this
   *  file's own header states. */
  findings?: Finding[] | null;
  /** The newest row `schematify/runs` returned, or `null` while that call is
   *  in flight, has failed, or the project has never ingested a run — cell 4
   *  draws blank in every one of those cases rather than a guessed run. */
  latestRun?: DashboardRun | null;
  /** `engine.semanticWrites`: every semantic-layer path this session has
   *  written or removed, in write order (duplicates included when undo/redo
   *  replay a path). Empty on a Schematic nothing has reparented, duplicated,
   *  or edge-connected yet, so cell 5 draws blank exactly then. */
  semanticWrites?: readonly string[];
}

export function StatusBar({
  graph,
  layoutClean = true,
  findings = null,
  latestRun = null,
  semanticWrites = [],
}: StatusBarProps) {
  const sessionOnly = statusCell5(semanticWrites);
  return (
    <div className="kv-statusbar">
      <span className="kv-statusbar__cell">{statusCell1(graph)}</span>
      <span className="kv-statusbar__cell">{statusCell2(graph, layoutClean)}</span>
      <span className="kv-statusbar__cell">{findings ? statusCell3(findings) : ""}</span>
      <span className="kv-statusbar__cell">{statusCell4(latestRun)}</span>
      <span
        className={
          sessionOnly ? "kv-statusbar__cell kv-statusbar__cell--warning" : "kv-statusbar__cell"
        }
      >
        {sessionOnly}
      </span>
    </div>
  );
}
