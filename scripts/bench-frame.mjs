/**
 * PRD §14.7: "Service Schematic frame time, dense fixture, under 16 ms,
 * hard." Runs the test that already asserts it —
 * `apps/schematify/ui/src/engine/frameBudget.test.ts`'s median-of-21 case,
 * which prints `dense fixture frame time: median N ms over 21 samples` on
 * the way to its assertion — rather than timing the engine again here.
 *
 * `--reporter=verbose` because vitest's default reporter only surfaces a
 * passing test's `console.log` output when asked; without it this script
 * would have nothing to parse on a clean run.
 */
import { runProbe } from "./bench-lib.mjs";

runProbe({
  name: "frame_time_ms",
  budget: "under 16 ms, hard",
  command: "npx",
  args: [
    "vitest",
    "run",
    "apps/schematify/ui/src/engine/frameBudget.test.ts",
    "--reporter=verbose",
  ],
  pattern: /median (\d+(?:\.\d+)?) ms over \d+ samples/,
});
