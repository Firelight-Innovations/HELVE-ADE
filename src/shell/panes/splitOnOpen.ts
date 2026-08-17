import { paneRect } from "../dropZones";
import type { SplitDir } from "../contract";

/**
 * Which way the focused pane splits when something is opened into it: along its
 * longer axis, falling back to the window's shape when there is no pane to
 * measure. Rust decides that an open gets a pane of its own at all
 * (`PaneNode::open_into` in `src-tauri/src/layout.rs`); this is the one piece it
 * cannot decide, because "longer" is a fact about pixels.
 *
 * The argument in full — the rule, why it is not derived in Rust, and why the
 * fallback is the right guess — is in `docs/design-notes/shell-surfaces.md`.
 */
export function splitDirOnOpen(paneId: string | null): SplitDir {
  const rect = paneId ? paneRect(paneId) : null;
  const width = rect?.width || window.innerWidth;
  const height = rect?.height || window.innerHeight;
  return width >= height ? "row" : "column";
}
