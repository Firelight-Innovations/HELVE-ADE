/**
 * PRD §14.7: "Graph load, stress fixture, under 1000 ms, hard." Runs the test
 * that already asserts it — `crates/schematify-core/tests/fixtures.rs`'s
 * `the_stress_fixture_loads_inside_the_wave_one_budget`, which times the
 * loader alone and prints `stress-2000 loaded in N ms` on the way to its
 * assertion — rather than timing the loader again here.
 */
import { runProbe } from "./bench-lib.mjs";

runProbe({
  name: "graph_load_ms",
  budget: "under 1000 ms, hard",
  command: "cargo",
  args: [
    "test",
    "-p",
    "schematify-core",
    "--test",
    "fixtures",
    "the_stress_fixture_loads_inside_the_wave_one_budget",
    "--",
    "--exact",
    "--nocapture",
  ],
  pattern: /stress-2000 loaded in (\d+(?:\.\d+)?) ms/,
});
