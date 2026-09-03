/**
 * Schematify's shell — PRD §17 Wave 2, with Wave 3's Schematic engine mounted
 * inside it. Opens the `auth-service` Service Schematic (`./graph`) and draws
 * the breadcrumb, the toolbar, the Outline, the Schematic, the Inspector
 * shell, the dock frame, and the status bar around it.
 *
 * No title bar and no application tab strip: the real shell already draws
 * both, once, outside this iframe (`src/shell/titlebar/TitleBar.tsx`,
 * `src/shell/switcher/ClusterBar.tsx`) — see the Wave 2 handoff for the ruling
 * and why the status bar stays anyway.
 *
 * The tier drawn here is fixed to the Service Schematic. Wave 5 builds the
 * tier switch, and does it by choosing a different `SchematicConfig`
 * (`./engine/presets.ts`) rather than by reaching into the engine.
 *
 * `?view=empty-stack` swaps the whole body for the Stack Schematic's
 * first-run empty state (`./shell/EmptyStack`) instead — see that module's
 * doc comment for why this wave reaches it by query param rather than by
 * building the tier switch that would otherwise show it.
 */
import { useEffect, useState } from "react";
import { reportPainted } from "@openkaava/bridge";
import { loadGraph, type ServiceGraph } from "./graph";
import { SERVICE_CONFIG, openSchematic, type SchematicEngine } from "./engine";
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
  const [graph, setGraph] = useState<ServiceGraph | null>(null);
  const [engine, setEngine] = useState<SchematicEngine | null>(null);
  const [layoutClean, setLayoutClean] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGraph()
      .then((result) => {
        if (!cancelled) setGraph(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    openSchematic(SERVICE_CONFIG).then((opened) => {
      if (!cancelled) setEngine(opened);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cell 2 of the status bar reads `modified` from the first layout write on.
  useEffect(() => {
    if (!engine) return;
    return engine.subscribe(() => setLayoutClean(!engine.layoutDirty));
  }, [engine]);

  // The condition is "the first frame is honest", the rule every app here
  // follows (`apps/home/ui/src/App.tsx` line 246, `apps/files/ui/src/App.tsx`
  // line 78) — the empty-stack view has nothing to load, so it paints
  // immediately; the populated view paints once `loadGraph()` settles,
  // whether it resolved or rejected. `loadGraph()` cannot reject today (it
  // resolves a local fixture), but the seam it will become
  // (`./graph/index.ts`'s doc comment) can, and a rejection that never
  // reports painted would hang the splash screen rather than show an error.
  useEffect(() => {
    if (SHOW_EMPTY_STACK || graph !== null || error !== null) reportPainted();
  }, [graph, error]);

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

  if (!graph) return <div className="kv-shell" />;

  return (
    <div className="kv-shell">
      <div className="kv-chrome-row">
        <Breadcrumb segments={["Stack", graph.serviceTitle]} activeSlug={graph.serviceSlug} />
        <Toolbar onAutoSort={() => engine?.autoSort()} onFit={() => engine?.fit()} />
      </div>
      <div className="kv-shell__body">
        <Outline graph={graph} />
        {engine ? <SchematicCanvas engine={engine} /> : <div className="kv-canvas" />}
        <InspectorShell />
      </div>
      <Dock />
      <StatusBar graph={graph} layoutClean={layoutClean} />
    </div>
  );
}
