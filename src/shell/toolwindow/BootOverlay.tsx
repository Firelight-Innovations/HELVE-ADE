import { motion } from "framer-motion";
import { BootArc } from "../../ui/Icon";
import { snap, spinArc } from "../motion";

/** Optional step signal. No backend reports this yet — see the indeterminate
 * branch below — but the shape is ready for when one does. */
export interface BootProgress {
  step: number;
  total: number;
}

/**
 * The boot overlay: laid over the tool window while a tool is starting.
 * Measured from the "Starting Forger" crop (docs/handoffs/shell-spec.html,
 * REGION DETAIL — "Panel, search, warnings, booting").
 *
 * Determinate when `progress` is supplied, indeterminate otherwise — no step
 * source exists yet, so every caller today gets the indeterminate form.
 */
export default function BootOverlay({ toolName, progress }: { toolName: string; progress?: BootProgress }) {
  const fraction = progress ? Math.min(Math.max(progress.step / progress.total, 0), 1) : 0;

  return (
    <div className="boot">
      <div className="boot__inset" />
      <div className="boot__column">
        {/* The arc rotates continuously; the track circle doesn't — but it's
            a perfect circle with uniform stroke, so rotating the whole SVG
            reads identically to rotating only the arc. */}
        <motion.div className="boot__arc" animate={{ rotate: 360 }} transition={spinArc}>
          <BootArc />
        </motion.div>
        <div className="boot__title">Starting {toolName}</div>
        <div className="boot__track">
          {progress ? (
            <motion.div
              className="boot__fill"
              style={{ transformOrigin: "left" }}
              animate={{ scaleX: fraction }}
              transition={snap}
            />
          ) : (
            <motion.div
              className="boot__fill boot__fill--indeterminate"
              animate={{ x: [-70, 200] }}
              transition={spinArc}
            />
          )}
        </div>
        {progress && (
          <div className="boot__step">
            step {progress.step} of {progress.total}
          </div>
        )}
        <div className="boot__cancel">cancel ⌘.</div>
      </div>
    </div>
  );
}
