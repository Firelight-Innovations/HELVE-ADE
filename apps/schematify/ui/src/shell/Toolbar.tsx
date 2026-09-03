/**
 * The Service Schematic toolbar (PRD §12.1): a node search field, `Auto-sort`,
 * and `Fit`. Wave 3 wired the 2 controls that act on the Schematic engine;
 * search stays inert until Wave 8 builds it, and is drawn disabled rather than
 * drawn live and silently doing nothing.
 */
export interface ToolbarProps {
  onAutoSort?: () => void;
  onFit?: () => void;
}

export function Toolbar({ onAutoSort, onFit }: ToolbarProps) {
  return (
    <div className="kv-toolbar">
      <input
        className="kv-toolbar__search"
        type="search"
        placeholder="Search nodes, methods, markers…"
        disabled
      />
      <button
        type="button"
        className="kv-toolbar__button"
        disabled={!onAutoSort}
        onClick={onAutoSort}
      >
        Auto-sort
      </button>
      <button type="button" className="kv-toolbar__button" disabled={!onFit} onClick={onFit}>
        Fit
      </button>
    </div>
  );
}
