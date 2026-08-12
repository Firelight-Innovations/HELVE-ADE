/**
 * Stand-in for the real engine status source.
 *
 * The handoff is explicit that what the engine reports beyond the five stub
 * strings is not decided (docs/handoffs/shell-spec.html, "NOT DECIDED — DO
 * NOT INVENT"). Until the backend has an opinion, this holds `idle` and
 * notifies once on subscribe, so anything wired to an `EngineStatusSource`
 * — `StatusBar` included — always has a state to render.
 */
import type { EngineState, EngineStatusSource } from "../contract";

export const idleEngineStatus: EngineStatusSource = {
  subscribe(cb) {
    cb("idle");
    return () => {};
  },
};

/** All five states, in the order the handoff's reference table lists them. */
const ENGINE_CYCLE: EngineState[] = ["idle", "building", "running", "failed", "none"];

/**
 * Development-only: cycles through all five engine states on an interval, so
 * `StatusBar` can be checked against every dot colour and every label from
 * `ENGINE_LABEL` / `ENGINE_TOKEN`. Not wired into the shell anywhere — call
 * it from a dev harness or the browser console to drive `StatusBar` by hand.
 */
export function createCyclingEngineStatus(intervalMs = 1500): EngineStatusSource {
  return {
    subscribe(cb) {
      let i = 0;
      cb(ENGINE_CYCLE[i]);
      const timer = setInterval(() => {
        i = (i + 1) % ENGINE_CYCLE.length;
        cb(ENGINE_CYCLE[i]);
      }, intervalMs);
      return () => clearInterval(timer);
    },
  };
}
