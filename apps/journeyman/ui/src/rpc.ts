/**
 * Every call this app makes to its host, in one file. The shape mirrors
 * `src-tauri/src/apps/journeyman.rs` and is restated rather than imported, for
 * the reason `apps/design/ui/src/rpc.ts` gives.
 */
import { invoke } from "@helve-ade/bridge";

/**
 * `journeyman/state`'s reply — everything Journeyman can say about itself
 * today. `ready` is not a loading flag: it is the honest, permanent answer for
 * a build system that has not been written yet, and stays `false` until there
 * is something behind it.
 */
export interface JourneymanState {
  /** The open project's path, as the backend resolved it for this cluster.
   *  `null` when this cluster has nothing open. */
  project: string | null;
  ready: boolean;
}

export const readState = () => invoke<JourneymanState>("journeyman/state");
