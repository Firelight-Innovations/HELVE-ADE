//! The startup sequence that runs behind the splash window.
//!
//! Before this module existed, `App.tsx` called `load_stack` itself once the
//! main window's React tree mounted — which meant the manifest read and the
//! checkout scan happened *after* the window was already on screen, so the
//! app sat blank for however long that took. Moving the same three steps
//! here lets them run while the splash window (which needs none of that data
//! to render) is what the user is looking at instead.
//!
//! This module owns the whole lifecycle: doing the work, reporting progress
//! to the splash window, and — via the watchdog at the bottom — making sure
//! the handoff to the main window happens even if the frontend never asks
//! for it.

use crate::discovery;
use crate::error::AppError;
use crate::manifest::{self, Manifest};
use crate::state::AppState;
use serde::Serialize;
// `Manager` puts `.state::<AppState>()` and `.get_webview_window(...)` on
// `AppHandle`; `Emitter` puts `.emit_to(...)` on it. Both are traits, so
// (as with `manifest.rs`'s `Manager` import) they only need to be in scope,
// never named again below.
use tauri::{AppHandle, Emitter, Manager};

/// How long the watchdog gives the frontend to call `finish_boot` on its own
/// once boot reaches `Ready` or `Failed`, before forcing the handoff.
const WATCHDOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Progress reported to the splash window, one value per `boot:status` event.
///
/// Internally tagged the same way `tool::ToolStatus` is: `#[serde(tag = ...)]`
/// makes this serialize as `{ "phase": "working", "step": 1, ... }` instead of
/// the default `{ "Working": { "step": 1, ... } }`, which is what turns into a
/// clean discriminated union on the TypeScript side (see `src/bindings.ts`).
///
/// `Ready` deliberately carries no data. The `StackSnapshot` it represents
/// already went into `AppState` via `store` — sending it again over the event
/// would just be a second, redundant copy of the same JSON. The frontend
/// picks it up through `cached_stack` instead.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum BootStatus {
    /// `rename_all = "camelCase"` here (as opposed to on the enum, which only
    /// governs the `phase` tag's own casing) is what would keep a multi-word
    /// field like `stepLabel` camelCase if one ever gets added — today's
    /// fields are single words so it's a no-op, but it matches the convention
    /// `StackSnapshot` and friends use and keeps this future-proof.
    #[serde(rename_all = "camelCase")]
    Working {
        step: u8,
        total: u8,
        label: String,
    },
    Ready,
    Failed {
        message: String,
    },
}

/// The number of `Working` steps boot reports. Kept as one constant so the
/// step count in every `emit` call and the `total` field can't drift apart.
/// `pub(crate)` rather than private: `commands::boot_status` reuses it to
/// build the same "nothing reported yet" fallback shape this module would
/// have produced for step 1 anyway.
pub(crate) const STEPS: u8 = 3;

/// Run the startup sequence and report progress to the splash window.
///
/// Called once from `lib.rs`'s `.setup()` hook, right after the splash window
/// has been created (it's `visible: true` in `tauri.conf.json`, so it's
/// already on screen the instant this fires).
///
/// This spawns a plain OS thread — `std::thread::spawn`, not
/// `tauri::async_runtime::spawn`. The distinction matters: `locate`, `load`,
/// and `resolve` are synchronous functions that do blocking filesystem I/O
/// with no `.await` points anywhere inside them. `tauri::async_runtime` is a
/// small pool of worker threads meant for tasks that cooperatively yield;
/// running blocking work on one of those threads doesn't yield, so it parks
/// the whole worker for the duration and starves every other async task
/// queued behind it. A dedicated OS thread blocks only itself — there's
/// nothing else sharing it — which is exactly what synchronous, blocking work
/// needs. (No `tokio` dependency required either way, which keeps the
/// dependency list matching what's already in `Cargo.toml`.)
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        emit(
            &app,
            BootStatus::Working {
                step: 1,
                total: STEPS,
                label: "Locating manifest".into(),
            },
        );
        let path = match manifest::locate(&app) {
            Ok(path) => path,
            Err(err) => return fail(app, err),
        };

        emit(
            &app,
            BootStatus::Working {
                step: 2,
                total: STEPS,
                label: "Reading manifest".into(),
            },
        );
        let manifest = match Manifest::load(&path) {
            Ok(manifest) => manifest,
            Err(err) => return fail(app, err),
        };

        emit(
            &app,
            BootStatus::Working {
                step: 3,
                total: STEPS,
                label: "Scanning checkouts".into(),
            },
        );
        let snapshot = match discovery::resolve(&path, &manifest) {
            Ok(snapshot) => snapshot,
            Err(err) => return fail(app, err),
        };

        app.state::<AppState>().store(snapshot);
        emit(&app, BootStatus::Ready);
        arm_watchdog(app);
    });
}

/// Report a failed boot and still arm the watchdog.
///
/// A missing manifest is the ordinary state of a machine nobody has cloned
/// the stack onto yet, not a bug — so this reports the error to the splash
/// window and returns normally. It never panics: a panic on this thread would
/// just vanish (nothing joins this thread's handle), leaving the splash
/// window frozen on its last "Working" message forever with no explanation
/// and no way forward.
fn fail(app: AppHandle, err: AppError) {
    emit(
        &app,
        BootStatus::Failed {
            message: err.to_string(),
        },
    );
    arm_watchdog(app);
}

/// Record a status update in `AppState` and send it to the splash window.
///
/// `emit` broadcasts to every window, but the main window's whole point is
/// that it's still hidden and has nothing listening — and after `finish`
/// closes the splash, any further emit would be preaching to an empty room
/// anyway. `emit_to` targets one window by label, which also means a splash
/// listener never has to filter out events meant for someone else.
///
/// Emitting is fire-and-forget: the only way it fails is if the `splash`
/// window has already gone away (e.g. the watchdog raced this call), and at
/// that point there is no one left to tell, so the error is dropped.
///
/// The write to `AppState` happens *before* the emit, not after, and that
/// ordering is load-bearing: it guarantees that any poll of
/// `AppState::boot_status` landing anywhere after this call observes at
/// least this value, never something older. Flipping the order would open a
/// window where the event has gone out (so a listener that was already
/// subscribed sees it) but a poll racing it still reads the previous status
/// — trading the original "missed every event" bug for a smaller but
/// equally real "poll returns stale data" one.
fn emit(app: &AppHandle, status: BootStatus) {
    app.state::<AppState>().store_boot_status(status.clone());
    let _ = app.emit_to("splash", "boot:status", status);
}

/// Show `main` and close `splash`. Called from the `finish_boot` command
/// (the frontend's normal path) and from the watchdog below (the fallback
/// path) — both can fire, so this has to tolerate running twice.
///
/// `get_webview_window` hands back an `Option` rather than a `Result` because
/// "no window with this label" isn't really an error, it's just a fact about
/// what currently exists. That makes the idempotency free: the second call
/// finds `main` already shown (showing it again is harmless) and finds
/// `splash` already gone (so the `if let Some` for it simply doesn't run),
/// rather than needing an explicit "have I already run?" flag.
pub fn finish(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
}

/// Force the handoff if nobody has called `finish_boot` within
/// `WATCHDOG_TIMEOUT` of boot reaching `Ready` or `Failed`.
///
/// A splash window that never closes is a hang the user can't recover from
/// short of killing the process — worth guarding even though, in the normal
/// case, the frontend's own listener beats this to it comfortably. Another
/// `std::thread::spawn` paired with a blocking `std::thread::sleep` is fine
/// here for the same reason it was fine in `start`: this thread has nothing
/// else to do while it waits, so there's no cooperative-scheduling downside
/// to it blocking.
fn arm_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(WATCHDOG_TIMEOUT);
        finish(&app);
    });
}
