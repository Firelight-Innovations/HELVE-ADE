/**
 * The two drop-target outlines. Both fade and scale in with `instant` (and
 * out with `instantOut`) — nothing here invents a transition, the numbers
 * live in `motion.ts` and this file only composes them into a variant.
 */
import type { MotionValue } from "framer-motion";
import { motion } from "framer-motion";
import { instant, instantOut } from "../motion";

const fade = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: instant },
  exit: { opacity: 0, scale: 0.98, transition: instantOut },
};

/**
 * "Clear of the bar. Ghost follows the cursor, outline previews the new
 * window" (INTERACTION 01, frame 2). The crop draws this at a specific
 * size, but that size is the storyboard's own layout, not a stated
 * dimension — the handoff explicitly leaves a detached window's real size
 * undecided ("NOT DECIDED — DO NOT INVENT"). This outline is decoration for
 * the drag, not a claim about that size: a fixed, modest rectangle near the
 * ghost, in the same dashed-accent treatment the crop draws
 * (`1.5px dashed rgba(217,138,63,.6)`, 5px radius, `--accent-wash-faint`
 * fill — the .6 border alpha has no matching named token, so it's kept
 * literal here rather than forced onto a nearby one).
 */
export function DetachOutline({ x, y }: { x: MotionValue<number>; y: MotionValue<number> }) {
  return <motion.div className="drag-detach-outline" style={{ left: x, top: y }} {...fade} />;
}

/**
 * "monitor 2 — drop target lit" (INTERACTION 02), for the terminal panel.
 *
 * Takes its rectangle rather than querying for one. The old version looked up
 * `[data-region="panel"]` itself, which worked while the panel was the only
 * target there could be; a caller that already knows which registered zone is
 * lit should not have that answer re-derived behind its back, and the pane
 * indicators are drawn by `panes/PaneTree.tsx` from the same `target` value.
 */
export function ZoneOutline({ rect }: { rect: DOMRect | null }) {
  if (!rect) return null;
  return (
    <motion.div
      className="drag-panel-outline"
      style={{ left: rect.left, top: rect.top, width: rect.width }}
      {...fade}
    />
  );
}
