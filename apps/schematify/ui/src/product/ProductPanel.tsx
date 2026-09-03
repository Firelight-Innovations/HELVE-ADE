/**
 * The panel that replaces the Schematic + Inspector body when the Outline's
 * section switcher (`../shell/Outline.tsx`, PRD §12.1) is on `Product` or
 * `Decisions`. Draws whichever of the 4 product surfaces the active section
 * and tab name; `../App.tsx` owns the one `productSeam.loadProduct()` call
 * this data comes from, so the Outline's own summary line and this panel's
 * content are never 2 separate reads of the same file.
 *
 * `[P]` in its placement: PRD §12.17/§12.18 name what each section holds
 * but no wireframe draws where it sits relative to the rest of the shell.
 * Swapping the center body — leaving the Outline, breadcrumb and toolbar in
 * place — was chosen over drawing these 4 surfaces inside the 238px Outline
 * column itself, which S-19 through S-22's own descriptions ("table plus
 * form", "ordered list") would not fit legibly. Recorded in the wave 10c
 * handoff.
 */
import { useEffect, useState } from "react";
import type { ProductGraph } from "../graph/backend";
import { DecisionLog } from "./DecisionLog";
import { FlowEditor } from "./FlowEditor";
import { ProjectBriefView } from "./ProjectBriefView";
import { ScreenRegistry } from "./ScreenRegistry";
import type { RawDecision, RawFlow, RawProjectBrief, RawScreen } from "./types";

export type ProductSection = "Product" | "Decisions";

export interface ProductPanelProps {
  section: ProductSection;
  graph: ProductGraph;
  onSaveBrief: (brief: RawProjectBrief) => Promise<void>;
  onSaveScreen: (screen: RawScreen) => Promise<void>;
  onSaveFlow: (flow: RawFlow) => Promise<void>;
  onCreateDecision: (decision: RawDecision) => Promise<void>;
  onSupersedeDecision: (priorId: string, decision: RawDecision) => Promise<void>;
  /** Set by a screen chip or module-root path click-through
   *  (`../engine/SchematicCanvas.tsx`, wired from `../App.tsx`), so opening
   *  the registry from a reference lands on that screen. */
  initialScreenId?: string | null;
}

type ProductTab = "Brief" | "Screens" | "Flows";
const TABS: readonly ProductTab[] = ["Brief", "Screens", "Flows"];

export function ProductPanel({
  section,
  graph,
  onSaveBrief,
  onSaveScreen,
  onSaveFlow,
  onCreateDecision,
  onSupersedeDecision,
  initialScreenId,
}: ProductPanelProps) {
  const [tab, setTab] = useState<ProductTab>(initialScreenId ? "Screens" : "Brief");

  useEffect(() => {
    if (initialScreenId) setTab("Screens");
  }, [initialScreenId]);

  if (section === "Decisions") {
    return (
      <div className="kv-product-panel">
        <DecisionLog
          decisions={graph.decisions}
          onCreate={onCreateDecision}
          onSupersede={onSupersedeDecision}
        />
      </div>
    );
  }

  return (
    <div className="kv-product-panel">
      <div className="kv-product-panel__tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === tab}
            className={
              entry === tab
                ? "kv-product-panel__tab kv-product-panel__tab--active"
                : "kv-product-panel__tab"
            }
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {tab === "Brief" ? <ProjectBriefView brief={graph.brief} onSave={onSaveBrief} /> : null}
      {tab === "Screens" ? (
        <ScreenRegistry
          screens={graph.screens}
          nodeIds={graph.nodeIds}
          initialSelectedId={initialScreenId}
          onSave={onSaveScreen}
        />
      ) : null}
      {tab === "Flows" ? (
        <FlowEditor flows={graph.flows} screens={graph.screens} onSave={onSaveFlow} />
      ) : null}
    </div>
  );
}
