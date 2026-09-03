/**
 * The Outline panel (PRD §12.1): a 3-entry section switcher above a
 * containment tree, header, and footer. `Design` draws the tree; `Product`
 * and `Decisions` (PRD §12.17, §12.18) are built as of wave 10c —
 * `../App.tsx` swaps the whole center body for `../product/ProductPanel`
 * when either is active, so this component draws only the switcher itself
 * plus a 1-line summary for the 2 non-Design sections, computed from
 * whatever `productCounts` names (undefined while that data is still
 * loading, so the summary reads "loading…" rather than a wrong `0`).
 */
import { useState } from "react";
import { buildOutlineRows, outlineFooter, type ServiceGraph } from "../graph";

const SECTIONS = ["Design", "Product", "Decisions"] as const;
export type Section = (typeof SECTIONS)[number];

/** Computed at draw time from whatever the panel has loaded (PRD §0.4) —
 *  never stored on the Outline itself. */
export interface ProductCounts {
  screens: number;
  flows: number;
  decisions: number;
}

export interface OutlineProps {
  graph: ServiceGraph;
  /** Controlled from `../App.tsx` once wave 10c's Product/Decisions panels
   *  exist, so a click there can also swap the center body. Falls back to
   *  uncontrolled local state when omitted, keeping every caller written
   *  before this wave compiling unchanged. */
  section?: Section;
  onSectionChange?: (section: Section) => void;
  productCounts?: ProductCounts;
}

export function Outline({ graph, section, onSectionChange, productCounts }: OutlineProps) {
  const [localSection, setLocalSection] = useState<Section>("Design");
  const activeSection = section ?? localSection;
  const setSection = onSectionChange ?? setLocalSection;
  const rows = buildOutlineRows(graph);

  return (
    <div className="kv-outline">
      <div className="kv-outline__switcher" role="tablist">
        {SECTIONS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === activeSection}
            className={`kv-outline__switcher-tab${entry === activeSection ? " kv-outline__switcher-tab--active" : ""}`}
            onClick={() => setSection(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {activeSection === "Design" ? (
        <>
          {/* WIREFRAME-EXTRACT.md §1.1 draws `OUTLINE — CONTAINMENT` at
              tier 2; §5.1 draws `OUTLINE — SERVICES` at tier 1. Neither
              screen 1d nor any other source draws tier 3's own header text,
              so the tier-2 wording carries over there too — it is still a
              containment tree, just of facets rather than modules. `[P]`,
              recorded in the Wave 5 handoff. */}
          <div className="kv-outline__header">
            {graph.tier === "stack" ? "OUTLINE — SERVICES" : "OUTLINE — CONTAINMENT"}
          </div>
          <div className="kv-outline__root">{graph.serviceSlug}</div>
          <ul className="kv-outline__tree">
            {rows.map(({ node, depth, hasChildren, hiddenChildCount }) => (
              <li
                key={node.id}
                className="kv-outline__row"
                style={{ paddingLeft: `${depth * 14}px` }}
              >
                {hasChildren ? (
                  <span className="kv-outline__triangle">{node.collapsed ? "▸" : "▾"}</span>
                ) : (
                  <span className="kv-outline__triangle" aria-hidden="true" />
                )}
                <span className="kv-outline__title">{node.slug}</span>
                {node.badge ? <span className="kv-outline__badge">{node.badge}</span> : null}
                {hiddenChildCount !== undefined ? (
                  <span className="kv-outline__count">{hiddenChildCount}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="kv-outline__footer">{outlineFooter(graph)}</div>
        </>
      ) : (
        <div className="kv-outline__placeholder">
          {activeSection === "Product"
            ? productCounts
              ? `${productCounts.screens} screens · ${productCounts.flows} flows`
              : "loading…"
            : productCounts
              ? `${productCounts.decisions} decisions`
              : "loading…"}
        </div>
      )}
    </div>
  );
}
