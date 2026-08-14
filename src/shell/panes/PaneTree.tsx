import { useCallback, useRef } from "react";
import { useDropZone } from "../drag/dropZones";
import { motion } from "framer-motion";
import type {
  DragHandleProps,
  DropTarget,
  PaneNode,
  SplitDir,
  SurfaceInstance,
} from "../contract";
import { snap } from "../motion";
import { Close } from "../../ui/Icon";
import "./panes.css";

/**
 * The recursive pane layout — splits, dividers, and one tab strip per pane.
 *
 * ## What this component does not contain
 *
 * The surfaces. Every pane draws its tab strip and an empty content box, and
 * reports that box's element up through `onHostChange`; `ToolWindow` positions
 * the actual iframes over those boxes from a flat list that never reorders.
 *
 * That separation is a correctness requirement, not a tidiness one, and
 * `TerminalDeck` already learned it the hard way — read its doc comment. Moving
 * a mounted element to a new position in the React tree is indistinguishable,
 * to React, from unmounting it and mounting a new one. A surface here is an
 * iframe, and an iframe that remounts *reloads the app inside it*. If this
 * component owned its panes' contents, every split, every divider drag and
 * every tab dragged between panes would throw away the Files app's open file
 * and scroll position. `createPortal` does not save you either: changing a
 * portal's container remounts its children too.
 *
 * So the layout is a tree and the surfaces are a flat list, and the only thing
 * that crosses between them is a measured rectangle.
 *
 * ## Sizes
 *
 * `sizes` are fractions of the parent, one per child, summing to 1 — the same
 * numbers `layout::PaneNode` stores, because the window is resizable and a
 * layout in pixels would have to be recomputed on every resize and would
 * restore wrongly onto a different monitor.
 */
export interface PaneTreeProps {
  tree: PaneNode;
  /** Resolves an instance id to what its tab should show. */
  instances: Map<string, SurfaceInstance>;
  /** The pane whose strip has focus, for the active-pane outline. */
  focusedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onSelectTab: (instanceId: string) => void;
  onCloseTab: (instanceId: string) => void;
  /** Commits a divider drag. One weight per child, summing to 1. */
  onResize: (splitId: string, sizes: number[]) => void;
  /** Called as panes mount, move and unmount. See the note above. */
  onHostChange: (paneId: string, el: HTMLDivElement | null) => void;
  dragHandleFor?: (instanceId: string) => DragHandleProps | undefined;
  /** Where a drag would land right now, so the target pane can say so. */
  dropTarget?: DropTarget | null;
}

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
  return node.kind === "leaf" ? (
    <Pane leaf={node} {...props} />
  ) : (
    <Split split={node} {...props} />
  );
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
          // The authored share. A divider drag overwrites this inline for the
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
  instances,
  focusedPaneId,
  onFocusPane,
  onSelectTab,
  onCloseTab,
  onHostChange,
  dragHandleFor,
  dropTarget,
}: PaneTreeProps & { leaf: Extract<PaneNode, { kind: "leaf" }> }) {
  const hostRef = useCallback(
    (el: HTMLDivElement | null) => onHostChange(leaf.id, el),
    [leaf.id, onHostChange],
  );

  // Registered rather than found. The drag layer used to locate its targets by
  // querying the DOM, which cannot work now that panes come and go as the user
  // splits things — see `drag/dropZones.tsx`.
  const paneZone = useDropZone({ kind: "pane", paneId: leaf.id });
  const stripRef = useRef<HTMLDivElement>(null);
  const stripZone = useDropZone({
    kind: "strip",
    paneId: leaf.id,
    // Measured on demand, not once: a strip scrolls, and a cached rect would put
    // the insertion caret in the wrong gap the moment it had.
    tabRects: () =>
      Array.from(stripRef.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? []).map((el) =>
        el.getBoundingClientRect(),
      ),
  });

  const drop = dropTarget && targetsPane(dropTarget, leaf.id) ? dropTarget : null;
  const edge = drop?.kind === "pane" ? drop : null;
  const caret = drop?.kind === "strip" ? drop.index : null;

  return (
    <div
      className="pane"
      data-focused={focusedPaneId === leaf.id || undefined}
      onPointerDown={() => onFocusPane(leaf.id)}
      ref={paneZone}
    >
      <div
        className="pane__strip"
        role="tablist"
        ref={(el) => {
          stripRef.current = el;
          stripZone(el);
        }}
      >
        {leaf.tabs.map((instanceId, i) => (
          <Tab
            key={instanceId}
            instance={instances.get(instanceId)}
            instanceId={instanceId}
            active={leaf.activeTab === instanceId}
            caretBefore={caret === i}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            dragHandle={dragHandleFor?.(instanceId)}
          />
        ))}
        {/* The insertion caret past the last tab. Rendered as its own element
            rather than as a trailing style on the last tab, so dropping at the
            end reads the same as dropping anywhere else. */}
        {caret === leaf.tabs.length && <span className="pane__caret" />}
      </div>

      {/* What `ToolWindow` measures. Deliberately empty. */}
      <div className="pane__host" ref={hostRef} />

      {/* Drop indicators sit above the surface, which is a live iframe — an
          outline drawn under one would be invisible exactly when it matters. */}
      {drop?.kind === "pane" && edge?.edge === null && <span className="pane__drop" />}
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

function Tab({
  instance,
  instanceId,
  active,
  caretBefore,
  onSelect,
  onClose,
  dragHandle,
}: {
  instance: SurfaceInstance | undefined;
  instanceId: string;
  active: boolean;
  caretBefore: boolean;
  onSelect: (instanceId: string) => void;
  onClose: (instanceId: string) => void;
  dragHandle?: DragHandleProps;
}) {
  // An id in a tree with no instance behind it should not happen, and drawing
  // its id is how you find out that it did. Silently skipping it would leave a
  // gap that looks like a rendering bug rather than a state one.
  const title = instance?.title ?? instanceId;

  return (
    <>
      {caretBefore && <span className="pane__caret" />}
      {/* A `div role="tab"` rather than a `<button>`, for the reason the
          terminal panel's tab already documents: a button cannot legally nest
          the close button this needs. Keyboard access is put back by hand. */}
      <div
        role="tab"
        aria-selected={active}
        tabIndex={0}
        className={active ? "pane__tab pane__tab--active" : "pane__tab"}
        data-tab={instanceId}
        title={title}
        onClick={() => onSelect(instanceId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(instanceId);
          }
        }}
        onPointerDown={dragHandle?.onPointerDown}
        style={dragHandle?.style}
      >
        <span className="pane__tab-label">{title}</span>
        {instance?.kind === "terminal" && instance.title && (
          <span className="pane__tab-kind" aria-hidden="true" />
        )}
        <button
          type="button"
          className="pane__tab-close"
          aria-label={`Close ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(instanceId);
          }}
          // Without this, pressing the × starts a drag of the tab it sits in.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Close />
        </button>
        {active && <motion.div className="pane__rule" layoutId="pane-rule" transition={snap} />}
      </div>
    </>
  );
}

/** Whether a drop target names this pane, in either of the two forms that can. */
function targetsPane(target: DropTarget, paneId: string): boolean {
  return (
    (target.kind === "pane" && target.paneId === paneId) ||
    (target.kind === "strip" && target.paneId === paneId)
  );
}

export type { SplitDir };
