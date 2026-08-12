import type { StackSnapshot } from "../bindings";
import ToolCard from "../components/ToolCard";

/**
 * The stack diagnostics screen: which components are cloned, and whether each
 * one is on the version `helve.toml` pins it to.
 *
 * This was the app's home screen while the shell was the only thing that
 * existed. It is now reached from the status bar instead. The content is
 * unchanged — what changed is its standing: this answers "is my checkout in
 * the state Helve expects", which is a question you ask when something is
 * wrong, not the first thing you should be looking at on launch.
 */
export default function StackView({
  snapshot,
  busy,
  onRescan,
}: {
  snapshot: StackSnapshot | null;
  busy: boolean;
  onRescan: () => void;
}) {
  const runtime = snapshot?.tools.filter((t) => t.kind === "runtime") ?? [];
  const devTools = snapshot?.tools.filter((t) => t.kind === "dev-tool") ?? [];

  return (
    <div className="stackview">
      <header className="stackview__head">
        <h2 className="stackview__title">Stack</h2>
        <button type="button" className="btn" onClick={onRescan} disabled={busy}>
          {busy ? "Scanning…" : "Rescan"}
        </button>
      </header>

      {snapshot && (
        <p className="subhead mono" title={snapshot.manifestPath}>
          {snapshot.manifestPath} → checkouts in {snapshot.checkoutRoot}
        </p>
      )}

      {runtime.length > 0 && (
        <section className="section">
          <h3 className="section__title">
            Runtime <span className="section__note">ships with a game</span>
          </h3>
          <div className="grid">
            {runtime.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      )}

      {devTools.length > 0 && (
        <section className="section">
          <h3 className="section__title">
            Development tools <span className="section__note">authoring only</span>
          </h3>
          <div className="grid">
            {devTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
