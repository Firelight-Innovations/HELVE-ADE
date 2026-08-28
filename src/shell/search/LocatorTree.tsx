/**
 * The locator tree: the lower-left pane of the search overlay.
 *
 * Not an explorer. There is no click, no keyboard cursor, no context menu —
 * `useLocatorTree` is the only thing that ever changes what this draws, and
 * it changes in exactly one direction, in response to exactly one input:
 * the hovered or selected hit above. The pane's whole job is answering
 * "where does this live," so the drawing leans on that single question
 * rather than on anything a real explorer would also need — there is no
 * filter field, no create/rename affordance, no right-click menu.
 *
 * Mirrors the look and the virtualization arithmetic of
 * `apps/files/ui/src/explorer/` (`TreeRow.tsx`, `useVirtualRows.ts`,
 * `explorer.css`) rather than importing from it — `src/` and `apps/files/`
 * may not reach into each other, so what's shared is the shape, authored
 * twice.
 */
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { fileIconUrl, folderIconUrl, rootFolderIconUrl } from "@openkaava/file-icons";
import { useLocatorTree } from "./useLocatorTree";
import type { LocatorFocus, LocatorNode } from "./types";
import "./locator.css";

export interface LocatorTreeProps {
  /** Absolute path the search is rooted at. `null` when no project is open —
   *  drawn as the empty state rather than an empty scrollport, so it reads
   *  as "there is nothing to locate" rather than as a stuck loading state. */
  root: string | null;
  /** The hit currently hovered or selected above. `null` when nothing is,
   *  in which case the pane shows the root's top level with nothing
   *  revealed and nothing marked. */
  focus: LocatorFocus | null;
  /** Scopes `files/list` to the cluster `root` belongs to. `null` when the
   *  overlay is searching the default project — same convention as
   *  `searchSource.ts`'s `SearchRequest.clusterId`. */
  clusterId: string | null;
}

/** Pixels of indent per level, and where depth 0 starts. Same two numbers as
 *  `apps/files/ui/src/explorer/TreeRow.tsx`'s `INDENT`/`GUTTER`, restated
 *  here for the same reason everything else in this file is restated: this
 *  pane is meant to look like that tree, not merely resemble it. */
const INDENT = 8;
const GUTTER = 6;

/** Every row's fixed height, and the only number the virtualization below
 *  does arithmetic against. Published to CSS as `--locator-row` so
 *  `locator.css` sizes rows from this rather than repeating the literal. */
const ROW_HEIGHT = 22;
/** Rows kept mounted beyond each edge, so a fast wheel doesn't show blank. */
const OVERSCAN = 8;

export default function LocatorTree({ root, focus, clusterId }: LocatorTreeProps) {
  const { nodes, errors } = useLocatorTree(root, focus, clusterId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowWindow = useRowWindow(scrollRef, nodes.length);

  // Follow the target into view. Not smooth — see `explorer.css`'s header on
  // why nothing in a list this shape ever animates: a hover that moves
  // quickly across several results should not leave the tree still
  // catching up to the last one.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const index = nodes.findIndex((n) => n.isTarget);
    if (index === -1) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [nodes]);

  const rootLabel = useMemo(() => (root ? baseName(root) : null), [root]);

  if (!root) {
    return (
      <div className="locator-tree">
        <div className="locator-tree__empty">No project open</div>
      </div>
    );
  }

  const visible = nodes.slice(rowWindow.start, rowWindow.end);

  return (
    <div
      className="locator-tree"
      style={{ "--locator-row": `${ROW_HEIGHT}px` } as React.CSSProperties}
    >
      {rootLabel && (
        <div className="locator-tree__head">
          {/* Root always reads as open: its children are exactly what's
              listed below the header, there's no collapsed state for it. */}
          <img
            className="locator-tree__head-icon"
            src={rootFolderIconUrl(true)}
            alt=""
            draggable={false}
          />
          <span className="locator-tree__head-label">{rootLabel}</span>
        </div>
      )}
      <div className="locator-tree__scroll" ref={scrollRef}>
        <div style={{ height: rowWindow.padTop }} />
        {visible.map((node) => (
          <LocatorRow key={node.path} node={node} error={errors.get(node.path) ?? null} />
        ))}
        <div style={{ height: rowWindow.padBottom }} />
      </div>
    </div>
  );
}

function LocatorRow({ node, error }: { node: LocatorNode; error: string | null }) {
  const isDir = node.kind === "dir";

  return (
    <div
      className="locator-tree__row"
      data-target={node.isTarget || undefined}
      style={{ paddingLeft: GUTTER + node.depth * INDENT }}
      title={error ?? node.path}
    >
      {isDir ? (
        <span
          className="locator-tree__chevron"
          data-open={node.expanded || undefined}
          aria-hidden="true"
        >
          <Chevron />
        </span>
      ) : (
        // A file has no chevron but still owes the column its width, or every
        // name in a folder of files sits one glyph left of its sibling
        // directories — same reasoning as `TreeRow.tsx`.
        <span className="locator-tree__chevron locator-tree__chevron--none" aria-hidden="true" />
      )}

      <img
        className="locator-tree__icon"
        src={isDir ? folderIconUrl(node.name, node.expanded) : fileIconUrl(node.name)}
        alt=""
        draggable={false}
      />

      <span className="locator-tree__name">{node.name}</span>

      {error && <span className="locator-tree__tag">unreadable</span>}
    </div>
  );
}

/** Same drawing as `TreeRow.tsx`'s `Chevron`, restated for the reason this
 *  file's header gives: `apps/files/` is not something this pane may import
 *  from, so the shape is authored again rather than shared. */
function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** A path's last component. Restated from `apps/files/ui/src/rpc.ts`'s
 *  `baseName` for the same cross-boundary reason as everything else here. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut === -1 ? path : path.slice(cut + 1);
}

interface RowWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/** Which slice of `nodes` is worth putting in the DOM. Same arithmetic as
 *  `apps/files/ui/src/explorer/useVirtualRows.ts` — every row is exactly
 *  `ROW_HEIGHT` tall, so the visible range is computed rather than measured,
 *  and a tree revealed deep into a large project costs no more in the DOM
 *  than one revealed one level down. */
function useRowWindow(scrollRef: RefObject<HTMLDivElement | null>, rowCount: number): RowWindow {
  const [port, setPort] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const read = () =>
      setPort((prev) =>
        prev.top === el.scrollTop && prev.height === el.clientHeight
          ? prev
          : { top: el.scrollTop, height: el.clientHeight },
      );

    read();
    el.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [scrollRef]);

  const start = Math.max(0, Math.min(Math.floor(port.top / ROW_HEIGHT) - OVERSCAN, rowCount));
  const end = Math.min(rowCount, start + Math.ceil(port.height / ROW_HEIGHT) + OVERSCAN * 2 + 1);

  return {
    start,
    end,
    padTop: start * ROW_HEIGHT,
    padBottom: (rowCount - end) * ROW_HEIGHT,
  };
}
