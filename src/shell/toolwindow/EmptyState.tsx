import { BrandGlyph } from "../../ui/Icon";

/**
 * Reached when the active cluster has nothing open — on first launch, and after
 * the last tab in it is closed or dragged away. Measured from SCREEN 02
 * (docs/handoffs/shell-spec.html). No dashed inset border here — that belongs to
 * the boot overlay only; screen 02's markup draws none.
 *
 * No buttons here any more. There used to be an "Open Home" and a "Re-scan
 * tools", but a cluster this empty already sits under three other ways to put
 * something in it — the Apps menu, the cluster's own `+`, a drag from
 * elsewhere — and a fourth and fifth path, half-redundant with the first,
 * were more surface than the state needed. The copy below names the three
 * that are left instead of a button repeating one of them.
 */
export default function EmptyState() {
  return (
    <div className="toolwindow__empty">
      <div className="toolwindow__empty-column">
        <BrandGlyph size={38} className="toolwindow__empty-glyph" />
        <div className="toolwindow__empty-title">Nothing open here</div>
        <div className="toolwindow__empty-body">
          Open an app from the Apps menu in the title bar, click the + at the
          end of this cluster's tabs in the bar above, or drag one in from
          another cluster.
        </div>
      </div>
    </div>
  );
}
