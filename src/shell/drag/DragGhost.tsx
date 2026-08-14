/**
 * The chip that follows the cursor during a drag.
 *
 * Two payload kinds, two exact readings from the handoff's interaction
 * crops (docs/handoffs/shell-spec.html):
 *
 *   - Tool (INTERACTION 01, frame 2): height 28px, padding 0 13px, name at
 *     `font:500 12px/1 'IBM Plex Sans'`.
 *   - Terminal (INTERACTION 02): height 25px, padding 0 11px, gap 7px to a
 *     5px status dot, title at `font:500 11px/1 'IBM Plex Sans'`.
 *
 * Both share background `--surface-2` ("ghost chip" in the token table),
 * border `--accent-line-strong` (the crop's `rgba(217,138,63,.7)`), 4px
 * radius, and `opacity: .92`. The two box-shadow alphas (.5 tool, .55
 * terminal) are kept as drawn rather than collapsed into one.
 *
 * An app surface's ghost shows only its title — no health, no version, matching
 * "no per-tool state on tabs." A terminal's shows its title and the same *agent
 * finished* dot the panel tab carries; nothing else reaches the ghost either.
 *
 * The two readings are kept even though the payload types have merged. `kind`
 * still says which of the two a tab is, and the crops still specify different
 * sizes for them — one payload type was the right simplification, one visual
 * treatment would have been a redesign nobody asked for.
 */
import type { MotionValue } from "framer-motion";
import { motion } from "framer-motion";
import type { DragPayload } from "../contract";

export default function DragGhost({
  payload,
  x,
  y,
}: {
  payload: DragPayload;
  x: MotionValue<number>;
  y: MotionValue<number>;
}) {
  return (
    <motion.div
      className={`drag-ghost drag-ghost--${payload.kind}`}
      style={{ left: x, top: y }}
    >
      <span className="drag-ghost-label">{payload.title}</span>
      {payload.kind === "terminal" && payload.agentFinished && <span className="drag-ghost-dot" />}
    </motion.div>
  );
}
