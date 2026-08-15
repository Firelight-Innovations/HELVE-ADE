import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SearchType, SearchResult } from "../contract";
import { Search, Sliders } from "../../ui/Icon";
import { stubSearchIndex } from "../stubs/searchIndex";
import TypeFilterPopover from "./TypeFilterPopover";
import "./search.css";

/**
 * The default reading of the handoff's "3 of 5 types" crop: Content,
 * Scripts and Assets checked, Terminal output and Tool settings not.
 */
const DEFAULT_TYPES: SearchType[] = ["content", "scripts", "assets"];

/** The exact query the handoff crop is drawn against. */
const DEFAULT_QUERY = "forge_";

export interface SearchSlotProps {
  /** Controlled expansion. Omit to keep the current self-owned behaviour. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
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
 * Open: ⌘K (Ctrl+K on non-mac) from anywhere, or a click on the collapsed
 * slot — both drawn from the handoff's caption verbatim. Close: Escape or
 * the close glyph, same caption. The handoff does not describe closing on an
 * outside click, so this deliberately doesn't add one; the type-filter
 * popover, which the handoff never distinguishes from the shell's other
 * popovers, does follow the outside-click-or-Escape convention every other
 * popover in the shell uses (HealthPopover, SettingsPopover).
 *
 * `expanded`/`onExpandedChange` are optional: standalone (no props) this
 * component owns its own open/closed state exactly as before. The switcher
 * bar needs to react to the field opening — clipping its whole tab row,
 * dropping the health badge and yielding its spacer, so the field takes the
 * bar edge to edge — so when it passes `expanded` in, that becomes the
 * source of truth and every internal path that used to call `setExpanded`
 * routes through the callback too. Internal state stays in sync either way
 * so the component never has two different opinions about whether it's
 * open.
 */
export default function SearchSlot({ expanded: expandedProp, onExpandedChange }: SearchSlotProps = {}) {
  const [selfExpanded, setSelfExpanded] = useState(false);
  const expanded = expandedProp ?? selfExpanded;
  const setExpanded = useCallback(
    (value: boolean) => {
      setSelfExpanded(value);
      onExpandedChange?.(value);
    },
    [onExpandedChange],
  );

  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [types, setTypes] = useState<SearchType[]>(DEFAULT_TYPES);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filterWrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results: SearchResult[] = stubSearchIndex.query(query, types);

  // ⌘K / Ctrl+K opens from anywhere, matching every other global shortcut in
  // the shell.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
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

  useEffect(() => {
    setActiveIndex(0);
  }, [query, types]);

  // The type-filter popover: dismiss like every other popover in the shell,
  // a click outside or Escape — without collapsing the field underneath it.
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

  function onFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
  }

  function toggleType(type: SearchType) {
    setTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));
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
        <span className="search-slot__hint">⌘K</span>
      </motion.div>
    );
  }

  return (
    <motion.div layoutId="search-slot" className="search-slot search-slot--expanded" onKeyDown={onFieldKeyDown}>
      <Search size={15} className="search-slot__glyph search-slot__glyph--accent" />
      <input
        ref={inputRef}
        className="search-slot__input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {/* No spacer between the input and the count any more: the input grows
          into the width the bar yields (see search.css), so the trailing
          controls are already pushed to the edge and a second `flex: 1` beside
          it would only halve the room it just gained. */}
      <span className="search-slot__count">
        {types.length} of 5 types
      </span>
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
          {filterOpen && <TypeFilterPopover selected={types} onToggle={toggleType} />}
        </AnimatePresence>
      </div>
      <button type="button" className="search-slot__close" aria-label="Close search" onClick={closeSearch}>
        <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="var(--text-dim-2)" strokeWidth="1.4" />
        </svg>
      </button>

      {/* The result list. No motion on rows — the handoff's rule that
          terminal output and the worktree list stay at native scroll speed
          extends here: this list never animates its own entries. */}
      <div className="search-slot__results">
        {results.map((result, i) => (
          <div
            key={`${result.type}-${result.label}-${i}`}
            className={`search-slot__result${i === activeIndex ? " search-slot__result--active" : ""}`}
            onMouseEnter={() => setActiveIndex(i)}
          >
            <span className="search-slot__result-type">{result.type}</span>
            <span className="search-slot__result-label">{result.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
