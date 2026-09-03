/**
 * The Service Schematic toolbar (PRD §12.1): a node search field, `Auto-sort`,
 * and `Fit`. Every control is drawn inert this wave — search, sort, and fit
 * all act on the Schematic engine, which is Wave 3.
 */
export function Toolbar() {
  return (
    <div className="kv-toolbar">
      <input
        className="kv-toolbar__search"
        type="search"
        placeholder="Search nodes, methods, markers…"
        disabled
      />
      <button type="button" className="kv-toolbar__button" disabled>
        Auto-sort
      </button>
      <button type="button" className="kv-toolbar__button" disabled>
        Fit
      </button>
    </div>
  );
}
