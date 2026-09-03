/**
 * PRD §14.7: "Cold launch to first Schematic paint, under 2000 ms, hard."
 *
 * No probe exists yet. Measuring this means launching the real application
 * and timing wall clock to its first Schematic paint, and this repository's
 * agents do not launch it (CLAUDE.md: port 1420 is reserved for the person
 * verifying by hand). Wave 9 declares the budget node either way, with this
 * script as its probe command — see the handoff for what a real
 * implementation needs.
 */
import { stub } from "./bench-lib.mjs";

stub({
  name: "cold_launch_ms",
  budget: "under 2000 ms, hard",
  reason:
    "no probe exists yet — measuring this needs a launched application and a splash-to-paint " +
    "timer, which agents in this repository do not run. See docs/overnight-jobs/overnight-2/" +
    "handoffs/w9c-bench.md.",
});
