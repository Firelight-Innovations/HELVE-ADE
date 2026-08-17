import { motion } from "framer-motion";
import { popover } from "../motion";
import { openSettings } from "../settingsSurface";

/**
 * The settings popover — three ways into one screen.
 *
 * Every item opens the same surface; what differs is where it lands. That is
 * deliberate rather than a shortcut: a popover that held its own controls would
 * be a second settings interface, and the two would drift the first time
 * somebody added a setting to only one of them. This is a menu, and the screen
 * behind it is the product.
 *
 * `openSettings` rather than a prop, because the screen is mounted in `App.tsx`
 * above the window this bar is inside — see `shell/settingsSurface.ts` for why
 * that boundary is where it is.
 */
export default function SettingsPopover({ onPicked }: { onPicked: () => void }) {
  const open = (section?: string) => () => {
    openSettings(section);
    // The popover dismisses on the click that opened the screen. Leaving it up
    // behind a full-window surface would mean finding it still there on the way
    // back, pointing at a screen you had already been to.
    onPicked();
  };

  return (
    <motion.div
      className="statusbar__popover"
      variants={popover}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="statusbar__popover-header">SETTINGS</div>
      <button type="button" className="statusbar__popover-item" onClick={open()}>
        All settings
      </button>
      {/* Two shortcuts to sections, not two features. `mcp` is here because the
          server list is the thing most likely to be checked mid-session, and
          `appearance` because it is the section people go looking for by name.
          Neither id is guessed — both are registered in
          `src-tauri/src/settings/schema.rs`, and a section that stopped existing
          would open the screen on its first one rather than on nothing. */}
      <button type="button" className="statusbar__popover-item" onClick={open("mcp")}>
        MCP servers
      </button>
      <button type="button" className="statusbar__popover-item" onClick={open("appearance")}>
        Appearance
      </button>
    </motion.div>
  );
}
