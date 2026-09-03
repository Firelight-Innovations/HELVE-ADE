/**
 * Schematify's shell — PRD §17 Wave 2, with Wave 3's Schematic engine mounted
 * inside it. Opens the `auth-service` Service Schematic and draws the
 * breadcrumb, the toolbar, the Outline, the Schematic, the Inspector shell,
 * the dock frame, and the status bar around it.
 *
 * No title bar and no application tab strip: the real shell already draws both,
 * once, outside this iframe — see the Wave 2 handoff for that ruling.
 *
 * **The graph is read once.** `openSchematic` does the reading, and the
 * breadcrumb, the Outline and the status bar draw from the engine's live
 * document projected back to a `ServiceGraph`, so a duplicate moves their
 * counts at the moment it appears on the canvas.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { reportPainted } from "@openkaava/bridge";
import { SERVICE_CONFIG, openSchematic, toServiceGraph, type SchematicEngine } from "./engine";
import { SchematicCanvas } from "./engine/SchematicCanvas";
import { Breadcrumb } from "./shell/Breadcrumb";
import { Dock } from "./shell/Dock";
import { EmptyStack } from "./shell/EmptyStack";
import { InspectorShell } from "./shell/InspectorShell";
import { Outline } from "./shell/Outline";
import { StatusBar } from "./shell/StatusBar";
import { Toolbar } from "./shell/Toolbar";
import "./shell/shell.css";

const SHOW_EMPTY_STACK =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("view") === "empty-stack";

export default function App() {
  const [engine, setEngine] = useState<SchematicEngine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    openSchematic(SERVICE_CONFIG)
      .then((opened) => {
        if (!cancelled) setEngine(opened);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The condition is "the first frame is honest", the rule every app here
  // follows (`apps/home/ui/src/App.tsx` line 246, `apps/files/ui/src/App.tsx`
  // line 78) — the empty-stack view has nothing to load, so it paints
  // immediately; the populated view paints once the open settles, whether it
  // resolved or rejected. Opening cannot reject today (it resolves a local
  // fixture), but the seam it will become (`./graph/index.ts`'s doc comment)
  // can, and a rejection that never reports painted would hang the splash
  // screen rather than show an error.
  useEffect(() => {
    if (SHOW_EMPTY_STACK || engine !== null || error !== null) reportPainted();
  }, [engine, error]);

  // `?view=empty-stack` reaches the Stack Schematic's first-run state; Wave 5
  // builds the tier switch that would otherwise show it, by choosing a
  // different `SchematicConfig` rather than by reaching into the engine.
  if (SHOW_EMPTY_STACK) {
    return (
      <div className="kv-shell">
        <EmptyStack />
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

  return <Schematify engine={engine} />;
}

/** The populated view, split out so the engine subscription lives where the
 *  engine is known to exist rather than behind a null check. */
function Schematify({ engine }: { engine: SchematicEngine }) {
  const state = useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.state,
  );
  const graph = useMemo(() => toServiceGraph(state.doc), [state.doc]);

  return (
    <div className="kv-shell">
      <div className="kv-chrome-row">
        <Breadcrumb segments={["Stack", graph.serviceTitle]} activeSlug={graph.serviceSlug} />
        <Toolbar onAutoSort={() => engine.autoSort()} onFit={() => engine.fit()} />
      </div>
      <div className="kv-shell__body">
        <Outline graph={graph} />
        <SchematicCanvas engine={engine} />
        <InspectorShell />
      </div>
      <Dock />
      <StatusBar graph={graph} layoutClean={!engine.layoutDirty} />
    </div>
  );
}
