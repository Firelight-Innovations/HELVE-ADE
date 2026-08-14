import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Cluster, ToolHealth, ToolPresentation } from "../contract";
import { snap } from "../motion";
import { Close, Plus, Search, WarningTriangle } from "../../ui/Icon";
import HealthPopover, { type UnhealthyTool } from "./HealthPopover";
import "./switcher.css";

/**
 * The cluster bar — one tab per cluster, and the stack's health beside them.
 *
 * A cluster is one thing being worked on: a pane tree of surfaces, the terminals
 * in the panel beside them, and the worktree they all operate on. Switching tabs
 * here swaps the whole layout beneath the bar, which is what makes a cluster
 * worth having — the shells and editors you had open against one feature are
 * still arranged that way when you come back to it.
 *
 * This replaced a bar of one tab per docked tool. The class names did not
 * change with it, deliberately: `frame.css` sizes this row and the drag layer
 * finds it by `[data-region="switcher"]`, and renaming the vocabulary would have
 * meant touching both for no behavioural gain.
 *
 * Tool health stays here and stays unchanged. It is a property of the *stack* —
 * whether Turner needs an update, whether Wright is installed — and has nothing
 * to do with which cluster you happen to be looking at.
 */
export interface ClusterBarProps {
  clusters: Cluster[];
  activeClusterId: string | null;
  onSelect: (clusterId: string) => void;
  onAdd: () => void;
  onClose: (clusterId: string) => void;
  onRename: (clusterId: string, name: string) => void;
  /** What the warning badge reports on. Not per-cluster; see above. */
  healthOf?: ToolPresentation[];
  onRescan: () => void;
  searchSlot?: ReactNode;
  /** True while the search field is expanded. The bar yields its width to it. */
  searchExpanded?: boolean;
}

function isUnhealthy(tool: ToolPresentation): tool is UnhealthyTool {
  return tool.health !== ("ok" satisfies ToolHealth);
}

export default function ClusterBar({
  clusters,
  activeClusterId,
  onSelect,
  onAdd,
  onClose,
  onRename,
  healthOf,
  onRescan,
  searchSlot,
  searchExpanded = false,
}: ClusterBarProps) {
  const [healthOpen, setHealthOpen] = useState(false);
  const badgeWrapRef = useRef<HTMLDivElement>(null);
  const unhealthy = (healthOf ?? []).filter(isUnhealthy);

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

  // The badge disappears the moment the field expands, so a popover left open
  // behind it would be unreachable and orphaned.
  useEffect(() => {
    if (searchExpanded) setHealthOpen(false);
  }, [searchExpanded]);

  // Every tab but the active one steps aside for the search field, which is what
  // lets it take every pixel from the right edge back to that tab. The active
  // tab itself — and the `layoutId="tool-rule"` accent rule mounted inside it —
  // stays put throughout, so nothing here ever unmounts it. Unmounting it would
  // leave framer with no origin to animate the rule from.
  const visible = searchExpanded ? clusters.filter((c) => c.id === activeClusterId) : clusters;

  return (
    <div className="switcher">
      <div className="switcher__tabs">
        {visible.map((cluster) => (
          <ClusterTab
            key={cluster.id}
            cluster={cluster}
            active={cluster.id === activeClusterId}
            // A window must always have at least one cluster: closing the last
            // one would leave a window with no layout, no panel and no way to
            // make either. So the affordance is absent rather than present and
            // refusing.
            closable={clusters.length > 1}
            onSelect={onSelect}
            onClose={onClose}
            onRename={onRename}
          />
        ))}
        {!searchExpanded && (
          <button type="button" className="switcher__newbtn" onClick={onAdd} aria-label="New cluster">
            <Plus />
          </button>
        )}
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
          <span className="switcher__search-hint">Ctrl+K</span>
        </div>
      )}
    </div>
  );
}

/**
 * One cluster's tab: its name, renameable in place, and a close button.
 *
 * A `div role="tab"` rather than the `<button>` this used to be. That is not a
 * preference — a button may not legally contain another button, and this needs
 * to nest a close × the way the terminal panel's tab already does. Keyboard
 * access is put back by hand rather than lost with the element.
 *
 * Renaming is inline rather than through a dialog. A cluster is named after
 * whatever you are doing in it, which you can only judge while looking at it;
 * a modal that covered the thing being named would be the wrong order.
 */
function ClusterTab({
  cluster,
  active,
  closable,
  onSelect,
  onClose,
  onRename,
}: {
  cluster: Cluster;
  active: boolean;
  closable: boolean;
  onSelect: (clusterId: string) => void;
  onClose: (clusterId: string) => void;
  onRename: (clusterId: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.name);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name is a name you cannot click on. Refused by restoring what was
    // there rather than by rejecting the edit with a message, since there is
    // nothing the user needs to be told: the tab simply keeps its name.
    if (next && next !== cluster.name) onRename(cluster.id, next);
    else setDraft(cluster.name);
  };

  const classes = ["switcher__tab"];
  if (active) classes.push("switcher__tab--active");

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      className={classes.join(" ")}
      title={cluster.name}
      onClick={() => onSelect(cluster.id)}
      onDoubleClick={() => {
        setDraft(cluster.name);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(cluster.id);
        }
      }}
    >
      {editing ? (
        <input
          className="switcher__tab-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Stopped from reaching the tab's own handler, which would otherwise
            // treat Enter and Space as "select this tab" while you are typing.
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(cluster.name);
              setEditing(false);
            }
          }}
          // A click inside the field must not re-select the tab or, worse,
          // re-enter editing on the second click of a double.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="switcher__tab-label">{cluster.name}</span>
      )}

      {closable && !editing && (
        <button
          type="button"
          className="switcher__tab-close"
          aria-label={`Close ${cluster.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(cluster.id);
          }}
          // Without this, pressing the × would begin whatever gesture the tab
          // itself starts on pointerdown.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Close />
        </button>
      )}

      {active && <motion.div className="switcher__rule" layoutId="tool-rule" transition={snap} />}
    </div>
  );
}
