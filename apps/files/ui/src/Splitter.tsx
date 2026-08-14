/**
 * The divider between the tree and the viewer.
 *
 * The mechanics are `src/shell/frame/Frame.tsx`'s, ported rather than imported:
 * an app may not reach into `src/`, and `Frame` is the whole window's geometry
 * — five bands, a collapse animation and a maximize gesture — of which a
 * divider is one paragraph. What carries over is the part that matters, and
 * each piece of it is load-bearing:
 *
 * - The width is a framer-motion `MotionValue` **written straight to the DOM**,
 *   never React state. That is the whole reason a drag is 1:1 with the cursor:
 *   a re-render per pointer event cannot promise that under load, and a
 *   splitter that lags the pointer by a frame feels broken in a way no amount
 *   of smoothing fixes.
 * - `window`-level pointer listeners, not the handle's. Pointer capture is an
 *   optimisation on top; the drag has to survive the cursor outrunning six
 *   pixels of handle, which it does immediately.
 * - `setPointerCapture` inside `try`/`catch` — see `Frame.tsx` for why. It
 *   throws for a pointer id the browser no longer considers active, and bare,
 *   a throw would abort the handler before the window listeners were attached
 *   and lose the gesture outright.
 *
 * What deliberately did **not** port: the maximize gesture and its hysteresis.
 * A panel that can swallow the whole row needs two thresholds and a dead zone
 * between them; a divider with a floor on each side needs one clamp. Adding
 * the machinery for a state this app has no way to be in would be carrying
 * `Frame`'s complexity without carrying its feature.
 *
 * **The width is not persisted, on purpose.** `src/shell/WindowRoot.tsx` gives
 * the reasoning for the shell's own panel and it applies here unchanged: a pane
 * width is a fact about this screen, not about the project.
 */
import { useCallback, useEffect, useRef } from "react";
import type { MotionValue } from "framer-motion";

/** Arrow-key step, and the step with Shift held. */
const NUDGE = 8;
const NUDGE_FAST = 32;

export default function Splitter({
  width,
  containerRef,
  minLeft,
  minRight,
}: {
  /** The left pane's width. Written directly; read by nothing here. */
  width: MotionValue<number>;
  /** The flex row both panes sit in — what the clamp is measured against. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  minLeft: number;
  minRight: number;
}) {
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const dragging = useRef(false);

  // Read off the element rather than repeated as a literal: `--w-resize-handle`
  // already defines it once, in `files.css`, and a copy of that number here
  // would only ever be a second place for the two to disagree. The fallback
  // covers the instant before the handle has laid out.
  const handleWidth = () => handleRef.current?.getBoundingClientRect().width ?? 6;

  /**
   * The nearest width the split is allowed to take.
   *
   * `Math.max(ceiling, minLeft)` rather than just `ceiling`: in a window too
   * narrow for both minimums, the ceiling drops below the floor and a naive
   * clamp would return the smaller of the two, collapsing the tree to nothing.
   * The tree keeps its floor and the viewer gives up the difference — the same
   * order of precedence `Frame` applies to the panel.
   */
  const clamp = useCallback(
    (raw: number) => {
      const row = containerRef.current?.getBoundingClientRect().width ?? 0;
      const ceiling = row - minRight - handleWidth();
      return Math.min(Math.max(raw, minLeft), Math.max(ceiling, minLeft));
    },
    [containerRef, minLeft, minRight],
  );

  /**
   * Republish the width to assistive technology.
   *
   * Only at rest — mount, the end of a drag, each keyboard step. A focusable
   * `separator` is a window splitter and owes a `valuenow`, but writing the
   * attribute on every pointer move would be a DOM write per frame in service
   * of a number nothing can read mid-gesture.
   */
  const publish = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setAttribute("aria-valuenow", String(Math.round(width.get())));
    // The ceiling is a fraction of the window rather than a constant, so it is
    // re-derived here rather than written on the element as a literal.
    const row = containerRef.current?.getBoundingClientRect().width ?? 0;
    handle.setAttribute(
      "aria-valuemax",
      String(Math.round(Math.max(row - minRight - handleWidth(), minLeft))),
    );
  }, [containerRef, minLeft, minRight, width]);

  useEffect(publish, [publish]);

  /**
   * The window got narrower than the split it is holding.
   *
   * Without this the tree keeps its pixel width while the row shrinks, and the
   * viewer — `min-width: 0`, per `files.css` — is squeezed to nothing and then
   * off the edge. Guarded on `dragging` the same way `Frame`'s observers are:
   * a resize landing mid-gesture must not fight the pointer.
   */
  useEffect(() => {
    const row = containerRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => {
      if (dragging.current) return;
      const next = clamp(width.get());
      if (next !== width.get()) {
        width.set(next);
        publish();
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [containerRef, clamp, publish, width]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const row = containerRef.current;
    if (!row) return;

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to do; the window listeners below are the real mechanism.
    }
    dragging.current = true;

    // Read once. The row cannot change size during a drag that is only moving
    // a divider inside it, and re-measuring per frame would be a forced layout
    // in the one place that cannot afford one.
    const left = row.getBoundingClientRect().left;
    // A cursor that grabbed the handle off-centre should not teleport the
    // divider under it on the first move.
    const grab = event.clientX - (left + width.get());

    // While dragging, the whole document takes the cursor: one that only set
    // its own loses it the instant the pointer outruns six pixels of handle.
    document.documentElement.classList.add("files-dragging");

    const onMove = (moved: PointerEvent) => width.set(clamp(moved.clientX - left - grab));

    const onUp = () => {
      dragging.current = false;
      document.documentElement.classList.remove("files-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      publish();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? NUDGE_FAST : NUDGE;
    if (event.key === "ArrowLeft") width.set(clamp(width.get() - step));
    else if (event.key === "ArrowRight") width.set(clamp(width.get() + step));
    else return;
    event.preventDefault();
    publish();
  };

  return (
    <button
      ref={handleRef}
      type="button"
      className="files__splitter"
      // A `separator` that can be operated is a window splitter, and being a
      // button makes it focusable and keyboard-reachable for free — no
      // `tabindex`, no synthesised click, and Space/Enter do nothing harmful.
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the file tree"
      aria-valuemin={minLeft}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
