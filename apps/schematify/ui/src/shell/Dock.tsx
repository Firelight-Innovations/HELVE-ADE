/**
 * The bottom dock frame (PRD §12.1): 4 tabs at the stated 196 px height, with
 * no tab's content built yet. `Problems` is Wave 7; `Runs` is Wave 9; the
 * library and rule `Registries` and `Rules` are Wave 8. This wave draws the
 * frame and the header note the wireframe states, and nothing inside a tab.
 */
const TABS = ["Problems", "Runs", "Registries", "Rules"] as const;

export function Dock() {
  return (
    <div className="kv-dock">
      <div className="kv-dock__tabs" role="tablist">
        {TABS.map((tab, index) => (
          <span
            key={tab}
            className={`kv-dock__tab${index === 0 ? " kv-dock__tab--active" : ""}`}
            role="tab"
            aria-selected={index === 0}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="kv-dock__note">Errors first · never hidden</div>
      <p className="kv-dock__placeholder">Panel content — Waves 7 through 9.</p>
    </div>
  );
}
