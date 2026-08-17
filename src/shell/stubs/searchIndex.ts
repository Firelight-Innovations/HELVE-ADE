/**
 * Stand-in for the real search backend.
 *
 * The handoff's search crop (docs/handoffs/shell-spec.html, "Search" region
 * detail) draws exactly three result rows against a query of `forge_`, with
 * the type filter reading "3 of 5 types" for Content, Scripts and Assets
 * checked and Terminal output / Tool settings unchecked. This fixture is
 * those three rows, verbatim: the type column, the label, and (internally,
 * since `SearchResult` itself carries no `SearchType`) the `SearchType` each
 * belongs to, so `query` has something to filter on.
 */
import type { SearchIndex, SearchResult, SearchType } from "../contract";

interface FixtureEntry {
  searchType: SearchType;
  /** The lowercase kind for the leading 58px column — spec's own words. */
  type: string;
  label: string;
}

const FIXTURE: FixtureEntry[] = [
  { searchType: "assets", type: "asset", label: "forge_anvil.mesh" },
  { searchType: "scripts", type: "script", label: "forge_loop.lua" },
  { searchType: "content", type: "content", label: "Forge district — quest table" },
];

/**
 * Lenient on purpose — a case-insensitive substring match with trailing
 * punctuation stripped, rather than exact. The crop's own query, `forge_`, has
 * to turn up "Forge district — quest table" alongside the two `forge_*`
 * filenames; a strict match on the literal underscore would silently drop that
 * row and fail to reproduce the drawing.
 */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+$/i, "");
}

export const stubSearchIndex: SearchIndex = {
  /**
   * Filters by `types` only — matching the handoff crop, where the three
   * unchecked types simply have no rows rather than dimmed ones. See
   * SearchSlot.tsx for the "hidden vs greyed" call this fixture backs.
   */
  query(text: string, types: SearchType[]): SearchResult[] {
    const needle = normalize(text);
    return FIXTURE.filter((entry) => types.includes(entry.searchType))
      .filter((entry) => needle === "" || entry.label.toLowerCase().includes(needle))
      .map((entry) => ({ type: entry.type, label: entry.label }));
  },
};
