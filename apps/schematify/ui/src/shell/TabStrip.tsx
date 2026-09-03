/**
 * The application tab strip (PRD §12.1). The wireframe strip carries `SDD`,
 * `Files`, `Journeyman`, `Forger`, `Terminal`; the merge collapses the first
 * 3 into 1 entry, so the shipped strip reads `Schematify`, `Files`,
 * `Terminal` — `[P]`, stated directly in the PRD text.
 */
const TABS = ["Schematify", "Files", "Terminal"] as const;

export function TabStrip() {
  return (
    <div className="kv-tabstrip">
      <div className="kv-tabstrip__tabs" role="tablist">
        {TABS.map((tab) => (
          <span
            key={tab}
            className={`kv-tabstrip__tab${tab === "Schematify" ? " kv-tabstrip__tab--active" : ""}`}
            role="tab"
            aria-selected={tab === "Schematify"}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="kv-tabstrip__search">
        <span>Search all apps</span>
        <kbd>Ctrl+K</kbd>
      </div>
    </div>
  );
}
