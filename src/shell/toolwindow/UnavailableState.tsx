import { BrandGlyph } from "../../ui/Icon";
import type { ToolPresentation } from "../contract";

/**
 * Shown in a tool's slot in place of an empty iframe when its frontend
 * can't be resolved — typically because the checkout hasn't been cloned yet.
 * This is the normal state for most tools most of the time, not an error, so
 * it borrows the empty state's quiet typography rather than an error style.
 */
export default function UnavailableState({ tool, reason }: { tool: ToolPresentation; reason: string }) {
  return (
    <div className="toolwindow__empty">
      <div className="toolwindow__empty-column">
        <BrandGlyph size={38} strokeWidth={1.5} className="toolwindow__empty-glyph" />
        <div className="toolwindow__empty-title">{tool.name}</div>
        <div className="toolwindow__empty-body">{reason}</div>
      </div>
    </div>
  );
}
