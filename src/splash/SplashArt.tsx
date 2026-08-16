import { motion } from "framer-motion";
import { spinArc } from "../shell/motion";
import { BootArc, BrandGlyph } from "../ui/Icon";

/**
 * The splash window's signature mark: the shell's own brand glyph — the same
 * one drawn small in the titlebar and dim in the tool window's empty state —
 * ringed by the same arc `BootOverlay` spins over a tool while it starts.
 *
 * Nothing here is unique to this window, and that's the point. The very
 * first thing a user sees on launch used to be a one-off piece of concept
 * art (a hand-drawn anvil and hammer) that appeared nowhere else in the
 * product. Reusing the real mark and the real boot motif instead means this
 * screen already looks like the application it's about to hand off to,
 * rather than a splash page bolted on in front of it.
 */
export default function SplashArt({ spinning }: { spinning: boolean }) {
  return (
    <div className="splash-art">
      {/* `{}` rather than `{ rotate: 0 }` while stopped: there's no target
          value to reach, so this just lets the spin freeze wherever it was
          instead of snapping backwards to 0. */}
      <motion.div
        className="splash-art__ring"
        animate={spinning ? { rotate: 360 } : {}}
        transition={spinArc}
      >
        <BootArc size={84} />
      </motion.div>
      <BrandGlyph size={34} className="splash-art__mark" />
    </div>
  );
}
