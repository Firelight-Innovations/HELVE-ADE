/**
 * The Schematic, drawn. Deliberately thin: every decision this component makes
 * is a pointer gesture turned into one engine call, and everything else —
 * what is visible, where an edge runs, what a caption reads — arrives already
 * decided in the `Frame` (`./frame.ts`).
 *
 * That split is not tidiness. This repository's Vitest runs on `node` with no
 * jsdom (`vitest.config.ts` says why), so nothing in this file can be tested
 * and everything in the engine can be. Logic that drifts up into this
 * component leaves the test suite silently.
 *
 * Node anatomy (PRD §12.6-§12.8, Wave 4) is entirely decided in
 * `./anatomy.ts` and `./frame.ts` — every badge, count, caption, lifecycle
 * treatment, health wedge and zoom tier arrives on `DrawnNode` already
 * computed. `NodeBox` below only maps that data onto markup and a `--kv-*`
 * token reference; it makes no decision `anatomy.test.ts` cannot already
 * see.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { ExportRow } from "../graph";
import type { Refusal } from "./config";
import type { SchematicEngine } from "./engine";
import type { DrawnEdge, DrawnNode } from "./frame";
import { buildFrame } from "./frame";
import { rectFromCorners } from "./geometry";
import type { Point, Rect } from "./geometry";
import { validateEdge } from "./rules";
import { toScreen, toWorld } from "./viewport";
import "./engine.css";

/** What the pointer is currently doing. One at a time, by construction. */
type Gesture =
  | { mode: "pan"; from: Point }
  | { mode: "box"; origin: Point; to: Point; additive: boolean }
  | { mode: "move"; from: Point; to: Point; nodeId: string }
  | { mode: "edge"; fromId: string; to: Point; targetId: string | null };

/** A refusal drawn at the cursor (PRD §12.5). */
interface CursorRefusal extends Refusal {
  at: Point;
}

export interface SchematicCanvasProps {
  engine: SchematicEngine;
  /** PRD §17 Wave 5's click-to-drill: called on a true click (pointer down
   *  and up with no movement between) on a node's face, never on a drag or a
   *  port drag. `engine/navigation.ts`'s `nextDrillTarget` is the pure
   *  function that decides what a click on this node means, if anything —
   *  this component only tells the caller a click happened and on which
   *  node; it makes no drill decision itself. */
  onActivate?: (node: DrawnNode) => void;
  /** PRD §12.10's export strip, service tier only — omitted at every other
   *  tier. Data, not canvas geometry, so it comes from the caller's own
   *  projected graph rather than from `Frame`. */
  exports?: readonly ExportRow[];
}

export function SchematicCanvas({ engine, onActivate, exports: exportRows }: SchematicCanvasProps) {
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => engine.subscribe(listener), [engine]),
    () => engine.state,
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1320, height: 700 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [refusal, setRefusal] = useState<CursorRefusal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      engine.setSize(next);
      setSize(next);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [engine]);

  const frame = useMemo(
    () =>
      buildFrame({
        doc: state.doc,
        config: engine.config,
        viewport: state.viewport,
        size,
        selection: new Set(state.selection),
        index: engine.index,
      }),
    [state, size, engine],
  );

  const pointAt = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const box = hostRef.current?.getBoundingClientRect();
      return toWorld(state.viewport, {
        x: event.clientX - (box?.left ?? 0),
        y: event.clientY - (box?.top ?? 0),
      });
    },
    [state.viewport],
  );

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const box = hostRef.current?.getBoundingClientRect();
    engine.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
      x: event.clientX - (box?.left ?? 0),
      y: event.clientY - (box?.top ?? 0),
    });
  };

  const onBackgroundDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setRefusal(null);
    const world = pointAt(event);
    if (event.button === 1 || event.altKey) {
      setGesture({ mode: "pan", from: { x: event.clientX, y: event.clientY } });
      return;
    }
    if (!event.shiftKey) engine.clearSelection();
    setGesture({ mode: "box", origin: world, to: world, additive: event.shiftKey });
  };

  const onNodeDown = (event: ReactPointerEvent<HTMLDivElement>, node: DrawnNode) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRefusal(null);
    if (!node.selected) engine.select([node.node.id], event.shiftKey);
    const world = pointAt(event);
    setGesture({ mode: "move", from: world, to: world, nodeId: node.node.id });
  };

  const onPortDown = (event: ReactPointerEvent<HTMLElement>, nodeId: string) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRefusal(null);
    setGesture({ mode: "edge", fromId: nodeId, to: pointAt(event), targetId: null });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    if (gesture.mode === "pan") {
      engine.pan(event.clientX - gesture.from.x, event.clientY - gesture.from.y);
      setGesture({ mode: "pan", from: { x: event.clientX, y: event.clientY } });
      return;
    }
    const world = pointAt(event);
    if (gesture.mode === "box") {
      setGesture({ ...gesture, to: world });
      return;
    }
    if (gesture.mode === "move") {
      setGesture({ ...gesture, to: world });
      return;
    }
    // An edge drag answers before the drop, which is what PRD §12.5 means by
    // refusing at drag time rather than accepting and flagging later.
    const target = engine.hitTest(world)[0]?.id ?? null;
    setGesture({ ...gesture, to: world, targetId: target });
    if (!target || target === gesture.fromId) {
      setRefusal(null);
      return;
    }
    const verdict = validateEdge(state.doc, engine.index, engine.config, {
      kind: engine.config.edgeKinds[0].kind,
      from: gesture.fromId,
      to: target,
    });
    setRefusal(verdict ? { ...verdict, at: world } : null);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    const world = pointAt(event);
    if (gesture.mode === "box") {
      engine.boxSelect(rectFromCorners(gesture.origin, world), gesture.additive);
    } else if (gesture.mode === "move") {
      const dx = world.x - gesture.from.x;
      const dy = world.y - gesture.from.y;
      if (dx !== 0 || dy !== 0) {
        engine.moveSelection(dx, dy);
      } else if (onActivate) {
        // A click, not a drag: PRD §17 Wave 5's click-to-drill. The decision
        // of where this leads (if anywhere) is `onActivate`'s caller's
        // business, via `engine/navigation.ts`'s `nextDrillTarget` — this
        // component only reports that a click landed, and on which node.
        const drawn = frame.nodes.find((candidate) => candidate.node.id === gesture.nodeId);
        if (drawn) onActivate(drawn);
      }
    } else if (gesture.mode === "edge" && gesture.targetId) {
      const verdict = engine.createEdge({
        kind: engine.config.edgeKinds[0].kind,
        from: gesture.fromId,
        to: gesture.targetId,
      });
      setRefusal(verdict ? { ...verdict, at: world } : null);
    }
    setGesture(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key === "z") {
      event.preventDefault();
      if (event.shiftKey) engine.redo();
      else engine.undo();
    } else if (meta && event.key === "c") {
      engine.copy();
    } else if (meta && event.key === "v") {
      engine.paste();
    } else if (meta && event.key === "d") {
      event.preventDefault();
      engine.duplicateSelection();
    } else if (event.key === "Escape") {
      engine.clearSelection();
      setRefusal(null);
    }
  };

  const moveOffset =
    gesture?.mode === "move"
      ? { x: gesture.to.x - gesture.from.x, y: gesture.to.y - gesture.from.y }
      : { x: 0, y: 0 };

  return (
    <div
      ref={hostRef}
      className="kv-canvas"
      style={{ backgroundSize: `${engine.config.grid.size}px ${engine.config.grid.size}px` }}
      tabIndex={0}
      role="application"
      aria-label="Schematic"
      onWheel={onWheel}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <svg className="kv-canvas__edges" width={size.width} height={size.height}>
        <defs>
          <marker
            id="kv-arrow-filled"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
          </marker>
          <marker
            id="kv-arrow-hollow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="var(--kv-bg-app)" stroke="context-stroke" />
          </marker>
        </defs>
        {frame.edges.map((edge) => (
          <EdgeLine key={edge.id} edge={edge} engine={engine} />
        ))}
        {gesture?.mode === "edge" ? (
          <PendingEdge engine={engine} to={gesture.to} fromId={gesture.fromId} />
        ) : null}
      </svg>

      {frame.nodes.map((drawn) => (
        <NodeBox
          key={drawn.node.id}
          drawn={drawn}
          engine={engine}
          offset={drawn.selected ? moveOffset : { x: 0, y: 0 }}
          onDown={onNodeDown}
          onPortDown={onPortDown}
        />
      ))}

      {gesture?.mode === "box" ? (
        <SelectionBox engine={engine} rect={rectFromCorners(gesture.origin, gesture.to)} />
      ) : null}

      {refusal ? <RefusalToast engine={engine} refusal={refusal} /> : null}

      <div className="kv-canvas__readout">
        <span className="kv-canvas__zoom">{frame.zoom}</span>
        {frame.legend.map((chip) => (
          <span key={chip.kind} className="kv-canvas__chip">
            <i
              className={`kv-canvas__rule kv-canvas__rule--${chip.style.line}`}
              style={{ borderColor: `var(${chip.style.strokeToken})` }}
            />
            {chip.kind}
          </span>
        ))}
        <span className="kv-canvas__footer">{frame.legendFooter}</span>
      </div>

      {frame.minimap ? (
        <div className="kv-canvas__minimap" style={boxStyle(frame.minimap.box)}>
          {frame.minimap.nodes.map((rect, i) => (
            <i key={i} className="kv-canvas__minimap-node" style={boxStyle(rect)} />
          ))}
          <i className="kv-canvas__minimap-view" style={boxStyle(frame.minimap.viewport)} />
        </div>
      ) : null}

      {frame.moduleReadouts ? (
        <div className="kv-canvas__callouts">
          <CalloutBox tone="ok" callout={frame.moduleReadouts.coverage} />
          <CalloutBox tone="neutral" callout={frame.moduleReadouts.satisfies} />
        </div>
      ) : null}

      {frame.sharedNodeCallout ? (
        <div className="kv-canvas__callouts kv-canvas__callouts--shared">
          <CalloutBox tone="neutral" callout={frame.sharedNodeCallout} />
        </div>
      ) : null}

      {exportRows && exportRows.length > 0 ? (
        <ExportStrip engine={engine} rows={exportRows} selection={state.selection} />
      ) : null}
    </div>
  );
}

/** PRD §12.10's export strip: pinned along the Schematic edge opposite the
 *  Outline, 1 row per authored method. The selected row draws a `←` marker
 *  beside its owning module, and a click on a row selects that module —
 *  lighting it the same way any other selection does, since `NodeBox`
 *  already draws `kv-node--selected` off `engine.select`. */
function ExportStrip({
  engine,
  rows,
  selection,
}: {
  engine: SchematicEngine;
  rows: readonly ExportRow[];
  selection: readonly string[];
}) {
  const idForSlug = (slug: string) => engine.state.doc.nodes.find((node) => node.slug === slug)?.id;
  return (
    <div className="kv-export-strip">
      <div className="kv-export-strip__header">
        <span>EXPORTED INTERFACE</span>
        <span>{rows.length} · authored</span>
      </div>
      <ul className="kv-export-strip__rows">
        {rows.map((row) => {
          const moduleId = idForSlug(row.moduleSlug);
          const isSelected = moduleId !== undefined && selection.includes(moduleId);
          return (
            <li key={row.method}>
              <button
                type="button"
                className="kv-export-strip__row"
                onClick={() => {
                  if (moduleId) engine.select([moduleId]);
                }}
              >
                <span className="kv-export-strip__method">{row.method}</span>
                <span className="kv-export-strip__arrow">→</span>
                <span className="kv-export-strip__module">{row.moduleSlug}</span>
                {isSelected ? <span className="kv-export-strip__marker">←</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="kv-export-strip__footer">
        Everything not listed is internal by construction.
      </div>
    </div>
  );
}

/** PRD §12.11's `COVERAGE OF DESIGN`/`SATISFIES` boxes and PRD §4.3's `WHY …
 *  SITS HERE` box — 3 free-floating annotation boxes across 2 tiers, drawn
 *  identically apart from their heading colour (WIREFRAME-EXTRACT.md §4.6:
 *  the coverage heading draws in the `--kv-ok` family, the other 2 neutral). */
function CalloutBox({
  tone,
  callout,
}: {
  tone: "ok" | "neutral";
  callout: { heading: string; body: string };
}) {
  return (
    <div className="kv-callout">
      <div className={`kv-callout__heading kv-callout__heading--${tone}`}>{callout.heading}</div>
      <div className="kv-callout__body">{callout.body}</div>
    </div>
  );
}

function NodeBox({
  drawn,
  engine,
  offset,
  onDown,
  onPortDown,
}: {
  drawn: DrawnNode;
  engine: SchematicEngine;
  offset: Point;
  onDown: (event: ReactPointerEvent<HTMLDivElement>, node: DrawnNode) => void;
  onPortDown: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
}) {
  const { node } = drawn;
  const zoom = engine.state.viewport.zoom;
  const origin = toScreen(engine.state.viewport, {
    x: node.rect.x + offset.x,
    y: node.rect.y + offset.y,
  });
  const lifecycle = drawn.lifecycle;
  const classes = [
    "kv-node",
    `kv-node--${node.kind}`,
    drawn.selected ? "kv-node--selected" : "",
    drawn.container ? "kv-node--container" : "",
    `kv-node--border-${lifecycle.borderStyle}`,
    lifecycle.borderWidthPx === 1.5 ? "kv-node--border-heavy" : "",
    lifecycle.overlayStripe ? "kv-node--stale-stripe" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // The 3 caption-shaped rows PRD §12.6 draws besides the state reason —
  // `contains N`, `collapsed · N children`, and the roll-up — plus every
  // other count string. One list, so the render order matches the anatomy
  // diagram's own top-to-bottom reading order without 4 near-identical JSX
  // blocks.
  const captionLines = [
    ...drawn.counts,
    drawn.containsCaption,
    drawn.collapsedCaption,
    drawn.rollUpCaption,
  ].filter((line): line is string => Boolean(line));

  return (
    <div
      className={classes}
      data-zoom-tier={drawn.zoomTier}
      style={{
        left: origin.x,
        top: origin.y,
        width: node.rect.width * zoom,
        height: node.rect.height * zoom,
        borderColor: `var(${lifecycle.borderToken})`,
        borderWidth: lifecycle.borderWidthPx,
        opacity: lifecycle.opacityPct / 100,
      }}
      onPointerDown={(event) => onDown(event, drawn)}
    >
      <div className="kv-node__header">
        {drawn.childCount > 0 ? (
          <button
            type="button"
            className="kv-node__triangle"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => engine.toggleCollapse(node.id)}
          >
            {node.collapsed ? "▸" : "▾"}
          </button>
        ) : null}
        <i
          className={`kv-node__dot kv-node__dot--${lifecycle.dotFill}`}
          style={{
            borderColor: `var(${lifecycle.dotToken})`,
            background: lifecycle.dotFill === "filled" ? `var(${lifecycle.dotToken})` : undefined,
            opacity: lifecycle.dotOpacityPct / 100,
          }}
        />
        {lifecycle.headerGlyph ? (
          <span className="kv-node__glyph">{lifecycle.headerGlyph}</span>
        ) : null}
        <span
          className={
            lifecycle.titleStruck ? "kv-node__title kv-node__title--struck" : "kv-node__title"
          }
        >
          {node.title}
        </span>
        <span className="kv-node__menu" aria-hidden="true">
          ⋯
        </span>
      </div>
      <div className="kv-node__slug">{node.slug}</div>
      {node.kind === "comment" ? <div className="kv-node__body">{node.body}</div> : null}
      {node.description ? <div className="kv-node__description">{node.description}</div> : null}

      {drawn.badges.length > 0 ? (
        <div className="kv-node__badges">
          {drawn.badges.map((badge) => (
            <span key={badge} className="kv-node__badge">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {drawn.facetChips.length > 0 ? (
        <div className="kv-node__facets">
          {drawn.facetChips.map((chip) => (
            <span key={chip} className="kv-node__facet">
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      {node.libraries && node.libraries.length > 0 ? (
        <div className="kv-node__libraries">
          {node.libraries.map((lib) => (
            <span key={lib} className="kv-node__library">
              ▸ {lib}
            </span>
          ))}
        </div>
      ) : null}

      {captionLines.map((line, i) => (
        <div key={`${line}-${i}`} className="kv-node__caption">
          {line}
        </div>
      ))}

      {drawn.facetContent.length > 0 ? (
        <div className="kv-node__facet-content">
          {drawn.facetContent.map((line, i) => (
            <div key={`${line}-${i}`} className="kv-node__facet-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {node.kind === "doc-block" && node.lifecycle === "draft" ? (
        <div className="kv-node__draft-controls">
          {/* PRD §12.11: "The facet stays dashed until a human takes one of
              the 3 actions." No write side exists for any of the 3 this
              wave — Wave 6 owns the Inspector-adjacent review flow these
              feed into — so the controls are drawn, per this wave's own
              acceptance list, and left inert rather than half-wired. */}
          <button type="button" className="kv-node__draft-action" disabled>
            Accept
          </button>
          <button type="button" className="kv-node__draft-action" disabled>
            Edit
          </button>
          <button type="button" className="kv-node__draft-action" disabled>
            Discard
          </button>
        </div>
      ) : null}

      {drawn.caption ? (
        <div className="kv-node__caption kv-node__caption--reason">
          <div>{drawn.caption.primary}</div>
          {drawn.caption.secondary ? <div>{drawn.caption.secondary}</div> : null}
        </div>
      ) : null}

      {lifecycle.bottomFillPct > 0 ? (
        <i
          className="kv-node__bottom-fill"
          style={{
            width: `${lifecycle.bottomFillPct}%`,
            background: `var(${lifecycle.bottomFillToken})`,
          }}
        />
      ) : null}

      {drawn.health !== "passing" ? (
        <i className={`kv-node__wedge kv-node__wedge--${drawn.health}`} />
      ) : null}

      <i
        className="kv-node__port kv-node__port--in"
        onPointerDown={(event) => event.stopPropagation()}
      />
      <i
        className="kv-node__port kv-node__port--out"
        onPointerDown={(event) => onPortDown(event, node.id)}
      />
    </div>
  );
}

function EdgeLine({ edge, engine }: { edge: DrawnEdge; engine: SchematicEngine }) {
  const points = edge.route.points
    .map((point) => toScreen(engine.state.viewport, point))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const dash =
    edge.style.line === "dashed" ? "5 4" : edge.style.line === "dotted" ? "1.5 4" : undefined;
  const marker =
    edge.style.arrow === "filled"
      ? "url(#kv-arrow-filled)"
      : edge.style.arrow === "hollow"
        ? "url(#kv-arrow-hollow)"
        : undefined;
  const mid = edge.route.points[Math.floor(edge.route.points.length / 2)];
  const label = toScreen(engine.state.viewport, mid);

  return (
    <g>
      <polyline
        points={points}
        fill="none"
        stroke={`var(${edge.style.strokeToken})`}
        strokeWidth={edge.style.widthPx}
        strokeDasharray={dash}
        markerEnd={marker}
      />
      {edge.label ? (
        <text className="kv-edge__label" x={label.x} y={label.y - 4}>
          {edge.label}
        </text>
      ) : null}
      {edge.aggregated > 1 ? (
        <text className="kv-edge__label" x={label.x} y={label.y - 4}>
          {edge.aggregated}
        </text>
      ) : null}
    </g>
  );
}

function PendingEdge({
  engine,
  fromId,
  to,
}: {
  engine: SchematicEngine;
  fromId: string;
  to: Point;
}) {
  const source = engine.index.byId.get(fromId);
  if (!source) return null;
  const start = toScreen(engine.state.viewport, {
    x: source.rect.x + source.rect.width,
    y: source.rect.y + source.rect.height / 2,
  });
  const end = toScreen(engine.state.viewport, to);
  return (
    <polyline
      className="kv-edge--pending"
      points={`${start.x},${start.y} ${end.x},${start.y} ${end.x},${end.y}`}
      fill="none"
    />
  );
}

function SelectionBox({ engine, rect }: { engine: SchematicEngine; rect: Rect }) {
  const origin = toScreen(engine.state.viewport, rect);
  const zoom = engine.state.viewport.zoom;
  return (
    <div
      className="kv-canvas__marquee"
      style={{
        left: origin.x,
        top: origin.y,
        width: rect.width * zoom,
        height: rect.height * zoom,
      }}
    />
  );
}

function RefusalToast({ engine, refusal }: { engine: SchematicEngine; refusal: CursorRefusal }) {
  const at = toScreen(engine.state.viewport, refusal.at);
  return (
    <div className="kv-refusal" style={{ left: at.x + 12, top: at.y + 12 }}>
      <div className="kv-refusal__heading">✕ {refusal.heading}</div>
      <div className="kv-refusal__reason">{refusal.reason}</div>
    </div>
  );
}

function boxStyle(rect: Rect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}
