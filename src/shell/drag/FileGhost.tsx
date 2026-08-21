/**
 * The chip that follows the cursor while a file is dragged out of an app frame.
 *
 * Deliberately the terminal ghost's shape rather than a fourth box: 25px tall,
 * padding 0 11px, `font: 500 11px/1 'IBM Plex Sans'` — see `DragGhost`, which
 * reads all three off INTERACTION 02 in the handoff. A drag is a drag, and the
 * only crop that covers one shows chips of two sizes for two kinds of tab, not
 * a size per payload. The only difference is the dot, which a terminal ghost
 * carries to mean *agent finished* and a file has no equivalent of.
 *
 * Only a *frame's* drag draws one. An operating-system drag already has
 * Explorer's own cursor attached, and a second chip beside it would be two
 * answers to "what am I carrying".
 */
import type { MotionValue } from "framer-motion";
import { motion } from "framer-motion";

export default function FileGhost({
  paths,
  x,
  y,
}: {
  /** At least one; the caller refuses an empty drag before it starts. */
  paths: string[];
  x: MotionValue<number>;
  y: MotionValue<number>;
}) {
  return (
    <motion.div className="drag-ghost drag-ghost--file" style={{ left: x, top: y }}>
      <span className="drag-ghost-label">{label(paths)}</span>
    </motion.div>
  );
}

/** The last component of a single path, or a count. A full path would make the
 *  chip as wide as the window, and the name is what the row being dragged
 *  showed — the chip should look like the thing it was lifted from. Both
 *  separators are checked because a Windows path can hold either, and this is
 *  the only path arithmetic in the shell for the reason `rpc.ts` gives in the
 *  Files app: the backend owns path semantics. */
function label(paths: string[]): string {
  if (paths.length > 1) return `${paths.length} files`;
  const path = paths[0] ?? "";
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut === -1 ? path : path.slice(cut + 1);
}
