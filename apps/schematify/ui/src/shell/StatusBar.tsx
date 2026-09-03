/**
 * The status bar (PRD §12.1, §17 Wave 2): 4 cells on the Service Schematic.
 * Cell 1 and cell 2 draw this wave, computed from the graph; cell 3 (errors
 * and warnings, Wave 7) and cell 4 (the latest run, Wave 9) stay empty until
 * their waves land — an empty cell rather than an invented placeholder,
 * since nothing here has real data to report yet.
 *
 * Wave 3 filled in cell 2's second value: the layout file reads `modified`
 * once the Schematic engine has written a position to it, and `clean` before.
 */
import { statusCell1, statusCell2, type ServiceGraph } from "../graph";

export interface StatusBarProps {
  graph: ServiceGraph;
  /** False once the Schematic engine has written the layout file, which is
   *  what cell 2 reports as `modified` (PRD §12.1). */
  layoutClean?: boolean;
}

export function StatusBar({ graph, layoutClean = true }: StatusBarProps) {
  return (
    <div className="kv-statusbar">
      <span className="kv-statusbar__cell">{statusCell1(graph)}</span>
      <span className="kv-statusbar__cell">{statusCell2(graph, layoutClean)}</span>
      <span className="kv-statusbar__cell" />
      <span className="kv-statusbar__cell" />
    </div>
  );
}
