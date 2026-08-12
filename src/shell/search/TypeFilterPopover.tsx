import { motion } from "framer-motion";
import type { SearchType } from "../contract";
import { SEARCH_TYPE_LABEL } from "../contract";
import { Check } from "../../ui/Icon";
import { popover } from "../motion";

const ALL_TYPES: SearchType[] = ["content", "scripts", "assets", "terminal", "settings"];

/**
 * The type-filter popover, opened from the filter button in the expanded
 * search field. Same surface/border/radius/shadow as the tool health popover
 * (src/shell/switcher/switcher.css) and the status bar's settings popover —
 * matched rather than re-invented, per the handoff's one floating-panel
 * shadow figure.
 */
export default function TypeFilterPopover({
  selected,
  onToggle,
}: {
  selected: SearchType[];
  onToggle: (type: SearchType) => void;
}) {
  return (
    <motion.div className="search-filter" variants={popover} initial="initial" animate="animate" exit="exit">
      <div className="search-filter__header">FILTER BY TYPE</div>
      {ALL_TYPES.map((type) => {
        const checked = selected.includes(type);
        return (
          <button
            key={type}
            type="button"
            className="search-filter__row"
            aria-pressed={checked}
            onClick={() => onToggle(type)}
          >
            <span className={`search-filter__box${checked ? " search-filter__box--checked" : ""}`}>
              {checked && <Check size={9} className="search-filter__check" />}
            </span>
            <span className={`search-filter__label${checked ? "" : " search-filter__label--dim"}`}>
              {SEARCH_TYPE_LABEL[type]}
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}
