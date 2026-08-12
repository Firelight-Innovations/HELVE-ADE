/**
 * The eight inline menu labels, ≥1100px.
 *
 * Standard menu-bar behaviour: a menu opens on click; while one is open,
 * hovering a sibling switches to it without a second click; Escape or a click
 * outside closes whichever is open. One `openLabel` captures all of that — the
 * dropdown that's showing is just "the menu whose label equals `openLabel`".
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Menu } from "../contract";
import { popover } from "../motion";
import MenuItemList from "./MenuItemList";

export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openLabel === null) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenLabel(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenLabel(null);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openLabel]);

  return (
    <div className="menubar" ref={rootRef}>
      {menus.map((menu) => (
        <div key={menu.label} className="menubar__item-wrap">
          <button
            type="button"
            className="menubar__item"
            data-open={openLabel === menu.label || undefined}
            onClick={() => setOpenLabel((cur) => (cur === menu.label ? null : menu.label))}
            onPointerEnter={() => {
              if (openLabel !== null && openLabel !== menu.label) setOpenLabel(menu.label);
            }}
          >
            {menu.label}
          </button>
          <AnimatePresence>
            {openLabel === menu.label && (
              <motion.div
                className="menubar__dropdown"
                initial={popover.initial}
                animate={popover.animate}
                exit={popover.exit}
              >
                <MenuItemList items={menu.items} onAfterSelect={() => setOpenLabel(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
