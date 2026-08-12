/**
 * The two drop-target outlines. Both fade and scale in with `instant` (and
 * out with `instantOut`) — nothing here invents a transition, the numbers
 * live in `motion.ts` and this file only composes them into a variant.
 */
import { useEffect, useState } from "react";
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
 * "monitor 2 — drop target lit" (INTERACTION 02). The crop's precise
 * treatment is an insertion slot between two tabs inside the target panel's
 * own tab row — not reachable from here without editing `panel/`, which is
 * out of this parcel's files. This renders the closest thing the overlay
 * can draw on its own: the whole tab row lit the same way the crop's row
 * is (`--surface-gap` fill, `rgba(217,138,63,.55)` bottom rule — again kept
 * literal, no named token matches .55). Flagged in the report as a
 * simplification, not the full per-slot treatment.
 */
export function PanelDropOutline() {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const measure = () => {
      const panel = document.querySelector('[data-region="panel"]');
      setRect(panel ? panel.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (!rect) return null;

  return (
    <motion.div
      className="drag-panel-outline"
      style={{ left: rect.left, top: rect.top, width: rect.width }}
      {...fade}
    />
  );
}
