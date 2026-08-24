import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Sliders } from "../../ui/Icon";
import TypeFilterPopover from "./TypeFilterPopover";
import type { SearchSession } from "./useSearchSession";
import { accelerator, hasPrimaryModifier } from "../keys/accelerators";
import "./search.css";

export interface SearchSlotProps {
  /** Controlled expansion. Omit to keep the current self-owned behaviour. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * The shared query, kinds and cursor. Optional so the collapsed slot still
   * renders standalone — in a detached window, or anywhere the overlay is not
   * mounted, the field is decoration and has nothing to drive.
   *
   * The query and the selected kinds live out here, in `useSearchSession`,
   * rather than in this component: they have to be shared with the overlay,
   * and the field is the wrong owner for state that two regions read — the
   * field is simply the surface you type into.
   */
  session?: SearchSession;
  /**
   * Enter on the focused result. Optional for the same reason `session` is —
   * a field with nothing to drive has nothing to submit either.
   *
   * A callback rather than this component calling `openHitInFiles` itself,
   * because opening a hit needs the cluster the search ran against and this
   * field has never been told which one that is. `WindowRoot` knows, and is
   * also the only place that can close search afterwards.
   */
  onSubmit?: () => void;
}

/**
 * The search slot: `ToolSwitcherBar`'s `searchSlot` prop.
 *
 * Two states sharing one layout node (`layoutId="search-slot"`) so the
 * collapsed placeholder and the expanded field morph into each other rather
 * than swap — the search glyph and the accent underline travel with it.
 * Neither state ever touches the switcher bar's own height; everything here
 * lives inside the 36px `.frame__switcher` box the bar already owns.
 *
 * Open: Ctrl+K from anywhere, or a click on the collapsed slot. Close: Escape or
 * the close glyph. Both drawn from the handoff's caption; the handoff writes the
 * chord in Mac notation, which this does not — see `keys/accelerators.ts`. It
 * does not describe closing on an outside click, so this doesn't add one.
 *
 * It used to draw its own result list in a dropdown below the field, from a
 * three-row fixture. Results now live in `SearchOverlay`, which covers the
 * whole split row — there is far more to show than a dropdown can hold once
 * each result also has to drive a locator tree and a preview. What is left
 * here is the field itself, its type filter and its close button.
 */
export default function SearchSlot({
  expanded: expandedProp,
  onExpandedChange,
  session,
  onSubmit,
}: SearchSlotProps = {}) {
  const [selfExpanded, setSelfExpanded] = useState(false);
  const expanded = expandedProp ?? selfExpanded;
  const setExpanded = useCallback(
    (value: boolean) => {
      setSelfExpanded(value);
      onExpandedChange?.(value);
    },
    [onExpandedChange],
  );

  const [filterOpen, setFilterOpen] = useState(false);

  const filterWrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K opens from anywhere, matching every other global shortcut in the
  // shell — `hasPrimaryModifier` is the one place that decides what "Ctrl" is.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (hasPrimaryModifier(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setExpanded(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setExpanded]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  // The type-filter popover: dismiss on a click outside or Escape, without
  // collapsing the field underneath it. The handoff never distinguishes this
  // popover from the shell's other popovers, so it follows the same convention
  // every other popover in the shell uses (HealthPopover, SettingsPopover).
  useEffect(() => {
    if (!filterOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!filterWrapRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setFilterOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [filterOpen]);

  function closeSearch() {
    setExpanded(false);
    setFilterOpen(false);
  }

  // Arrow keys stay bound here rather than on the overlay, because the field
  // keeps focus the entire time search is open. The list below is not tabbable
  // and never takes focus, so its own keydown handler would never fire.
  function onFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      session?.moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      session?.moveActive(-1);
    } else if (e.key === "Enter") {
      // Enter means "act on the row the arrows are sitting on", which today is
      // "open it". When find-and-replace is showing, that mode owns this key
      // and means "replace this match" — the two never collide because the
      // replace UI takes over the results region entirely.
      e.preventDefault();
      onSubmit?.();
    }
  }

  if (!expanded) {
    return (
      <motion.div
        layoutId="search-slot"
        className="search-slot search-slot--collapsed"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(true);
          }
        }}
      >
        <Search size={14} className="search-slot__glyph search-slot__glyph--dim" />
        <span className="search-slot__label">Search</span>
        <span className="search-slot__hint">{accelerator({ key: "K" })}</span>
      </motion.div>
    );
  }

  const kinds = session?.kinds ?? [];

  return (
    <motion.div
      layoutId="search-slot"
      className="search-slot search-slot--expanded"
      onKeyDown={onFieldKeyDown}
    >
      <Search size={15} className="search-slot__glyph search-slot__glyph--accent" />
      <input
        ref={inputRef}
        className="search-slot__input"
        value={session?.query ?? ""}
        onChange={(e) => session?.setQuery(e.target.value)}
        placeholder="Search this project"
        spellCheck={false}
        autoComplete="off"
      />
      {/* No spacer between the input and the count any more: the input grows
          into the width the bar yields (see search.css), so the trailing
          controls are already pushed to the edge and a second `flex: 1` beside
          it would only halve the room it just gained. */}
      <span className="search-slot__count">{kinds.length} of 4 types</span>
      <div className="search-slot__filter-wrap" ref={filterWrapRef}>
        <button
          type="button"
          className="search-slot__filter-btn"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((open) => !open)}
        >
          <Sliders size={15} knobFill="var(--surface-2)" className="search-slot__filter-icon" />
        </button>
        <AnimatePresence>
          {filterOpen && session !== undefined && (
            <TypeFilterPopover selected={kinds} onToggle={session.toggleKind} />
          )}
        </AnimatePresence>
      </div>
      <button
        type="button"
        className="search-slot__close"
        aria-label="Close search"
        onClick={closeSearch}
      >
        <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="var(--text-dim-2)" strokeWidth="1.4" />
        </svg>
      </button>
    </motion.div>
  );
}
