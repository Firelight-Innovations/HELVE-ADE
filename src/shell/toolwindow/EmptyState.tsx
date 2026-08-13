import { BrandGlyph } from "../../ui/Icon";
import type { ToolPresentation } from "../contract";

/**
 * Reached on first launch and after the last tool is closed or detached.
 * Measured from SCREEN 02 (docs/handoffs/shell-spec.html). No dashed inset
 * border here — that belongs to the boot overlay only; screen 02's markup
 * draws none.
 */
export default function EmptyState({
  tools,
  onOpenTool,
  onRescan,
}: {
  /** Docked tools, in bar order. The first is what "Open <name>" opens. */
  tools: ToolPresentation[];
  onOpenTool: (id: string) => void;
  onRescan: () => void;
}) {
  const first = tools[0];

  return (
    <div className="toolwindow__empty">
      <div className="toolwindow__empty-column">
        <BrandGlyph size={38} className="toolwindow__empty-glyph" />
        <div className="toolwindow__empty-title">No tool active</div>
        <div className="toolwindow__empty-body">
          Pick a tool from the switcher above, or press the number key for its slot.
        </div>
        <div className="toolwindow__empty-actions">
          {/* "Open Forger" in the handoff is really "open the first docked
              tool" — the name is never hardcoded. */}
          {first && (
            <button
              type="button"
              className="toolwindow__action toolwindow__action--accent"
              onClick={() => onOpenTool(first.id)}
            >
              <span className="toolwindow__action-label">Open {first.name}</span>
              <span className="toolwindow__action-hint">⌘1</span>
            </button>
          )}
          <button type="button" className="toolwindow__action" onClick={onRescan}>
            <span className="toolwindow__action-label">Re-scan tools</span>
            <span className="toolwindow__action-hint">⌘R</span>
          </button>
        </div>
      </div>
    </div>
  );
}
