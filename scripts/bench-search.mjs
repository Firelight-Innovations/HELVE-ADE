/**
 * PRD §14.7: "Search first result, under 100 ms, hard."
 *
 * No probe exists yet, and unlike startup and drag, this one is not blocked
 * on a launched application — it is blocked on Wave 8 itself, which builds
 * `schematify_search` and its ranking. Nothing under `apps/schematify/ui` or
 * `crates/schematify-core` implements search as of this wave (confirmed by
 * grep before writing this stub). Wave 9 declares the budget node with this
 * script as its probe command regardless; see the handoff.
 */
import { stub } from "./bench-lib.mjs";

stub({
  name: "search_first_result_ms",
  budget: "under 100 ms, hard",
  reason:
    "no probe exists yet — Wave 8's search and ranking are not built as of this wave, so there " +
    "is nothing to time. See docs/overnight-jobs/overnight-2/handoffs/w9c-bench.md.",
});
