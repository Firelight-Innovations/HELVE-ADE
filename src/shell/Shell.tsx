import { useState } from "react";
import type { StackSnapshot } from "../bindings";
import StackView from "../views/StackView";
import ActivityRail from "./ActivityRail";
import StatusBar from "./StatusBar";
import ToolSurface from "./ToolSurface";

/**
 * The frame every tool runs inside.
 *
 * The shell owns the chrome — which project is open, which tool is selected,
 * stack health — and nothing else. Tools are separate pieces of software; the
 * shell's job is to give them a surface and stay out of the way.
 *
 * Layout is a three-row grid: a title bar, a middle row split between the
 * activity rail and the tool surface, and a status bar. The middle row is the
 * only one that grows, so the surface gets all the space and neither the rail
 * nor the bars can be pushed off screen by content.
 *
 * Styling here is deliberately thin — structure, spacing, and tokens, no real
 * visual design. The actual design is being done separately, and the point of
 * keeping this layer structural is that a restyle should be able to land in
 * `shell.css` without touching any of the logic in these components.
 */
export default function Shell({
  snapshot,
  error,
  busy,
  onRescan,
}: {
  snapshot: StackSnapshot | null;
  error: string | null;
  busy: boolean;
  onRescan: () => void;
}) {
  const tools = snapshot?.tools ?? [];

  // Nothing is selected on launch, and that is correct rather than a gap to
  // fill with a default: with no project open there is nothing for a tool to
  // operate on, so pre-selecting one would just be a lie about readiness.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stackViewOpen, setStackViewOpen] = useState(false);

  const activeTool = tools.find((t) => t.id === activeId) ?? null;

  return (
    <div className="shell">
      <header className="shell__titlebar">
        <span className="shell__brand">{snapshot?.stackName ?? "Helve"}</span>
        {/* Projects don't exist yet. This is the slot the picker lands in —
            it reads as an empty state rather than being hidden, so the shape
            of the frame is the same now as it will be once it works. */}
        <span className="shell__project">No project</span>
      </header>

      <div className="shell__body">
        <ActivityRail tools={tools} activeId={activeId} onSelect={setActiveId} />

        <main className="shell__surface">
          {error && (
            <div className="notice notice--error">
              <strong>Could not load the stack.</strong>
              <pre className="mono">{error}</pre>
            </div>
          )}

          {stackViewOpen ? (
            <StackView snapshot={snapshot} busy={busy} onRescan={onRescan} />
          ) : (
            <ToolSurface tool={activeTool} />
          )}
        </main>
      </div>

      <StatusBar
        snapshot={snapshot}
        activeTool={activeTool}
        stackViewOpen={stackViewOpen}
        onToggleStackView={() => setStackViewOpen((open) => !open)}
      />
    </div>
  );
}
