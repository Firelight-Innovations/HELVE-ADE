/**
 * This app's one and only door to Rust. Kept out of `./index.ts` on purpose:
 * that module is imported by a plain-Node unit test, and `@openkaava/bridge`'s
 * root export touches `window` at module load, which a Node test has none of.
 * `./index.ts`'s `defaultSeam` reaches everything below through a dynamic
 * `import("./backend")` for the same reason.
 *
 * Wraps the methods `src-tauri/src/apps/schematify.rs` answers as of this
 * wave, plus wave 10c's five product-layer writes (`write-screen`,
 * `write-flow`, `write-brief`, `write-decision`, `supersede-decision`) and
 * `loadProductGraph`, which reads `schematify/load-graph`'s `screens`,
 * `flows`, `decisions` and `brief` fields — the ones `loadRealGraph` below
 * discards on its way to a `ServiceGraph`. `open-project` and `write-node`/
 * `write-edge` are not called from here — see `createBackendSeam`'s doc
 * comment and `docs/overnight-jobs/overnight-2/handoffs/wiring.md`. Per
 * `CLAUDE.md`, this file stays the only one in this app that contains
 * `invoke` — a new operation gets a new function here, never a new file.
 */
import { KaavaRpcError, invoke } from "@openkaava/bridge";
import type { RawDecision, RawFlow, RawProjectBrief, RawScreen } from "../product/types";
import { DENSE_SERVICE_GRAPH } from "./dense";
import type { LayoutFile } from "./layout";
import { projectServiceGraph, type RawGraph } from "./project";
import type { ServiceGraph } from "./types";

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

/** The Service Schematic this app opens on: `engine/presets.ts`'s
 *  `SERVICE_CONFIG` hardcodes `layoutSlug: "auth-service"`, and
 *  `fixtures/saas-backend/` was built to reproduce PRD §16.1's
 *  `auth-service` exactly, so this is the one slug the rest of the app
 *  already assumes rather than an independent guess. */
const DEFAULT_SERVICE_SLUG = "auth-service";

interface LoadGraphResponse {
  graph: RawGraph;
  report: { clean: boolean };
}

/** `schematify/load-graph`, projected to the one service this app draws —
 *  see `./project.ts`. */
async function loadRealGraph(): Promise<ServiceGraph> {
  const response = await invoke<LoadGraphResponse>("schematify/load-graph", { actor: ACTOR });
  return projectServiceGraph(response.graph, DEFAULT_SERVICE_SLUG);
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
 *  restated rather than imported, following `apps/files/ui/src/rpc.ts`'s own
 *  convention for its Rust counterpart. */
interface SchematifySeamLike {
  loadGraph(): Promise<ServiceGraph>;
  loadDenseGraph(): Promise<ServiceGraph>;
  readLayout(slug: string): Promise<LayoutFile | null>;
  writeLayout(slug: string, file: LayoutFile): Promise<void>;
  writeSemantic(path: string, json: unknown): Promise<void>;
  removeSemantic(path: string): Promise<void>;
}
