import type { ResolvedTool, StackSnapshot } from "../bindings";

/**
 * The strip along the bottom: what's loaded, whether the stack is healthy, and
 * the way in to the stack view.
 *
 * Stack health used to be the whole home screen. It has been demoted to this
 * indicator because it is diagnostics, not work — someone opening Helve wants
 * to get into a project, and only cares which repos are cloned when something
 * is wrong. It stays one click away rather than in the way.
 */
export default function StatusBar({
  snapshot,
  activeTool,
  stackViewOpen,
  onToggleStackView,
}: {
  snapshot: StackSnapshot | null;
  activeTool: ResolvedTool | null;
  stackViewOpen: boolean;
  onToggleStackView: () => void;
}) {
  const tools = snapshot?.tools ?? [];
  // "Healthy" means every declared tool is cloned and on its pinned version.
  // Anything else — missing, mismatched, or unreadable — is worth a look, so
  // they collapse into one count rather than being ranked here.
  const unhealthy = tools.filter((t) => t.status.state !== "ready").length;
  const healthy = tools.length > 0 && unhealthy === 0;

  return (
    <footer className="statusbar">
      <button
        type="button"
        className="statusbar__stack"
        aria-pressed={stackViewOpen}
        onClick={onToggleStackView}
      >
        <span
          className={`statusbar__dot ${healthy ? "statusbar__dot--ok" : "statusbar__dot--warn"}`}
          aria-hidden="true"
        />
        {snapshot
          ? healthy
            ? `stack ok · ${tools.length} tools`
            : `${unhealthy} of ${tools.length} tools need attention`
          : "stack unknown"}
      </button>

      <span className="statusbar__spacer" />

      {activeTool && <span className="statusbar__tool mono">{activeTool.name}</span>}

      {snapshot && <span className="statusbar__version mono">v{snapshot.stackVersion}</span>}
    </footer>
  );
}
