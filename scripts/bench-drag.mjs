/**
 * PRD §14.7: "Node drag to layout write, under 50 ms, soft."
 *
 * No probe exists yet. Measuring this means dragging a node in the running
 * application and timing to the `layout/<schematic-slug>.json` write landing
 * on disk, and this repository's agents do not launch the application to do
 * that. Being `soft` (§14.7: a soft budget needs one named human sign-off
 * before merge rather than blocking CI outright) does not change that there
 * is nothing to run — a stub reports honestly either way. Wave 9 declares the
 * budget node with this script as its probe command regardless; see the
 * handoff for what a real implementation needs.
 */
import { stub } from "./bench-lib.mjs";

stub({
  name: "drag_to_write_ms",
  budget: "under 50 ms, soft",
  reason:
    "no probe exists yet — measuring this needs a launched application, a simulated drag, and a " +
    "watch on the layout write, which agents in this repository do not run. See docs/" +
    "overnight-jobs/overnight-2/handoffs/w9c-bench.md.",
});
