/**
 * The Inspector shell — the panel frame and its 5-tab strip (PRD §12.12),
 * with no tab's content built yet. `Identity` through `References` (S-04
 * through S-11) are Wave 6 scope; this wave only reserves the 360 px column
 * and draws the tab labels the wireframe names.
 */
const TABS = ["Identity", "Lifecycle", "Contract", "Tests", "More"] as const;

export function InspectorShell() {
  return (
    <div className="kv-inspector">
      <div className="kv-inspector__tabs" role="tablist">
        {TABS.map((tab, index) => (
          <span
            key={tab}
            className={`kv-inspector__tab${index === 0 ? " kv-inspector__tab--active" : ""}`}
            role="tab"
            aria-selected={index === 0}
          >
            {tab}
          </span>
        ))}
      </div>
      <p className="kv-inspector__placeholder">Inspector content — Wave 6.</p>
    </div>
  );
}
