import { motion } from "framer-motion";
import { Check } from "../../ui/Icon";
import { popover } from "../motion";
import { ALL_KINDS, KIND_LABEL } from "./kinds";
import type { SearchKind } from "./types";

/**
 * The type-filter popover, opened from the filter button in the expanded
 * search field. Same surface/border/radius/shadow as the tool health popover
 * (src/shell/switcher/switcher.css) and the status bar's settings popover —
 * matched rather than re-invented, per the handoff's one floating-panel
 * shadow figure.
 *
 * The list is now the four `SearchKind`s rather than the handoff's five
 * `SearchType`s. The handoff's set mixed three file kinds with "terminal
 * output" and "tool settings", which are not files and cannot be found by
 * walking a directory. Whether those two come back as a separate source is
 * still open; if they do they belong under their own heading here, not as two
 * more rows in a list of file kinds, because unchecking "Scripts" and
 * unchecking "Terminal output" would be narrowing two different searches.
 */
export default function TypeFilterPopover({
  selected,
  onToggle,
}: {
  selected: SearchKind[];
  onToggle: (kind: SearchKind) => void;
}) {
  return (
    <motion.div className="search-filter" variants={popover} initial="initial" animate="animate" exit="exit">
      <div className="search-filter__header">FILTER BY TYPE</div>
      {ALL_KINDS.map((kind) => {
        const checked = selected.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            className="search-filter__row"
            aria-pressed={checked}
            onClick={() => onToggle(kind)}
          >
            <span className={`search-filter__box${checked ? " search-filter__box--checked" : ""}`}>
              {checked && <Check size={9} className="search-filter__check" />}
            </span>
            <span className={`search-filter__label${checked ? "" : " search-filter__label--dim"}`}>
              {KIND_LABEL[kind]}
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}
