/**
 * PRD §14.7: "Search first result, under 100 ms, hard." Runs the test that
 * already asserts it — `crates/schematify-core/tests/registries.rs`'s
 * `search_returns_a_first_result_inside_the_wave_eight_budget`, which times
 * `GraphIndex::search` alone and prints `stress-2000 search in N us` on the
 * way to its assertion — rather than timing the search again here.
 */
import { runProbe } from "./bench-lib.mjs";

runProbe({
  name: "search_first_result_ms",
  budget: "under 100 ms, hard",
  command: "cargo",
  args: [
    "test",
    "-p",
    "schematify-core",
    "--test",
    "registries",
    "search_returns_a_first_result_inside_the_wave_eight_budget",
    "--",
    "--exact",
    "--nocapture",
  ],
  pattern: /stress-2000 search in (\d+(?:\.\d+)?) us/,
  unit: "us",
});
