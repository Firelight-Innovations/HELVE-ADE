/**
 * This app's one and only door to Rust. Kept out of `./index.ts` on purpose:
 * that module is imported by a plain-Node unit test, and `@openkaava/bridge`'s
 * root export touches `window` at module load, which a Node test has none of.
 * `./index.ts`'s `defaultSeam` reaches everything below through a dynamic
 * `import("./backend")` for the same reason.
 *
 * Wraps 8 of the 9 methods `src-tauri/src/apps/schematify.rs` answers as of
 * this wave (`schematify/state` was Wave 1a's). `open-project`,
 * `write-node` and `write-edge` are not called from here — see
 * `createBackendSeam`'s doc comment and `docs/overnight-jobs/overnight-2/handoffs/wiring.md`.
 */
import { KaavaRpcError, invoke } from "@openkaava/bridge";
import type { Dashboard, RawRunsReport } from "./dashboard";
import { DENSE_SERVICE_GRAPH } from "./dense";
import type { LayoutFile } from "./layout";
import type { RawLintReport } from "./problems";
import { projectModuleGraph, projectServiceGraph, type RawGraph } from "./project";
import type { SchematicGraph, ServiceGraph, Tier } from "./types";

export interface SchematifyState {
  project: string | null;
  ready: boolean;
}

export const fetchState = () => invoke<SchematifyState>("schematify/state");

/** The host's own words for why a call failed, following
 *  `apps/design/ui/src/rpc.ts`: every refusal on the Rust side is written as
 *  a sentence for a person, so none is mapped to a category here. */
export function reasonForFailure(err: unknown): string {
  if (err instanceof KaavaRpcError) return err.message;
  return String(err);
}

/** Every `schematify/*` operation carries `actor` (PRD §14.5, SCH-API-003).
 *  This app has no agent-initiated gesture yet, so `"human"` is the only
 *  value sent — see the wiring handoff for the record of that choice. */
const ACTOR = "human";

/** The default landing view: `engine/presets.ts`'s `SERVICE_CONFIG`
 *  hardcodes `layoutSlug: "auth-service"`. Only a default now that
 *  `loadRealGraph` honours whatever `slug` it is actually called with. */
const DEFAULT_SERVICE_SLUG = "auth-service";

interface LoadGraphResponse {
  graph: RawGraph;
  report: { clean: boolean };
}

// `schematify/load-graph`, projected to whichever tier and slug the caller
// asked for. Previously ignored both, always returning the `auth-service`
// Service Schematic — the bug a Module-location Problems row's
// click-through ran into (wave 7b's handoff). `service` routes to
// `./project.ts`'s `projectServiceGraph`, already generic across any slug.
// `module` routes to the new `projectModuleGraph` — Stack and Module had no
// real projector before, only `./stack.ts`/`./module.ts`'s stand-ins.
// `stack` still has none, out of scope here and unreached by any reference
// Problems row, so it draws the same empty graph `./index.ts`'s stand-in
// loader returns for a slug it has no fixture for.
async function loadRealGraph(
  tier: Tier = "service",
  slug: string = DEFAULT_SERVICE_SLUG,
): Promise<SchematicGraph> {
  if (tier === "stack") {
    return { tier: "stack", serviceSlug: slug, serviceTitle: slug, nodes: [], edges: [] };
  }
  const response = await invoke<LoadGraphResponse>("schematify/load-graph", { actor: ACTOR });
  return tier === "module"
    ? projectModuleGraph(response.graph, slug)
    : projectServiceGraph(response.graph, slug);
}

/** `schematify/read-layout`. `null` is the first-run state, not a failure. */
function readRealLayout(slug: string): Promise<LayoutFile | null> {
  return invoke<LayoutFile | null>("schematify/read-layout", { actor: ACTOR, slug });
}

/** `schematify/write-layout`. Writes `layout/<slug>.json` and nothing else —
 *  PRD §6.2's enforcement point, and the one write this wave makes real. */
async function writeRealLayout(slug: string, file: LayoutFile): Promise<void> {
  await invoke("schematify/write-layout", { actor: ACTOR, slug, layout: file });
}

/** `schematify/lint`. Wave 7a's own arm (`src-tauri/src/apps/schematify.rs`),
 *  widened this wave to carry `Location.slug` and `Finding.rule_name` — the
 *  2 fields the Problems panel needs that a Rust-only caller (a test, a
 *  future CLI) had no reason to want. Lints the whole project on every call,
 *  same as the Rust side: PRD §0.4 makes the finding count computed at read
 *  time, never stored, so there is nothing to invalidate. */
export function fetchLintReport(): Promise<RawLintReport> {
  return invoke<RawLintReport>("schematify/lint", { actor: ACTOR });
}

/** `schematify/module-dashboard` (wave 9d's own arm, PRD §12.13). `module`
 *  accepts either a node id or a slug — see the Rust function's own doc
 *  comment for why: the Module Schematic's own stand-in engine
 *  (`./module.ts`) has no real backend uuid to hand this call yet. */
export function fetchModuleDashboard(module: string): Promise<Dashboard> {
  return invoke<Dashboard>("schematify/module-dashboard", { actor: ACTOR, module });
}

/** `schematify/runs` (wave 9d's own arm, PRD §12.2 S-14). Project-wide,
 *  independent of which tier is open — same "whole project, not one tier"
 *  scope `fetchLintReport` already draws for the Problems panel. */
export function fetchRuns(): Promise<RawRunsReport> {
  return invoke<RawRunsReport>("schematify/runs", { actor: ACTOR });
}

/** `schematify/ingest-run` (wave 9d's own arm): the Tauri wiring for wave
 *  9b's `schematify_core::ingest_run_file`. `module` is the node whose CI
 *  workflow produced the run; `path` is wherever CI dropped the
 *  `kaava-bench-v1` artifact, outside `.kaava/`. */
export function ingestRun(module: string, path: string): Promise<{ ingested: boolean }> {
  return invoke<{ ingested: boolean }>("schematify/ingest-run", { actor: ACTOR, module, path });
}

/**
 * The seam the running application uses once a real project is open.
 *
 * `writeSemantic`/`removeSemantic` stay in-memory, not wired to
 * `schematify/write-node`/`write-edge`. `engine/engine.ts`'s own
 * `nodeJson`/`edgeJson` (reparent, duplicate, edge creation) send a
 * deliberately partial node or edge — no `lifecycle`, `authored_by` or
 * `created` — because that engine "writes only what a duplicate or a
 * reparent can honestly know". Those fields are required on the real schema,
 * so routing the partial payload straight through would fail every gesture;
 * inventing the missing content here would be guessing, not wiring. A node
 * drag persists for real (`writeLayout`, above); a reparent, duplicate, or
 * dragged edge persists only for the session, same as before this wave. Full
 * record: `docs/overnight-jobs/overnight-2/handoffs/wiring.md`.
 */
export function createBackendSeam(): SchematifySeamLike {
  const semantic = new Map<string, unknown>();
  return {
    loadGraph: loadRealGraph,
    loadDenseGraph: () => Promise.resolve(DENSE_SERVICE_GRAPH),
    readLayout: readRealLayout,
    writeLayout: writeRealLayout,
    writeSemantic: (path: string, json: unknown) => {
      semantic.set(path, json);
      return Promise.resolve();
    },
    removeSemantic: (path: string) => {
      semantic.delete(path);
      return Promise.resolve();
    },
  };
}

/** What `createBackendSeam` returns — `./index.ts`'s `SchematifySeam`
 *  restated rather than imported, following `apps/files/ui/src/rpc.ts`'s
 *  convention. `loadGraph`'s 2 params were the one place this had drifted:
 *  `(): …` let `loadRealGraph` silently ignore its real callers' arguments,
 *  since JavaScript never enforces arity. */
interface SchematifySeamLike {
  loadGraph(tier?: Tier, slug?: string): Promise<ServiceGraph>;
  loadDenseGraph(): Promise<ServiceGraph>;
  readLayout(slug: string): Promise<LayoutFile | null>;
  writeLayout(slug: string, file: LayoutFile): Promise<void>;
  writeSemantic(path: string, json: unknown): Promise<void>;
  removeSemantic(path: string): Promise<void>;
}
