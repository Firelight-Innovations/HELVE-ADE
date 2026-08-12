import { useEffect, useRef, useState } from "react";
import { bootStatus, finishBoot, onBootStatus, type BootStatus } from "../bindings";
import SplashArt from "./SplashArt";

/**
 * Minimum time the splash stays up after mounting, no matter how fast boot
 * finishes. Without this, a boot that completes in a couple of milliseconds
 * (a warm disk cache, a tiny manifest) would show up as a flash of a window
 * nobody had time to actually read. This only holds back the *handoff* to
 * the main window — the Rust-side work in `boot.rs` runs at full speed
 * either way and is usually done before this timer is.
 */
const MIN_VISIBLE_MS = 800;

const INITIAL_STATUS: BootStatus = {
  phase: "working",
  step: 0,
  total: 3,
  label: "Starting…",
};

export default function Splash() {
  const [status, setStatus] = useState<BootStatus>(INITIAL_STATUS);
  // A ref rather than state: the mount timestamp is read once inside the
  // effect below and should never itself cause a re-render.
  const mountedAt = useRef(performance.now());

  useEffect(() => {
    let cancelled = false;
    // Tauri events aren't replayed: if boot reports `Ready` before this
    // component has finished mounting and registered its listener (very
    // possible — boot's filesystem work can finish in under a millisecond on
    // a warm cache, while getting a webview through init and React through
    // its first render routinely takes tens of milliseconds), that event is
    // simply gone. `bootStatus()` below is the fix: it asks Rust for
    // whatever the latest status already is, closing that gap.
    //
    // That poll opens a smaller race in the other direction, though — its
    // response can land *after* a live event has already moved `status`
    // forward, and applying it then would overwrite newer data with older.
    // This flag is the guard: once any live event has arrived, the poll's
    // response (whenever it shows up) is discarded. Status only ever moves
    // forward — working, then exactly one of ready/failed — so "has a live
    // event arrived at all" is sufficient to tell stale from current; no
    // sequence numbers needed.
    let liveEventReceived = false;
    // Guards the ready -> main-window handoff so it only ever gets armed
    // once, however `status` first reaches `ready` — via the live listener,
    // via the poll, or (in principle) both racing each other.
    let handoffArmed = false;

    const armReadyHandoff = () => {
      if (handoffArmed) return;
      handoffArmed = true;
      // Hold the handoff until MIN_VISIBLE_MS has elapsed since mount, but
      // not a moment longer — if boot was already slow enough to clear the
      // minimum on its own (or `status` only reached `ready` via a poll that
      // ran well after mount), this fires immediately.
      const elapsed = performance.now() - mountedAt.current;
      const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
      window.setTimeout(() => {
        if (!cancelled) finishBoot().catch((err) => console.error(String(err)));
      }, remaining);
    };

    // Listen *before* polling. Registering the live listener first closes
    // the main race this all exists to fix: even if boot's next event fires
    // in the gap between mount and the poll's response coming back, it's
    // caught live here rather than missed and papered over by a stale poll.
    const unlistenPromise = onBootStatus((next) => {
      if (cancelled) return;
      liveEventReceived = true;
      setStatus(next);
      if (next.phase === "ready") armReadyHandoff();
      // "failed" is deliberately *not* auto-finished — see the "Continue
      // anyway" button below. The user should get a chance to read why
      // before being dropped into the main window.
    });

    // Chained off `unlistenPromise` rather than fired alongside it, and that
    // is the whole point: `listen` is itself an async IPC call that resolves
    // only once the listener is actually registered on the Rust side. Calling
    // `bootStatus()` in source order after it would still let the poll's
    // response come back *first*, leaving a window between the poll and the
    // registration in which an event could fire and be lost by both paths —
    // the exact bug this is meant to close, just narrower. Waiting for
    // registration costs one extra round-trip and removes the gap entirely.
    unlistenPromise
      .then(() => bootStatus())
      .then((polled) => {
        if (cancelled || liveEventReceived) return;
        setStatus(polled);
        // Boot may already have reached `ready` (or `failed`) before this
        // component ever mounted — e.g. a very fast boot on a slow-loading
        // splash webview. Arming the handoff here too is what stops that
        // case from sitting untouched until the 10s watchdog forces it.
        if (polled.phase === "ready") armReadyHandoff();
      })
      .catch((err) => console.error(String(err)));

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const progress =
    status.phase === "working" ? status.step / status.total : status.phase === "ready" ? 1 : 0;

  const label =
    status.phase === "working"
      ? status.label
      : status.phase === "ready"
        ? "Ready"
        : "Startup failed";

  return (
    <div className="splash">
      <SplashArt />

      <div className="splash__body">
        <p className="splash__label mono">{label}</p>

        <div
          className="splash__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={progress}
        >
          <div className="splash__bar-fill" style={{ width: `${progress * 100}%` }} />
        </div>

        {status.phase === "failed" && (
          <>
            <p className="splash__error mono">{status.message}</p>
            <button
              type="button"
              className="splash__continue"
              onClick={() => finishBoot().catch((err) => console.error(String(err)))}
            >
              Continue anyway
            </button>
          </>
        )}
      </div>
    </div>
  );
}
