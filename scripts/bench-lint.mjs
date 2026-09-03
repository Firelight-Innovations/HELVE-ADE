/**
 * PRD §14.7: "Full graph lint, stress fixture, under 500 ms, hard." Runs the
 * test that already asserts it — `crates/schematify-core/tests/lint.rs`'s
 * `the_stress_fixture_lints_inside_the_wave_seven_budget`, which times
 * `lint(graph)` alone and prints `stress-2000 lint in N ms` on the way to its
 * assertion — rather than timing the linter again here.
 */
import { runProbe } from "./bench-lib.mjs";

runProbe({
  name: "full_lint_ms",
  budget: "under 500 ms, hard",
  command: "cargo",
  args: [
    "test",
    "-p",
    "schematify-core",
    "--test",
    "lint",
    "the_stress_fixture_lints_inside_the_wave_seven_budget",
    "--",
    "--exact",
    "--nocapture",
  ],
  pattern: /stress-2000 lint in (\d+(?:\.\d+)?) ms/,
});
