/**
 * The Outline panel (PRD §12.1): a 3-entry section switcher above a
 * containment tree, header, and footer. `Design` draws the tree this wave;
 * `Product` and `Decisions` are `[P]` per the PRD and undrawn by any
 * wireframe (WIREFRAME-EXTRACT.md §8.1 lists their surfaces, S-19 through
 * S-22, as later-wave scope) — they switch to a named placeholder rather
 * than nothing, so the switcher is honestly wired rather than 2 dead buttons.
 */
import { useState } from "react";
import { buildOutlineRows, outlineFooter, type ServiceGraph } from "../graph";

const SECTIONS = ["Design", "Product", "Decisions"] as const;
type Section = (typeof SECTIONS)[number];

export interface OutlineProps {
  graph: ServiceGraph;
}

export function Outline({ graph }: OutlineProps) {
  const [section, setSection] = useState<Section>("Design");
  const rows = buildOutlineRows(graph);

  return (
    <div className="kv-outline">
      <div className="kv-outline__switcher" role="tablist">
        {SECTIONS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === section}
            className={`kv-outline__switcher-tab${entry === section ? " kv-outline__switcher-tab--active" : ""}`}
            onClick={() => setSection(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {section === "Design" ? (
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
        <div className="kv-outline__placeholder">{section} — not built yet.</div>
      )}
    </div>
  );
}
