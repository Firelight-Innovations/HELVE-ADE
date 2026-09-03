/**
 * This app's one and only door to Rust. Everything else under
 * `apps/schematify/ui/src/` that needs an answer from the backend reads it
 * through here, never through its own `invoke` call — kept out of
 * `./index.ts` on purpose, since that module is imported by a plain-Node
 * unit test (`index.test.ts`) and `@openkaava/bridge`'s root export touches
 * `window` at module load (`packages/bridge/src/index.ts`), which a Node
 * test has none of.
 *
 * Today this wraps `schematify/state`, the one Tauri command this app has
 * registered (`src-tauri/src/apps/schematify.rs`) — unused by any component
 * yet, since no view needs `project`/`ready` this wave. `./index.ts`'s
 * `loadGraph()` is where a real `invoke("schematify/load-graph", …)` call
 * lands once `crates/schematify-core` merges, and it will call through this
 * file rather than opening a second one.
 */
import { KaavaRpcError, invoke } from "@openkaava/bridge";

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
