/**
 * The recursive pane layout — splits and dividers, and nothing else.
 *
 * **No tabs.** Every pane used to draw its own strip, so a window with two
 * splits listed the same surfaces across three rows at once — the cluster bar
 * and one strip per pane. They are all in the cluster bar now (see
 * `switcher/ClusterBar.tsx`); a pane here is a rectangle with a focus outline.
 * A tab listed in two rows is two things that can disagree about which is
 * active, and the second row never told anyone anything the first could not.
 *
 * That bar now draws a pane holding several surfaces as one grouped region,
 * worth naming here because it is the thing a reader of the paragraph above
 * will suspect has quietly come back. It has not: there is still exactly one
 * row and every surface still appears in it exactly once. What the bar gained
 * is grouping that mirrors this tree — not a second listing of it, and nothing
 * this component renders. `ClusterBar.tsx` has the argument in full.
 *
 * **No surfaces either**, and that separation is a correctness requirement
 * rather than a tidiness one; see `Pane`'s `pane__host` below.
 */
import { useCallback, useRef } from "react";
import { useDropZone } from "../dropZones";
import type { PaneNode, PaneTreeProps, SplitDir } from "../contract";
import "./panes.css";

// `PaneTreeProps` is in `contract.ts`, not here: `toolwindow` computes every
// field of it and hands it back through a `renderPanes` prop, which it could not
// type without importing this region (STANDARDS.md §1.2).

/**
 * The smallest share a pane may be dragged to, matching `MIN_SIZE` in
 * `src-tauri/src/layout.rs`.
 *
 * Both sides enforce it, which is not redundant: this one keeps the gesture
 * from ever *looking* like it collapsed a pane, and Rust's keeps a hand-edited
 * or stale `layout.json` from producing a pane with no divider left to grab.
 */
const MIN_SIZE = 0.05;

export default function PaneTree(props: PaneTreeProps) {
  return <Node node={props.tree} {...props} />;
}

function Node({ node, ...props }: PaneTreeProps & { node: PaneNode }) {
  return node.kind === "leaf" ? <Pane leaf={node} {...props} /> : <Split split={node} {...props} />;
}

// --- splits -----------------------------------------------------------------

function Split({
  split,
  ...props
}: PaneTreeProps & { split: Extract<PaneNode, { kind: "split" }> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // One entry per child, so a divider can write flex-basis straight onto the
  // two elements it sits between. See `onDividerDown` for why that is done to
  // the DOM rather than through state.
  const childRefs = useRef<(HTMLDivElement | null)[]>([]);

  const row = split.dir === "row";

  /**
   * Resize the two panes a divider sits between, and only those two.
   *
   * Written directly to the DOM for the whole gesture, exactly as
   * `Frame.tsx`'s panel handle does and for the same reason: dragging has to be
   * 1:1 with the cursor, and routing every frame of it through a re-render
   * cannot promise that under load — least of all here, where a re-render means
   * re-measuring every pane and repositioning every iframe in the window.
   * React hears the result once, on pointer-up.
   *
   * Only the adjacent pair moves. Redistributing across every child would mean
   * a drag between panes 1 and 2 quietly resizing panes 3 and 4, which is not
   * what the hand doing it is asking for.
   */
  const onDividerDown = useCallback(
    (index: number, e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      e.preventDefault();
      // Capture keeps the gesture alive when the cursor outruns the divider,
      // which it always does. It is an optimisation rather than the mechanism —
      // the window listeners below are what track the drag — and it throws for
      // a pointer id the browser no longer considers active, so it is guarded:
      // bare, a throw would abort the handler and lose the drag entirely.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Nothing to do; see above.
      }

      const rect = container.getBoundingClientRect();
      const total = row ? rect.width : rect.height;
      if (total <= 0) return;

      const start = row ? e.clientX : e.clientY;
      const before = split.sizes[index - 1] ?? 0.5;
      const after = split.sizes[index] ?? 0.5;
      // The pair's combined share is fixed for the gesture; the drag only
      // decides where the boundary inside it falls.
      const pair = before + after;

      let nextBefore = before;

      const onMove = (ev: PointerEvent) => {
        const moved = (row ? ev.clientX : ev.clientY) - start;
        const delta = moved / total;
        nextBefore = Math.min(Math.max(before + delta, MIN_SIZE), pair - MIN_SIZE);

        const first = childRefs.current[index - 1];
        const second = childRefs.current[index];
        if (first) first.style.flexBasis = `${nextBefore * 100}%`;
        if (second) second.style.flexBasis = `${(pair - nextBefore) * 100}%`;
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);

        const sizes = [...split.sizes];
        sizes[index - 1] = nextBefore;
        sizes[index] = pair - nextBefore;
        props.onResize(split.id, sizes);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [row, split.id, split.sizes, props],
  );

  return (
    <div className="pane-split" data-dir={split.dir} ref={containerRef}>
      {split.children.map((child, i) => (
        <div
          key={child.id}
          className="pane-split__child"
          ref={(el) => {
            childRefs.current[i] = el;
          }}
          // The authored share: a fraction of the parent, one per child,
          // summing to 1 — the same numbers `layout::PaneNode` stores, because
          // the window is resizable and a layout in pixels would have to be
          // recomputed on every resize and would restore wrongly onto a
          // different monitor. A divider drag overwrites this inline for the
          // duration of the gesture; the next render from `shell:state` puts
          // the committed value back, which is the same number.
          style={{ flexBasis: `${(split.sizes[i] ?? 1 / split.children.length) * 100}%` }}
        >
          <Node node={child} {...props} />
          {i > 0 && (
            <div
              className="pane-split__divider"
              data-dir={split.dir}
              onPointerDown={(e) => onDividerDown(i, e)}
              role="separator"
              aria-orientation={row ? "vertical" : "horizontal"}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// --- panes ------------------------------------------------------------------

function Pane({
  leaf,
  focusedPaneId,
  onFocusPane,
  onHostChange,
  dropTarget,
}: PaneTreeProps & { leaf: Extract<PaneNode, { kind: "leaf" }> }) {
  const hostRef = useCallback(
    (el: HTMLDivElement | null) => onHostChange(leaf.id, el),
    [leaf.id, onHostChange],
  );

  // Registered rather than found. The drag layer used to locate its targets by
  // querying the DOM, which cannot work now that panes come and go as the user
  // splits things — see `dropZones.ts`.
  //
  // A pane registers one zone where it used to register two. The strip zone
  // went with the strip; the row that answers "insert between these two tabs"
  // is the cluster bar, and it registers that zone itself.
  const paneZone = useDropZone({ kind: "pane", paneId: leaf.id });

  const edge = dropTarget?.kind === "pane" && dropTarget.paneId === leaf.id ? dropTarget : null;

  return (
    <div
      className="pane"
      data-focused={focusedPaneId === leaf.id || undefined}
      onPointerDown={() => onFocusPane(leaf.id)}
      ref={paneZone}
    >
      {/* What `ToolWindow` measures. Deliberately empty, and now the pane's
          whole area rather than everything below a strip: every pane is an
          empty content box that reports its element up through `onHostChange`,
          and `ToolWindow` positions the actual iframes over those boxes from a
          flat list that never reorders.

          That separation is a correctness requirement, not a tidiness one, and
          `TerminalDeck` already learned it the hard way — read its doc comment.
          Moving a mounted element to a new position in the React tree is
          indistinguishable, to React, from unmounting it and mounting a new
          one. A surface here is an iframe, and an iframe that remounts *reloads
          the app inside it*. If this component owned its panes' contents, every
          split, every divider drag and every tab dragged between panes would
          throw away the Files app's open file and scroll position.
          `createPortal` does not save you either: changing a portal's container
          remounts its children too. So the layout is a tree and the surfaces
          are a flat list, and the only thing that crosses between them is a
          measured rectangle. */}
      <div className="pane__host" ref={hostRef} />

      {/* Drop indicators sit above the surface, which is a live iframe — an
          outline drawn under one would be invisible exactly when it matters. */}
      {edge?.edge === null && <span className="pane__drop" />}
      {edge?.edge && (
        <span
          className="pane__drop pane__drop--edge"
          data-dir={edge.edge}
          data-before={edge.before || undefined}
        />
      )}
    </div>
  );
}

export type { SplitDir };
