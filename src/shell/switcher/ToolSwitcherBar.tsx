import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import type { DragHandleProps, ToolPresentation } from "../contract";
import { Search, WarningTriangle } from "../../ui/Icon";
import { snap } from "../motion";
import HealthPopover, { type UnhealthyTool } from "./HealthPopover";
import "./switcher.css";

export interface ToolSwitcherBarProps {
  /** What the bar draws tabs for. */
  tools: ToolPresentation[];
  /**
   * What the warning badge and its health list report on, when that is not the
   * same set as the tabs. Defaults to `tools`.
   *
   * The two came apart when the tools stopped being docked: nothing that can
   * mount in this build is ever unhealthy — an app cannot be missing or out of
   * date — so a badge reading only the tabs would have gone quiet and taken
   * the stack's one health surface with it. What a window *shows* and what it
   * *reports on* are different questions, and this is the bar admitting that.
   */
  healthOf?: ToolPresentation[];
  activeToolId: string | null;
  onSelect: (id: string) => void;
  onRescan: () => void;
  /** Another parcel fills this with an expanding search field. */
  searchSlot?: ReactNode;
  /** True while the search field is expanded. The bar yields its width to it. */
  searchExpanded?: boolean;
  /**
   * Supplied by the drag layer. Spread onto each tool tab to make it a drag
   * source; a tab dragged clear of this bar detaches into its own window.
   */
  dragHandleFor?: (tool: ToolPresentation) => DragHandleProps | undefined;
}

function isUnhealthy(tool: ToolPresentation): tool is UnhealthyTool {
  return tool.health !== "ok";
}

/**
 * Left to right: tool tabs, a spacer, the warning badge, then the search
 * slot. The bar's own height is `.frame__switcher`'s — this component only
 * lays out its contents and never touches that box.
 */
export default function ToolSwitcherBar({
  tools,
  healthOf,
  activeToolId,
  onSelect,
  onRescan,
  searchSlot,
  searchExpanded = false,
  dragHandleFor,
}: ToolSwitcherBarProps) {
  const [healthOpen, setHealthOpen] = useState(false);
  const badgeWrapRef = useRef<HTMLDivElement>(null);
  const unhealthy = (healthOf ?? tools).filter(isUnhealthy);

  // Dismiss like every other popover in the shell: a click outside, or Escape.
  useEffect(() => {
    if (!healthOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!badgeWrapRef.current?.contains(e.target as Node)) setHealthOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHealthOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [healthOpen]);

  // The badge disappears the moment the field expands (the handoff's search
  // crop draws nothing between the active tab and the field) — so a popover
  // left open behind it would be unreachable and orphaned.
  useEffect(() => {
    if (searchExpanded) setHealthOpen(false);
  }, [searchExpanded]);

  // Every tab but the active one steps aside for the field, which is what
  // lets it "take every pixel from the right edge back to that tab." The
  // active tab itself — and the `layoutId="tool-rule"` accent rule mounted
  // inside it — stays put throughout, so nothing here ever unmounts it.
  const visibleTools = searchExpanded ? tools.filter((tool) => tool.id === activeToolId) : tools;

  return (
    <div className="switcher">
      <div className="switcher__tabs">
        {visibleTools.map((tool) => (
          <ToolTab
            key={tool.id}
            tool={tool}
            active={tool.id === activeToolId}
            onSelect={onSelect}
            // A not-installed tool has no checkout to detach into a window,
            // and is already inert (disabled, no hover) — it never becomes a
            // drag source.
            dragHandle={tool.interactive ? dragHandleFor?.(tool) : undefined}
          />
        ))}
      </div>

      <div className={`switcher__spacer${searchExpanded ? " switcher__spacer--collapsed" : ""}`} />

      {!searchExpanded && unhealthy.length > 0 && (
        <div className="switcher__badge-wrap" ref={badgeWrapRef}>
          <button
            type="button"
            className="switcher__badge"
            aria-expanded={healthOpen}
            onClick={() => setHealthOpen((open) => !open)}
          >
            <WarningTriangle size={12} className="switcher__badge-icon" />
            <span className="switcher__badge-count">{unhealthy.length}</span>
          </button>
          <AnimatePresence>
            {healthOpen && (
              <HealthPopover
                tools={unhealthy}
                onRescan={() => {
                  onRescan();
                  setHealthOpen(false);
                }}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {searchSlot ?? (
        <div className="switcher__search-default">
          <Search size={14} className="switcher__search-icon" />
          <span className="switcher__search-label">Search</span>
          <span className="switcher__search-hint">⌘K</span>
        </div>
      )}
    </div>
  );
}

function ToolTab({
  tool,
  active,
  onSelect,
  dragHandle,
}: {
  tool: ToolPresentation;
  active: boolean;
  onSelect: (id: string) => void;
  dragHandle?: DragHandleProps;
}) {
  const classes = ["switcher__tab"];
  if (active) classes.push("switcher__tab--active");
  if (!tool.interactive) classes.push("switcher__tab--dim");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={!tool.interactive}
      aria-pressed={active}
      onClick={() => onSelect(tool.id)}
      // Spread after onClick, which `dragHandle` never carries a key for, so
      // a press-and-release still selects the tab; a press-and-move is Parcel
      // J's to interpret through onPointerDown. This is also the tab's only
      // inline `style` — nothing above it to clobber, so the handle's
      // `style.cursor` lands untouched.
      {...dragHandle}
    >
      <span className="switcher__tab-label">{tool.name}</span>
      {active && <motion.div className="switcher__rule" layoutId="tool-rule" transition={snap} />}
    </button>
  );
}
