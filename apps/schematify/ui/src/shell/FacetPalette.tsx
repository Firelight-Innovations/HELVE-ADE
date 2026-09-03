/**
 * The Module Schematic's facet palette (PRD §12.11), drawn only at tier 3.
 * WIREFRAME-EXTRACT.md §4.2: `FACET PALETTE` heading, then the 5 facet kinds
 * in the Schematic's own reading order, then an `ANNOTATION` heading with
 * `comment` and `group`.
 *
 * Drawn, not wired: dragging a palette entry onto the canvas needs a
 * semantic write this wave's seam does not make (the same reasoning
 * `EmptyStack.tsx` and `EmptyModule.tsx` already give their own disabled
 * actions), so every row is inert.
 */
const FACET_KINDS = [
  "contract-method",
  "test-case",
  "budget",
  "doc-block",
  "external-dep",
] as const;

const ANNOTATION_KINDS = ["comment", "group"] as const;

export function FacetPalette() {
  return (
    <div className="kv-facet-palette">
      <div className="kv-facet-palette__header">FACET PALETTE</div>
      <ul className="kv-facet-palette__list">
        {FACET_KINDS.map((kind) => (
          <li key={kind} className="kv-facet-palette__entry">
            {kind}
          </li>
        ))}
      </ul>
      <div className="kv-facet-palette__header">ANNOTATION</div>
      <ul className="kv-facet-palette__list">
        {ANNOTATION_KINDS.map((kind) => (
          <li key={kind} className="kv-facet-palette__entry">
            {kind}
          </li>
        ))}
      </ul>
      <p className="kv-facet-palette__footer">
        Drag onto the canvas, or let an agent draft and review after.
      </p>
    </div>
  );
}
