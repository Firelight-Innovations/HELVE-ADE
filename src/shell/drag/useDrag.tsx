/**
 * The drag layer.
 *
 * One gesture, one payload, and every drop target registered rather than
 * guessed. A tab — an app surface or a terminal, they no longer differ — can be
 * dropped into a tab strip, onto a pane's edge to split it there, into the
 * terminal panel, or clear of everything to become its own window.
 *
 * A cluster chip drags too, through the same handle and the same threshold, and
 * lands in only one of those places: clear of everything, which either moves it
 * into the window it was released over or gives it one of its own. See
 * `commitCluster`.
 *
 * This hook owns the whole gesture: press-and-hold, movement threshold, and
 * `pointermove`/`pointerup`/`pointercancel` tracked on `window` the same way
 * `Frame.tsx`'s resize handle does. It hands back a small, stable surface that
 * `WindowRoot` wires into the panes and the panel: one handle factory, one
 * `overlay` node for `FrameSlots.overlay`, and the live drop target so a pane
 * can draw its own indicator.
 *
 * What it no longer does is read other regions' markup. The old version found
 * its targets with `document.querySelector('[data-region="panel"]')` and worked
 * out a reorder index from `bar.querySelectorAll(".switcher__tab")` — a query
 * into another region's CSS class names. That could not survive an arbitrary
 * number of panes and strips appearing and disappearing as the user splits
 * things, so targets now register themselves; see `dropZones.tsx`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, useMotionValue, useSpring } from "framer-motion";
import type {
  ClusterDrag,
  DragHandleProps,
  DragPayload,
  DragState,
  DropTarget,
} from "../contract";
import { snap } from "../motion";
import {
  detachCluster,
  detachInstance,
  moveInstance,
  moveTerminal,
  splitPane,
  windowAtCursor,
} from "../state/shellState";
import DragGhost from "./DragGhost";
import { DetachOutline } from "./DropTargets";
import { hitTest } from "./dropZones";
import "./drag.css";

/**
 * How far the pointer has to travel from the press point before a press becomes
 * a drag. Below this it stays a click — every tab spreads this handle's
 * `onPointerDown` alongside its own `onClick` and relies on a press that never
 * moves still selecting the tab.
 */
const PRESS_THRESHOLD = 4;

/**
 * The ghost's spring, derived from `snap` rather than invented. `snap` is the
 * scale's answer for "the default, for anything the pointer just caused" — its
 * stiffness is the highest in the scale, which is what "light lag only, it
 * should read as attached to the cursor" calls for. `motion.ts` types `snap` as
 * the general `Transition` shape (it has to, `settle` and `instant` share the
 * export), so its spring fields are read with a narrow cast here rather than by
 * widening the shared type for one caller.
 */
const springSource = snap as unknown as { stiffness: number; damping: number; mass?: number };
const ghostSpring = {
  stiffness: springSource.stiffness,
  damping: springSource.damping,
  mass: springSource.mass,
};

interface Session {
  payload: DragPayload;
  pointerId: number;
  startX: number;
  startY: number;
  began: boolean;
}

/**
 * `label` and `activeClusterId` are the *destination* half of every commit: a
 * pane belongs to a cluster, and a tab released over another window has to be
 * moved to that window rather than this one. Passed in rather than read from
 * `shell:state` here, because `WindowRoot` has already resolved which cluster
 * this window is showing and a second derivation would be a second chance to
 * disagree with it.
 */
export function useDrag(label: string, activeClusterId: string | null) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const sessionRef = useRef<Session | null>(null);

  // Written raw on every move and chased by a spring, rather than routed through
  // React state. The ghost has to read as attached to the cursor, and a
  // re-render per frame cannot promise that under load — least of all during a
  // drag, when a re-render also re-measures every pane in the window.
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const ghostX = useSpring(rawX, ghostSpring);
  const ghostY = useSpring(rawY, ghostSpring);

  const tabHandle = useCallback(
    (payload: DragPayload): DragHandleProps => ({
      style: { cursor: "grab" },
      onPointerDown: (e: ReactPointerEvent) => {
        // Only the primary button drags. A right-click that started a gesture
        // would leave a ghost stuck to the cursor with no release to end it.
        if (e.button !== 0) return;

        sessionRef.current = {
          payload,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          began: false,
        };

        // Capture keeps the gesture alive when the cursor outruns the tab, which
        // it always does. It is an optimisation rather than the mechanism — the
        // window listeners below are what track the drag — and it throws for a
        // pointer id the browser no longer considers active. Bare, it sat above
        // those listeners, so a throw would abort the handler and lose the drag
        // entirely. Guarded, the worst case is a slightly less forgiving gesture.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Nothing to do; see above.
        }

        const onMove = (ev: PointerEvent) => {
          const s = sessionRef.current;
          if (!s || ev.pointerId !== s.pointerId) return;

          if (!s.began) {
            const travelled = Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY);
            if (travelled < PRESS_THRESHOLD) return;
            s.began = true;
            // Seeded so the ghost springs from under the cursor rather than
            // flying in from the origin.
            rawX.jump(ev.clientX);
            rawY.jump(ev.clientY);
          }

          rawX.set(ev.clientX);
          rawY.set(ev.clientY);
          const target = resolve(s.payload, ev.clientX, ev.clientY);
          setDrag({ payload: s.payload, x: ev.clientX, y: ev.clientY, target });
        };

        const onUp = (ev: PointerEvent) => {
          const s = sessionRef.current;
          sessionRef.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);

          // Cleared before the commit rather than after. The pointer is already
          // up, some commits resolve asynchronously, and nothing about ending
          // the gesture should wait on or race one.
          setDrag(null);
          if (!s || ev.pointerId !== s.pointerId || !s.began) return;

          commit(s.payload, resolve(s.payload, ev.clientX, ev.clientY), label, activeClusterId);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      },
    }),
    [label, activeClusterId, rawX, rawY],
  );

  const overlay = useMemo(
    () =>
      drag ? (
        <div className="drag-overlay">
          <DragGhost payload={drag.payload} x={ghostX} y={ghostY} />
          <AnimatePresence>
            {drag.target.kind === "detach" && <DetachOutline key="detach" x={ghostX} y={ghostY} />}
          </AnimatePresence>
        </div>
      ) : null,
    [drag, ghostX, ghostY],
  );

  return {
    tabHandle,
    overlay,
    dragging: drag !== null,
    /** So a pane can draw its own indicator. Null when nothing is in the air. */
    target: drag?.target ?? null,
  };
}

/**
 * Where *this* payload would land, which is not always what is under the cursor.
 *
 * The zones answer for a tab, because a tab is what they were registered for. A
 * cluster can only be released on a window: it holds panes, so there is no sense
 * in which it goes inside one, and the terminal panel is a region of a window
 * rather than a place a cluster could live. Substituting `none` over those is
 * what stops the row drawing an insertion caret, a pane lighting an edge, and
 * the panel lighting up for a release `commitCluster` would refuse — an
 * indicator that promises something the drop will not do is worse than no
 * indicator, because it is read as a commitment.
 *
 * Done here rather than in the regions so that no region has to learn what is
 * being dragged. They are handed a target and draw it; that is the whole of
 * their involvement in the gesture.
 */
function resolve(payload: DragPayload, x: number, y: number): DropTarget {
  const target = hitTest(x, y);
  if (payload.what !== "cluster") return target;
  return target.kind === "detach" ? target : { kind: "none" };
}

/**
 * Act on a release.
 *
 * Split out of the handler so the mapping from target to call is one readable
 * table rather than a branch buried in a closure — this is the part someone
 * changing the gesture will come looking for.
 */
function commit(
  payload: DragPayload,
  target: DropTarget,
  label: string,
  activeClusterId: string | null,
): void {
  if (payload.what === "cluster") return commitCluster(payload, target, label);

  switch (target.kind) {
    case "strip":
      if (activeClusterId) {
        void moveInstance(payload.instanceId, activeClusterId, target.paneId, target.index);
      }
      return;

    case "pane":
      if (target.edge) {
        void splitPane(target.paneId, target.edge, payload.instanceId, target.before);
      } else if (activeClusterId) {
        void moveInstance(payload.instanceId, activeClusterId, target.paneId, null);
      }
      return;

    case "panel":
      // Only a terminal can live in the panel. An app surface dropped there is a
      // no-op rather than an error: the panel holds terminals and the git view,
      // and there is nothing sensible for it to do with a Files. Refusing
      // silently leaves the tab where it was, which is what a cancelled drag
      // should look like.
      if (payload.kind === "terminal") void moveTerminal(payload.instanceId, label);
      return;

    case "detach":
      // Released over no registered target. Which window that is over decides
      // nothing here, and deliberately: `window_at_cursor` answers with a label
      // and nothing else — it hit-tests window rectangles, so it cannot say
      // *where inside* another window the cursor was. Guessing a pane would drop
      // the tab somewhere the user did not aim, so a release over another window
      // detaches into a new one just as a release over the desktop does. Moving
      // into a specific pane of another window needs a richer hit-test that
      // returns window-local coordinates; that is the follow-up.
      //
      // The call is still made, because it is the only way to distinguish "over
      // no HELVE window" from "over one, outside its targets" in the log when
      // this behaviour is revisited.
      void windowAtCursor().then(() => detachInstance(payload.instanceId));
      return;

    case "none":
      // Unreachable for a tab: `resolve` substitutes this for a cluster and for
      // nothing else. Spelled out rather than left to fall off the end of the
      // switch, so this table stays a complete list of what a release can mean.
      return;
  }
}

/**
 * The same release, for a cluster.
 *
 * Only two targets can reach here, because `resolve` has already turned every
 * strip, pane and panel a cluster was released over into `none` — see it for
 * why. `none` does nothing at all: the cluster stays exactly where it was, which
 * is what a cancelled drag looks like, and is better than inventing a meaning
 * for a gesture the user cannot have intended.
 *
 * So `detach` is the one that acts, and unlike a tab's `detach` it uses the
 * answer it is given:
 *
 * - **Over another HELVE window** — the cluster moves into it. This is built
 *   here where the same drop for a single tab was deliberately not, and the
 *   difference is real rather than an inconsistency somebody forgot to fix. A
 *   tab needs a *pane* to land in, and `window_at_cursor` returns a label —
 *   it hit-tests window rectangles and cannot say where inside one the cursor
 *   was, so a pane would have to be guessed. A cluster is appended to that
 *   window's cluster list; the label is the whole of the address. The same
 *   reasoning is written at `commands::detach_cluster`, on the other side.
 * - **Over this window, or over nothing** — a window of its own. Releasing over
 *   the window it came from is not treated as "put it back where it was": the
 *   whole row is a drop zone, so a release that reaches `detach` at all is one
 *   that missed the bar on purpose.
 */
function commitCluster(payload: ClusterDrag, target: DropTarget, label: string): void {
  if (target.kind !== "detach") return;

  void windowAtCursor().then((over) =>
    detachCluster(payload.clusterId, over && over !== label ? over : null),
  );
}
