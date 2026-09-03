/**
 * Schematify's shell — PRD §17 Wave 2, with Wave 3's Schematic engine and
 * Wave 4's node anatomy mounted inside it. Opens the `auth-service` Service
 * Schematic on first paint (Wave 2/3's own landing view, unchanged) and
 * draws the breadcrumb, the toolbar, the Outline, the Schematic, the
 * Inspector shell, the dock frame, and the status bar around it.
 *
 * No title bar and no application tab strip: the real shell already draws both,
 * once, outside this iframe — see the Wave 2 handoff for that ruling.
 *
 * **The graph is read once per open Schematic.** `openSchematic` does the
 * reading, and the breadcrumb, the Outline and the status bar draw from the
 * engine's live document projected back to a graph (`engine/layout.ts`'s
 * `toGraph`), so a duplicate moves their counts the moment it appears.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { reportPainted } from "@openkaava/bridge";

// **Wave 5's tier switch.** `path` is the breadcrumb's own history: the
// Stack Schematic first, whichever Service Schematic is open, and — once a
// module has been clicked — the Module Schematic. A click on a service or a
// module (`engine/navigation.ts`'s `nextDrillTarget` decides which) appends
// to it; a click on an earlier breadcrumb segment truncates back to it. Each
// entry re-opens its own Schematic through `openSchematic`, so switching
// tiers is exactly the same "open a Schematic" path the first paint uses.
import {
  configFor,
  nextDrillTarget,
  openSchematic,
  toGraph,
  type DrawnNode,
  type DrillTarget,
  type SchematicEngine,
} from "./engine";
import { SchematicCanvas } from "./engine/SchematicCanvas";
import { stackHeaderCounts } from "./graph";
import { Breadcrumb } from "./shell/Breadcrumb";
import { Dock } from "./shell/Dock";
import { EmptyModule } from "./shell/EmptyModule";
import { EmptyStack } from "./shell/EmptyStack";
import { InspectorShell } from "./shell/InspectorShell";
import { Outline } from "./shell/Outline";
import { StatusBar } from "./shell/StatusBar";
import { Toolbar } from "./shell/Toolbar";
import "./shell/shell.css";

const VIEW_PARAM =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
const SHOW_EMPTY_STACK = VIEW_PARAM === "empty-stack";
const SHOW_EMPTY_MODULE = VIEW_PARAM === "empty-module";

/** Wave 2/3's original landing view, now the first entry of a walkable path
 *  rather than a fixed breadcrumb string: `["Stack", "Auth Service"]`
 *  drew before Wave 5 gave `Stack` anywhere real to lead. */
const INITIAL_PATH: readonly DrillTarget[] = [
  { tier: "stack", slug: "saas-backend", title: "Stack" },
  { tier: "service", slug: "auth-service", title: "Auth Service" },
];

export default function App() {
  const [path, setPath] = useState<readonly DrillTarget[]>(INITIAL_PATH);
  const target = path[path.length - 1];
  const [engine, setEngine] = useState<SchematicEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paintedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setEngine(null);
    openSchematic(configFor(target))
      .then((opened) => {
        if (!cancelled) setEngine(opened);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // `target.tier`/`target.slug` are the whole identity of what to open;
    // `target` itself is a fresh object per navigation, so it is not a
    // stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.tier, target.slug]);

  // The condition is "the first frame is honest", the rule every app here
  // follows (`apps/home/ui/src/App.tsx` line 246, `apps/files/ui/src/App.tsx`
  // line 78) — the empty-stack and empty-module views have nothing to load,
  // so they paint immediately; the populated view paints once the first open
  // settles, whether it resolved or rejected. Reported once: a tier switch
  // reopens `engine` (briefly `null` again) but the webview has already
  // painted by then, so a 2nd report would be redundant rather than honest.
  useEffect(() => {
    if (paintedRef.current) return;
    if (SHOW_EMPTY_STACK || SHOW_EMPTY_MODULE || engine !== null || error !== null) {
      paintedRef.current = true;
      reportPainted();
    }
  }, [engine, error]);

  // `?view=empty-stack` and `?view=empty-module` reach the 2 first-run empty
  // states directly, the same convention `EmptyStack.tsx`'s own doc comment
  // already established for the Stack Schematic.
  if (SHOW_EMPTY_STACK) {
    return (
      <div className="kv-shell">
        <EmptyStack />
      </div>
    );
  }
  if (SHOW_EMPTY_MODULE) {
    return (
      <div className="kv-shell">
        <EmptyModule />
      </div>
    );
  }

  if (error) {
    return (
      <div className="kv-shell">
        <p className="kv-shell__error">{error}</p>
      </div>
    );
  }

  if (!engine) return <div className="kv-shell" />;

  return (
    <Schematify
      engine={engine}
      path={path}
      onNavigate={(index) => setPath(path.slice(0, index + 1))}
      onActivate={(drawn) => {
        const dest = nextDrillTarget(engine.config.tier, drawn.node);
        if (dest) setPath([...path, dest]);
      }}
    />
  );
}

/** The populated view, split out so the engine subscription lives where the
 *  engine is known to exist rather than behind a null check. */
function Schematify({
  engine,
  path,
  onNavigate,
  onActivate,
}: {
  engine: SchematicEngine;
  path: readonly DrillTarget[];
  onNavigate: (index: number) => void;
  onActivate: (node: DrawnNode) => void;
}) {
  const state = useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.state,
  );
  const graph = useMemo(() => toGraph(state.doc), [state.doc]);

  return (
    <div className="kv-shell">
      <div className="kv-chrome-row">
        <Breadcrumb
          segments={path.map((entry) => entry.title)}
          activeSlug={graph.serviceSlug}
          onNavigate={onNavigate}
        />
        {graph.tier === "stack" ? (
          <span className="kv-schematic-header">{stackHeaderCounts(graph)}</span>
        ) : null}
        <Toolbar onAutoSort={() => engine.autoSort()} onFit={() => engine.fit()} />
      </div>
      <div className="kv-shell__body">
        <Outline graph={graph} />
        <SchematicCanvas engine={engine} onActivate={onActivate} exports={graph.exports} />
        <InspectorShell graph={graph} selectionCount={state.selection.length} />
      </div>
      <Dock />
      <StatusBar graph={graph} layoutClean={!engine.layoutDirty} />
    </div>
  );
}
