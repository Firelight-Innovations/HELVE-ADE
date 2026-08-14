/**
 * The right-click menu on a tree row: four things, all of them read-only.
 *
 * Copy the path, copy it relative to the project, show the item in the OS file
 * manager, hand it to whatever the OS opens it with.
 *
 * What it deliberately does not offer is rename, delete, and new file. Those
 * mutate the tree, and each needs a confirmation, an undo story and a
 * re-listing of the affected directory to be worth shipping — half of that set
 * is worse than none of it, because a menu with Delete in it teaches people
 * the menu is where you manage files, and then Rename's absence is a bug
 * rather than a boundary. Mutation is its own pass.
 *
 * Positioning is `position: fixed` at the pointer, clamped inside the viewport
 * before the first paint. It dismisses on Escape, on a pointer down anywhere
 * outside it, and on scroll — a menu anchored to a viewport point is wrong the
 * moment the row it belongs to moves, and the honest response is to close
 * rather than to chase.
 *
 * The first item takes focus on open, so the arrow keys stop driving the rows
 * behind the menu; `Explorer` hands focus back to the tree when it closes.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { describe, openExternal, reveal } from "../rpc";

export interface MenuTarget {
  path: string;
  /** Viewport coordinates of the click that opened it. */
  x: number;
  y: number;
}

/** Kept off the viewport edges so the border is never flush with the frame. */
const MARGIN = 4;

export default function ContextMenu({
  target,
  rootPath,
  onClose,
}: {
  target: MenuTarget;
  /** What "relative" is relative to. */
  rootPath: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState({ x: target.x, y: target.y });
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Clamp once the menu has a measured size.
   *
   * A layout effect, so the corrected position is in place before the browser
   * paints and the menu never appears at the wrong spot for a frame. It cannot
   * be computed up front: the width depends on the longest label, and the
   * height on how many items there are.
   */
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      x: Math.max(MARGIN, Math.min(target.x, window.innerWidth - rect.width - MARGIN)),
      y: Math.max(MARGIN, Math.min(target.y, window.innerHeight - rect.height - MARGIN)),
    });
  }, [target]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    // Scroll does not bubble, so the tree's own scrollport is only reachable
    // from here in the capture phase. The `true` is the whole reason
    // "dismiss on scroll" works at all.
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  /**
   * Run an item, and close only if it worked.
   *
   * A failure keeps the menu open with the reason in it. This app has no other
   * surface for one — `App.tsx`'s error line belongs to calls it made itself —
   * and a Reveal that silently did nothing is indistinguishable from a Reveal
   * that opened a window behind the app.
   */
  const run = (method: string, action: () => Promise<unknown>) => {
    setFailed(null);
    void action()
      .then(onClose)
      .catch((err: unknown) => setFailed(describe(method, err)));
  };

  return (
    <div
      ref={ref}
      className="explorer__menu"
      role="menu"
      style={{ left: at.x, top: at.y }}
      // A right-click *on* the menu should do nothing, not raise the webview's
      // own menu on top of this one.
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="explorer__menu-item"
        role="menuitem"
        autoFocus
        onClick={() => run("clipboard", () => navigator.clipboard.writeText(target.path))}
      >
        Copy path
      </button>
      <button
        type="button"
        className="explorer__menu-item"
        role="menuitem"
        onClick={() =>
          run("clipboard", () => navigator.clipboard.writeText(relativeTo(rootPath, target.path)))
        }
      >
        Copy relative path
      </button>
      <div className="explorer__menu-rule" role="separator" />
      <button
        type="button"
        className="explorer__menu-item"
        role="menuitem"
        onClick={() => run("files/reveal", () => reveal(target.path))}
      >
        Reveal in File Explorer
      </button>
      <button
        type="button"
        className="explorer__menu-item"
        role="menuitem"
        onClick={() => run("files/open-external", () => openExternal(target.path))}
      >
        Open with the default app
      </button>

      {failed && <p className="app__error explorer__menu-error">{failed}</p>}
    </div>
  );
}

/**
 * The path as written from the project root.
 *
 * A prefix strip rather than a path calculation: both strings came out of the
 * same backend on the same machine, so the root really is a textual prefix of
 * anything below it, and the separator is whatever it already used. A path
 * that somehow is not under the root copies whole rather than producing a
 * plausible-looking wrong answer — see the note in `rpc.ts` about the frontend
 * not being the second implementation of path semantics.
 */
function relativeTo(rootPath: string, path: string): string {
  if (!path.startsWith(rootPath)) return path;
  return path.slice(rootPath.length).replace(/^[\\/]+/, "");
}
