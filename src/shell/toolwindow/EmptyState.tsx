import { BrandGlyph } from "../../ui/Icon";

/**
 * Reached when the active cluster has nothing open — on first launch, and after
 * the last tab in it is closed or dragged away. Measured from SCREEN 02
 * (docs/handoffs/shell-spec.html). No dashed inset border here — that belongs to
 * the boot overlay only; screen 02's markup draws none.
 *
 * It offers Home rather than "the first docked tool", which is what it used to
 * do. There is no dock any more, and no first tool to name: a cluster with
 * nothing in it has nothing to be the first of. Home is the one surface that is
 * always available — it ships in the binary, so `missing` is not a state it can
 * be in — and it is where a session with no project has anywhere to go from.
 */
export default function EmptyState({
  onOpenApp,
  onRescan,
}: {
  onOpenApp: (appId: string) => void;
  onRescan: () => void;
}) {
  return (
    <div className="toolwindow__empty">
      <div className="toolwindow__empty-column">
        <BrandGlyph size={38} className="toolwindow__empty-glyph" />
        <div className="toolwindow__empty-title">Nothing open here</div>
        <div className="toolwindow__empty-body">
          Open an app from the Apps menu, or drag a tab in from another pane.
        </div>
        <div className="toolwindow__empty-actions">
          <button
            type="button"
            className="toolwindow__action toolwindow__action--accent"
            onClick={() => onOpenApp("home")}
          >
            <span className="toolwindow__action-label">Open Home</span>
          </button>
          <button type="button" className="toolwindow__action" onClick={onRescan}>
            <span className="toolwindow__action-label">Re-scan tools</span>
            <span className="toolwindow__action-hint">Ctrl+R</span>
          </button>
        </div>
      </div>
    </div>
  );
}
