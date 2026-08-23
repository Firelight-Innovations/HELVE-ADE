import { useEffect } from "react";
import { motion } from "framer-motion";
import { settingsBackdrop, settingsScreen } from "../motion";
import { closeShortcuts } from "../shortcutsSurface";
import { Close } from "../../ui/Icon";
import { SHORTCUT_GROUPS, type Shortcut } from "./shortcuts";
import "./shortcuts.css";

/**
 * Every keystroke the shell binds, grouped and read-only.
 *
 * Read-only is the whole design. Rebinding means a stored keymap, a conflict
 * check against the ones the browser and the focused surface already own, and a
 * way back to the defaults — none of which exists, and a screen that offered to
 * rebind before any of it did would be promising something it could not keep.
 *
 * Borrows settings' motion, backdrop and geometry rather than defining its own,
 * for the reason `library.css` gives: these are the same kind of surface, and a
 * second set of numbers is a second thing to keep in step.
 */
export default function ShortcutsScreen() {
  // Escape closes, on `document` rather than in `useKeyboard.ts` — the argument
  // is `SettingsScreen`'s and applies here unchanged: the key means "leave this
  // surface", and the surface is the only thing that knows it is up.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeShortcuts();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <motion.div className="shortcuts__backdrop" {...settingsBackdrop} onClick={closeShortcuts}>
      <motion.div
        className="shortcuts__screen"
        {...settingsScreen}
        role="dialog"
        aria-label="Keyboard shortcuts"
        // The backdrop closes on click and the screen sits inside it, so without
        // this a click anywhere on the list would bubble out and dismiss it.
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcuts__header">
          <h1 className="shortcuts__title">Keyboard Shortcuts</h1>
          <button className="shortcuts__close" onClick={closeShortcuts} aria-label="Close">
            <Close />
          </button>
        </header>

        <div className="shortcuts__body">
          <p className="shortcuts__hint">
            These are fixed for now. Anything typed into a field stays typing — the shell takes a
            keystroke back only for the commands below.
          </p>
          {SHORTCUT_GROUPS.map((group) => (
            <section className="shortcuts__group" key={group.title}>
              <h2>{group.title}</h2>
              <ul className="shortcuts__list">
                {group.items.map((item) => (
                  <Row key={item.label} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** One binding: what it does on the left, the keys on the right. */
function Row({ item }: { item: Shortcut }) {
  return (
    <li className="shortcuts__row">
      <div className="shortcuts__text">
        <span className="shortcuts__label">{item.label}</span>
        {item.note && <span className="shortcuts__note">{item.note}</span>}
      </div>
      {/* A chip per key rather than one "Ctrl+Shift+S" string: the plus signs
          are separators everywhere except Ctrl++, where one of them is the key,
          and a reader should not have to work out which. */}
      <div className="shortcuts__keys">
        {item.keys.map((key, i) => (
          <kbd className="shortcuts__key" key={`${key}-${i}`}>
            {key}
          </kbd>
        ))}
      </div>
    </li>
  );
}
