/**
 * Schematify's shell — PRD §17 Wave 2. Opens the `auth-service` Service
 * Schematic (`../graph`) and draws the title bar, the tab strip, the
 * breadcrumb, the toolbar, the Outline, the Schematic host frame, the
 * Inspector shell, the dock frame, and the status bar around it.
 *
 * `?view=empty-stack` swaps the whole body for the Stack Schematic's
 * first-run empty state (`./shell/EmptyStack`) instead — see that module's
 * doc comment for why this wave reaches it by query param rather than by
 * building the tier switch that would otherwise show it.
 */
import { useEffect, useState } from "react";
import { reportPainted } from "@openkaava/bridge";
import { loadGraph, type ServiceGraph } from "./graph";
import { Breadcrumb } from "./shell/Breadcrumb";
import { Dock } from "./shell/Dock";
import { EmptyStack } from "./shell/EmptyStack";
import { InspectorShell } from "./shell/InspectorShell";
import { Outline } from "./shell/Outline";
import { SchematicHost } from "./shell/SchematicHost";
import { StatusBar } from "./shell/StatusBar";
import { TabStrip } from "./shell/TabStrip";
import { TitleBar } from "./shell/TitleBar";
import { Toolbar } from "./shell/Toolbar";
import "./shell/shell.css";

const SHOW_EMPTY_STACK =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("view") === "empty-stack";

export default function App() {
  const [graph, setGraph] = useState<ServiceGraph | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGraph().then((result) => {
      if (!cancelled) setGraph(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The condition is "the first frame is honest", the rule every app here
  // follows (`apps/README.md`, `apps/schematify/ui/src/rpc.ts`'s own
  // precedent) — the empty-stack view has nothing to load, so it paints
  // immediately; the populated view paints once the graph resolves.
  useEffect(() => {
    if (SHOW_EMPTY_STACK || graph !== null) reportPainted();
  }, [graph]);

  if (SHOW_EMPTY_STACK) {
    return (
      <div className="kv-shell">
        <EmptyStack />
      </div>
    );
  }

  if (!graph) return <div className="kv-shell" />;

  return (
    <div className="kv-shell">
      <TitleBar
        project="saas-backend"
        path="~/work/saas-backend"
        branch="main"
        uncommittedCount={3}
      />
      <TabStrip />
      <div className="kv-chrome-row">
        <Breadcrumb segments={["Stack", graph.serviceTitle]} activeSlug={graph.serviceSlug} />
        <Toolbar />
      </div>
      <div className="kv-shell__body">
        <Outline graph={graph} />
        <SchematicHost />
        <InspectorShell />
      </div>
      <Dock />
      <StatusBar graph={graph} />
    </div>
  );
}
