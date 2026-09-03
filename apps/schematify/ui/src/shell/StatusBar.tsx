/**
 * The status bar (PRD §12.1, §17 Wave 2): 4 cells on the Service Schematic.
 * Cell 1 and cell 2 draw as of Wave 2/3, computed from the graph. Cell 3
 * (errors and warnings) is this wave's own: `3 errors · 2 warnings`, read off
 * the same `schematify/lint` answer the Problems panel draws, computed at
 * render time (PRD §0.4) rather than cached — a stale count would disagree
 * with the panel it sits 2 panes away from. Cell 4 (the latest run) stays
 * empty until Wave 9 lands.
 *
 * Wave 3 filled in cell 2's second value: the layout file reads `modified`
 * once the Schematic engine has written a position to it, and `clean` before.
 */
import { statusCell1, statusCell2, statusCell3, type Finding, type ServiceGraph } from "../graph";

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
}

export function StatusBar({ graph, layoutClean = true, findings = null }: StatusBarProps) {
  return (
    <div className="kv-statusbar">
      <span className="kv-statusbar__cell">{statusCell1(graph)}</span>
      <span className="kv-statusbar__cell">{statusCell2(graph, layoutClean)}</span>
      <span className="kv-statusbar__cell">{findings ? statusCell3(findings) : ""}</span>
      <span className="kv-statusbar__cell" />
    </div>
  );
}
