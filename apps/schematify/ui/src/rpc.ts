/**
 * Every call this app makes to its host, in one file. The shape mirrors
 * `src-tauri/src/apps/schematify.rs` and is restated rather than imported,
 * for the reason `apps/files/ui/src/rpc.ts` gives: an app's only coupling to
 * its host is `@openkaava/bridge`, not a shared type crossing the process
 * boundary that separates the frontend build from the Rust one.
 */
import { KaavaRpcError, invoke } from "@openkaava/bridge";

/** What `schematify/state` reports. `project` is `null` when this cluster has
 *  none open yet; `ready` is `false` in every build until the Schematic engine
 *  lands behind it — see the Rust doc comment for why the field exists before
 *  it has a second value to take. */
export interface State {
  project: string | null;
  ready: boolean;
}

export const fetchState = () => invoke<State>("schematify/state");

/** The host's own words for why a call failed, following `design/ui/src/rpc.ts`:
 *  every refusal on the Rust side is written as a sentence for a person, so
 *  none is mapped to a category here. */
export function reasonFor(err: unknown): string {
  if (err instanceof KaavaRpcError) return err.message;
  return String(err);
}
