/**
 * "Open an app here" — the Apps menu, in the row where the apps actually are.
 *
 * The menu bar already answers "open another app", and it is three regions and
 * a click away from the tabs it adds to. This puts the same question at the end
 * of the open cluster's own tabs, where the answer lands.
 *
 * ## It is the same menu, not a second one
 *
 * The items come from `appsMenu()` in `titlebar/TitleBar.tsx` — the single
 * definition the menu bar's Apps menu is also built from — and are rendered by
 * `MenuItemList`, the same component both menu surfaces use. Nothing about the
 * list is restated here. An app added to the registry appears in both places or
 * neither, which is the only way two surfaces showing "every app" can be kept
 * honest: there is nothing to keep in sync.
 *
 * Both imports cross out of this region, which the contract otherwise forbids.
 * That is the point of the exercise rather than a lapse — the instruction was to
 * reuse the existing menu, and a copy of it that happened to live on the correct
 * side of a module boundary would be the exact drift the boundary is meant to
 * prevent.
 *
 * ## Why the surface is portalled
 *
 * `.switcher__tabs` is `overflow-x: auto; overflow-y: hidden` — it is the row's
 * horizontal scroll container. A menu positioned inside it would be clipped to
 * the 34px bar and never seen. `position: fixed` does not save it either: framer
 * puts a `transform` on `.switcher__group` and `.switcher__members` whenever the
 * row is animating, and a transformed ancestor becomes the containing block for
 * fixed descendants, so the menu would slip back inside the clip mid-animation.
 * So it is a portal into `document.body` at coordinates measured off the button.
 *
 * The container is `document.body` always, never a moving element — the
 * remount-on-container-change hazard `ToolWindow` and `PaneTree` document does
 * not arise, and there is no iframe here to reload if it did.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { popover } from "../motion";
import MenuItemList, { inMenuSurface } from "../titlebar/MenuItemList";
import { appsMenu, type AppsMenuHandlers } from "../titlebar/TitleBar";
import { Plus } from "../../ui/Icon";
import "./addapp.css";

/**
 * The menu's narrowest width, in one place because two things need it: the
 * surface itself, and the arithmetic that keeps it inside the window. Written
 * here rather than in `addapp.css` so the clamp below cannot be reasoning about
 * a different number than the one that gets drawn.
 *
 * 200px is `.menubar__dropdown`'s `min-width`, reused rather than picked: this
 * is the same list of rows, in the same typeface, at the same padding.
 */
/**
 * Re-exported so `ClusterBar` can type the prop it forwards from one import.
 * The tab row has no business knowing the title bar exists; this component is
 * the only thing in the region that does, and it hands the shape on.
 */
export type { AppsMenuHandlers };

const MENU_MIN_WIDTH = 200;

/** Keeps the surface off both window edges when the button is near one. */
const EDGE_GAP = 8;

export default function AddAppButton({ apps }: { apps: AppsMenuHandlers }) {
  const [open, setOpen] = useState(false);
  // Measured once, when the menu opens. Anything that could invalidate it —
  // a resize, a scroll of the row this button sits in — closes the menu rather
  // than chasing it, which is what the listeners below are for.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismissal, matching the health popover in `ClusterBar` — a click outside,
  // or Escape — with one addition it does not need and this does: `blur`.
  //
  // Most of this window is not in this document. Every app and tool surface is
  // an iframe, and a pointer event inside one never reaches the shell's
  // `window`, so clicking into the file tree or a terminal would leave this menu
  // hanging open with no way to dismiss it but clicking the button again.
  // `MenuBar` hit exactly this and documents the fix; a menu built out of
  // `MenuBar`'s own item list inherits the problem, so it inherits the fix.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The surface is portalled out of this component's DOM subtree, so
      // "outside" has to be asked of both boxes. Missing the menu here would
      // unmount it on the pointerdown of the very click meant to choose an
      // item, and the `click` would then land on nothing.
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      // And the same again one level deeper: a row in this menu can open a
      // submenu, which is portalled to `document.body` for the same clipping
      // reason this menu is and so is in neither box above. See `inMenuSurface`.
      if (inMenuSurface(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDetached = () => setOpen(false);
    // The scroll listener below is capture-phase and so hears *every* scroll in
    // the document, including one inside this menu's own portalled submenu —
    // which, with enough saved presets, is a surface that scrolls. Closing the
    // menu because someone scrolled the list they were reading is the opposite
    // of what "a scroll invalidates the measurement" was guarding against; the
    // measurement this menu depends on is the row's, and that has not moved.
    const onScroll = (e: Event) => {
      if (inMenuSurface(e.target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onDetached);
    window.addEventListener("resize", onDetached);
    // Capture, because the scroll that matters is `.switcher__tabs`'s own and a
    // scroll event does not bubble.
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onDetached);
      window.removeEventListener("resize", onDetached);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      // Flush under the button, like `.switcher__popover` under its badge.
      top: rect.bottom,
      // Left-aligned to the button, so it opens toward the middle of the bar —
      // this button is on the row's leading side, where the health popover is
      // right-aligned because it is on the trailing one. Clamped so a cluster
      // scrolled hard right cannot push the surface off the window.
      left: Math.max(EDGE_GAP, Math.min(rect.left, window.innerWidth - MENU_MIN_WIDTH - EDGE_GAP)),
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="addapp"
        data-open={open || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        // Said in full, because there is a second `+` a few tabs to the right
        // that makes a whole new cluster. Neither label may be just "Add".
        //
        // "Open something", not "open an app": the menu offers a terminal
        // alongside the apps now (see `apps::openables`) and a submenu of
        // layout presets under them, and a label naming only apps would be
        // describing a third of what the button does.
        aria-label="Open something in this cluster"
        title="Open something in this cluster"
        onClick={toggle}
      >
        {/* No disclosure caret any more — this used to carry a rotated
            `ChevronRight` to say "this opens a menu, the cluster `+` just
            acts". What separates the two now: this button sits inside the
            open cluster's accent-banded fill, the cluster `+` sits outside
            it; this one rests at the dimmer `--text-dim-3` where the cluster
            `+` rests at `--text-dim` and is wider; and the two have distinct
            aria-labels for anyone not reading either signal. */}
        <Plus size={11} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && at && (
            <motion.div
              ref={menuRef}
              className="addapp__menu"
              style={{ top: at.top, left: at.left, minWidth: MENU_MIN_WIDTH }}
              variants={popover}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <MenuItemList items={appsMenu(apps).items} onAfterSelect={() => setOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
