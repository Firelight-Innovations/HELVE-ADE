/**
 * The open files, drawn as tabs.
 *
 * A presentational component: it owns no state, and every decision it makes is
 * `useOpenFiles`'s. What it *does* own is the visual language, and that
 * language is not its own invention — the shell already draws tabs in
 * `src/shell/switcher/ToolSwitcherBar.tsx`, and a second tab look inside the
 * same window would read as a second product. Active tab is `--bg` against the
 * strip's `--surface`, with a 2px `--accent` rule along its top edge, exactly
 * as `.switcher__tab--active` and `.switcher__rule` do it.
 *
 * No framer-motion. The shell's rule slides between tool tabs because those
 * tabs are the top-level navigation of the whole window; a file tab strip is a
 * list that changes length as you work, and animating it would draw the eye to
 * the least interesting thing on screen. Same rule as the tree.
 *
 * What this deliberately does not do: shrink. Tabs keep their width and the
 * strip scrolls, because a row of tabs squeezed to eight pixels each is a row
 * of tabs you cannot read or hit.
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { OpenTab } from "./useOpenFiles";
import "./tabs.css";

export interface TabStripProps {
  tabs: OpenTab[];
  activePath: string | null;
  dirty: ReadonlySet<string>;
  onActivate(path: string): void;
  onClose(path: string): void;
}

export default function TabStrip({ tabs, activePath, dirty, onActivate, onClose }: TabStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  /**
   * Keep the active tab on screen.
   *
   * Needed because activation has three sources — a click here, a click in the
   * tree, and a close moving to a neighbour — and only the first of them is
   * guaranteed to be somewhere the user can already see.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || activePath === null) return;
    const index = tabs.findIndex((tab) => tab.path === activePath);
    const element = strip.children[index];
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activePath, tabs]);

  return (
    <div className="tabs">
      <div className="tabs__strip" role="tablist" aria-label="Open files" ref={stripRef}>
        {tabs.map((tab, index) => (
          <Tab
            key={tab.path}
            tab={tab}
            index={index}
            tabs={tabs}
            active={tab.path === activePath}
            dirty={dirty.has(tab.path)}
            onActivate={onActivate}
            onClose={onClose}
          />
        ))}
      </div>

      {tabs.map((tab) => {
        const notice = tab.notice;
        if (!notice) return null;
        return (
          <div key={tab.path} className={`tabs__notice tabs__notice--${notice.tone}`} role="alert">
            <span className="tabs__notice-text">{notice.message}</span>
            {notice.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="tabs__notice-action"
                onClick={action.run}
              >
                {action.label}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface TabProps {
  tab: OpenTab;
  index: number;
  tabs: OpenTab[];
  active: boolean;
  dirty: boolean;
  onActivate(path: string): void;
  onClose(path: string): void;
}

/**
 * A `div[role=tab]` rather than a `<button>`, because the close affordance is a
 * button and a button inside a button is not valid HTML — browsers reparent it
 * and the click lands somewhere nobody predicted.
 */
function Tab({ tab, index, tabs, active, dirty, onActivate, onClose }: TabProps) {
  const classes = ["tabs__tab"];
  if (active) classes.push("tabs__tab--active");
  if (dirty) classes.push("tabs__tab--dirty");
  if (tab.missing) classes.push("tabs__tab--missing");

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(tab.path);
      return;
    }

    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = index + (event.key === "ArrowLeft" ? -1 : 1);
    const next = tabs[target];
    if (!next) return;
    event.preventDefault();
    onActivate(next.path);
    // The strip's children are the tabs, in order, so the sibling at the new
    // index is the element to focus. Roving `tabIndex` alone decides where Tab
    // lands next; it does not move focus now.
    const sibling = event.currentTarget.parentElement?.children[target];
    if (sibling instanceof HTMLElement) sibling.focus();
  };

  return (
    <div
      className={classes.join(" ")}
      role="tab"
      aria-selected={active}
      // Roving tabindex: one stop for the whole strip, arrows to move within it.
      tabIndex={active ? 0 : -1}
      title={tab.missing ? `${tab.path} — no longer on disk` : tab.path}
      onClick={() => onActivate(tab.path)}
      onKeyDown={onKeyDown}
      // Middle-click closes. `onMouseDown` too, because button 1 starts
      // autoscroll on Windows and leaves the page under a scroll cursor.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onClose(tab.path);
      }}
    >
      <span className="tabs__name">{tab.name}</span>

      {/* One fixed slot holding both marks, so the tab does not change width
          when the dot gives way to the close button on hover. */}
      <span className="tabs__slot">
        <span className="tabs__dot" aria-hidden="true" />
        <button
          type="button"
          className="tabs__close"
          aria-label={`Close ${tab.name}`}
          onClick={(event) => {
            // Or the click also activates the tab that is about to disappear.
            event.stopPropagation();
            onClose(tab.path);
          }}
        >
          ×
        </button>
      </span>
    </div>
  );
}
