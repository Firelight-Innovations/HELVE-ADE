import { motion } from "framer-motion";
import { popover } from "../motion";

/**
 * The settings popover.
 *
 * The handoff draws the sliders glyph that opens this and says settings has
 * no other entry point in the shell, but it does not draw what the popover
 * contains — that design has not landed. Built to match the tool health
 * popover's surface, border, radius and shadow (src/shell/switcher/
 * HealthPopover.tsx is the closest reference), with a small number of inert
 * placeholder items standing in for whatever settings surface arrives later.
 * Replace the items below; keep the container.
 */
export default function SettingsPopover() {
  return (
    <motion.div className="statusbar__popover" variants={popover} initial="initial" animate="animate" exit="exit">
      <div className="statusbar__popover-header">SETTINGS</div>
      <button type="button" className="statusbar__popover-item">
        Preferences
      </button>
      <button type="button" className="statusbar__popover-item">
        Keyboard Shortcuts
      </button>
      <button type="button" className="statusbar__popover-item">
        About HELVE
      </button>
    </motion.div>
  );
}
