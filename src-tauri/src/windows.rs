//! Creating and destroying the windows a detached surface lives in.
//!
//! Every window loads the same `index.html` with a `?window=<label>` query.
//! There is no second frontend and no reduced build: a detached window mounts
//! the same `WindowRoot`, reads the same shared state, and has the same title
//! bar, switcher bar and panel as the main one. Keeping it the same code is
//! what makes a detached surface feel like the same application rather than a
//! stripped-down popup.
//!
//! ## Labels are opaque
//!
//! They used to be `tool-<id>`, which made "one window per tool" true by
//! construction — there was no second label a second Files could have had, and
//! `detach` had to focus the existing window instead of building one. Labels
//! are now `win-<n>`, minted by `ShellState`, and carry no meaning at all.
//!
//! That change has a consequence worth stating where it will be read: Tauri
//! scopes capabilities per window label, and `capabilities/default.json` globs
//! on those labels. A window whose label matches nothing there gets *no*
//! permissions — including `core:default`, which is what carries
//! `event:allow-listen`. It would mount, render, and then never receive
//! `shell:state`, `project:changed`, or a single byte of `pty:data:*`, with
//! nothing in any console to say why. The glob and this function have to be
//! changed together.

use crate::error::{AppError, Result};
use crate::shell_state::{ShellState, WindowGeometry};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// Default size for a window that has no remembered geometry. Logical pixels,
/// because it is a design figure rather than a measurement — see `create` for
/// how carefully the two are kept apart everywhere else in this module.
const DEFAULT_SIZE: (f64, f64) = (900.0, 620.0);
const MIN_SIZE: (f64, f64) = (480.0, 360.0);

/// The shell's own title bar height, in logical pixels — `--h-titlebar`, which
/// `Frame` draws at 34px. Used by `at_drop_point` to put the cursor on the bar
/// of the window it just tore off, the way every tab tear-off does.
const TITLEBAR_HEIGHT: f64 = 34.0;

/// Build a window for a label the state already knows about.
///
/// `geometry` is a rectangle in **physical** pixels — a remembered one, already
/// clamped to a display that exists (`shell_store::clamp_to_visible`), or the
/// drop point of the drag that asked for this window (`at_drop_point`). `None`
/// means "put it wherever Windows would", which is the fallback for a restored
/// window whose saved monitor is gone and for a drag whose cursor could not be
/// read.
///
/// ## Why the rectangle is applied after the build and not in the builder
///
/// `WebviewWindowBuilder::position` and `::inner_size` take **logical** pixels —
/// `tauri-runtime-wry` wraps both in `TaoLogicalPosition`/`TaoLogicalSize` — and
/// every rectangle this module deals in is physical: `geometry_of` reads
/// `outer_position`/`outer_size`, and `shell_store` compares against
/// `available_monitors`, all three of which report physical. Feeding one to the
/// other silently multiplied every restored window's position and size by the
/// display's scale factor, so on Braden's scaled monitor a window saved at
/// 2714x1628 came back asking for something half again as large as the screen.
/// `set_position`/`set_size` take a `PhysicalPosition`/`PhysicalSize` and mean
/// it, which is why `lib.rs` already used them for `main`; this is the same
/// route for every other window.
///
/// The window is therefore always built hidden and shown at the end, so that
/// nothing is ever on screen at the wrong place for the frame between the build
/// and the move.
///
/// `visible` is false only while restoring a session: those windows are built
/// behind the splash and shown together by `boot::finish`, so that none of them
/// is caught half-drawn. A window created by a drag has no splash to wait for
/// and must appear at once — an invisible one would read as the drag having
/// silently lost the tab.
///
/// `set_focus` matters more than it looks. A drag that ends outside HELVE ends
/// with a button release over *another* application, which takes the foreground
/// with it; Windows will not let a background process raise a new window over
/// the foreground one, so without this the torn-off window opens behind whatever
/// the user dropped on and blinks in the taskbar instead. That is
/// indistinguishable from the gesture having done nothing.
pub fn create(
    app: &AppHandle,
    label: &str,
    geometry: Option<WindowGeometry>,
    visible: bool,
) -> Result<()> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html?window={label}").into());
    let window = WebviewWindowBuilder::new(app, label, url)
        // The custom title bar is part of the design, in a detached window
        // exactly as in the main one.
        .decorations(false)
        .title("Helve")
        .visible(false)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .build()
        .map_err(|source| AppError::Window {
            label: label.to_string(),
            source,
        })?;

    if let Some(g) = geometry {
        let _ = window.set_position(PhysicalPosition::new(g.x, g.y));
        let _ = window.set_size(PhysicalSize::new(g.width, g.height));
    }

    if visible {
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

/// Where a window torn off by a drag should appear: under the cursor that
/// dropped it.
///
/// Without this, both detach paths passed `None` and the answer was "wherever
/// Windows would put it". That answer is not neutral and it is not near the
/// cursor: tao falls back to `CW_USEDEFAULT` for a window created with no
/// position (`platform_impl/windows/window.rs`), and Windows cascades those from
/// the top-left of the **primary** monitor. So the one gesture this whole
/// feature exists for — drag a cluster onto the second screen — opened the new
/// window on the first one, every time, several hundred pixels from anything the
/// user was looking at. On a two-monitor desk that is indistinguishable from the
/// drop having done nothing at all.
///
/// Physical pixels throughout, which is why the scale factor is taken from the
/// monitor under the cursor rather than assumed: `DEFAULT_SIZE` is a logical
/// figure and `cursor_position` is physical, and the drop monitor is exactly the
/// one whose scaling decides how large 900x620 is in the space they have to
/// share. Reading it from the *primary* monitor is how a window torn off onto a
/// 100% second screen comes out half-size on a 200% laptop panel.
///
/// The cursor lands centred on the new window's title bar, the way tearing a tab
/// out of a browser does, so the window appears under the hand that dropped it
/// rather than beside it. `clamp_to_visible` is the last word, and its rule is
/// the right one here too: a window whose centre is on a monitor is left exactly
/// where it was put, and only one that landed nowhere is recentred.
///
/// `None` means the cursor could not be read at all, which leaves `create` to
/// fall back to Windows' placement. Better a window in the wrong corner than no
/// window.
fn at_drop_point(app: &AppHandle) -> Option<WindowGeometry> {
    let cursor = app.cursor_position().ok()?;
    let scale = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .map_or(1.0, |m| m.scale_factor());

    let width = (DEFAULT_SIZE.0 * scale).round().max(1.0) as u32;
    let height = (DEFAULT_SIZE.1 * scale).round().max(1.0) as u32;

    crate::shell_store::clamp_to_visible(
        app,
        WindowGeometry {
            x: (cursor.x - f64::from(width) / 2.0).round() as i32,
            y: (cursor.y - TITLEBAR_HEIGHT * scale / 2.0).round() as i32,
            width,
            height,
        },
    )
}

/// Pull a surface out of its window and into a new one.
///
/// Bookkeeping first, window second. `detach_instance` returning false means
/// the surface is not on screen anywhere — creating a window for it would put
/// an empty frame on screen with nothing to show and no way to get it back.
///
/// The cursor is read *after* the bookkeeping and not before, and it costs
/// nothing to say why: `at_drop_point` asks Windows where the pointer is now,
/// and "now" is a few hundred microseconds of lock and broadcast later than the
/// release. A hand does not move meaningfully in that time, and the alternative
/// — carrying a screen point up from the webview — means converting CSS pixels
/// to physical across monitors that may not share a scale factor, which is the
/// class of arithmetic this module has already been bitten by once.
pub fn detach(app: &AppHandle, state: &ShellState, instance_id: &str) -> Result<()> {
    let label = state.claim_window_label();

    if !state.detach_instance(app, instance_id, &label) {
        return Err(AppError::UnknownTool(instance_id.to_string()));
    }

    create(app, &label, at_drop_point(app), true)
}

/// Pull a whole cluster out of its window and into a new one.
///
/// The same shape and the same ordering as `detach` above, one level up: a
/// cluster is not a surface being lifted into a fresh cluster, it *is* the
/// cluster, so its tree arrives in the new window exactly as it left.
///
/// `move_cluster` returning false now means one thing only: no window holds that
/// cluster, so it has already been closed or never existed. It used to also mean
/// "that was the last cluster in its window", and that refusal is gone — see
/// `move_cluster_pure`. Building the window first would still have put an empty
/// frame on screen for a move that never happened, so the ordering stays.
pub fn detach_cluster(app: &AppHandle, state: &ShellState, cluster_id: &str) -> Result<()> {
    let label = state.claim_window_label();

    if !state.move_cluster(app, cluster_id, &label) {
        return Err(AppError::UnknownTool(cluster_id.to_string()));
    }

    create(app, &label, at_drop_point(app), true)
}

/// Which HELVE window the cursor is over, if any.
///
/// A tab moves between windows by being dropped into another window, and no
/// window's frontend can work out where that is. Each window is its own webview
/// with its own DOM and its own coordinate space; a page's pointer events stop
/// at that page's edge, so the window holding the drag cannot see another
/// window's geometry, let alone whether the cursor is over it. Only the process
/// that owns all of them can hit-test a screen point against all of them, which
/// is why this is here and not in TypeScript.
///
/// The splash window is deliberately not a candidate — it is not a place
/// anything can live, and by the time anyone is dragging it is closed.
pub fn at_cursor(app: &AppHandle) -> Option<String> {
    let cursor = app.cursor_position().ok()?;

    let candidates: Vec<(String, WebviewWindow)> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label != "splash")
        .filter(|(_, w)| w.is_visible().unwrap_or(false))
        .filter(|(_, w)| contains(w, cursor.x, cursor.y))
        .collect();

    // Windows overlap, and `webview_windows` is a map with no z-order in it.
    // The focused window is the one under the cursor in every case that
    // matters — you are dragging in it — so prefer it, and fall back to any
    // hit rather than refusing to answer.
    candidates
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .or_else(|| candidates.first())
        .map(|(label, _)| label.clone())
}

/// Where a window is now, in physical pixels.
///
/// Physical on both sides deliberately: `outer_position` and `outer_size` agree
/// on that, and so does `available_monitors`, which is the only reason a
/// restored rectangle can be compared against a display at all. Mixing in a
/// scale factor is how a window restores half-size on a scaled monitor.
///
/// Takes a `Window` rather than a `WebviewWindow` because the only caller is
/// `on_window_event`, which is handed the former — a window's position is a
/// property of the OS window, not of the webview inside it.
pub fn geometry_of(window: &tauri::Window) -> Option<WindowGeometry> {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return None;
    };
    Some(WindowGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

/// Whether a window's outer rectangle contains a screen point. Physical pixels
/// on both sides — see `geometry_of`.
fn contains(window: &WebviewWindow, x: f64, y: f64) -> bool {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let (left, top) = (f64::from(pos.x), f64::from(pos.y));
    x >= left && x < left + f64::from(size.width) && y >= top && y < top + f64::from(size.height)
}

/// The one place a window's close is handled, regardless of who asked for it.
///
/// Runs from `WindowEvent::CloseRequested`, which fires identically whether
/// the request came from our own titlebar's × (`commands::close_window` calls
/// `WebviewWindow::close`, which "emits `CloseRequested` first like a
/// user-initiated close request" — see its own doc comment), Alt+F4, the
/// taskbar's "Close window", or a graceful OS shutdown closing each top-level
/// window in turn. Before this lived here, only the first of those went
/// through bookkeeping at all; the other three reached `WindowEvent::
/// Destroyed` with the label never marked closing, so `reclaim_window` bailed
/// and the window was never removed from `ShellState` — the exact
/// resurrection bug `reclaim` (below) exists to prevent, reachable by a route
/// `close_window` could not see.
///
/// `CloseRequested` never fires for the shutdown `AppHandle::exit` triggers
/// below: that goes straight to the runtime requesting the event loop stop,
/// without visiting any window's close path, so it can never be mistaken for
/// one of these.
pub fn request_close(app: &AppHandle, state: &ShellState, label: &str) {
    if label == "main" {
        // `main` is the session, not just a window: closing it ends HELVE
        // rather than leaving secondaries stranded on screen with no way
        // back to `main`. Whatever is still open at this moment is what gets
        // persisted — a three-window session closed via `main` restores as
        // three windows next launch. Flush first: `set_geometry` records
        // position and size without writing them, and this is the last
        // moment to commit that before the process ends.
        state.flush(app);
        app.exit(0);
        return;
    }

    // Marked and reclaimed together, synchronously, in this same call —
    // `reclaim_window`'s own `mutate` persists, so `label` is off disk before
    // any later close (of `main`, or of another window) can flush a snapshot
    // that still lists it. See `ShellState::reclaim_window`.
    state.mark_closing(label);
    state.reclaim_window(app, label);
}

/// Called when a window finishes closing: fold its clusters back into the
/// main window so nothing is stranded in a window that no longer exists.
///
/// This does nothing unless the close was announced through `mark_closing` —
/// and even then, usually nothing at all, since `request_close` now reclaims
/// from `CloseRequested`, before the window actually closes, so the marker
/// this checks is already consumed by the time `Destroyed` lands here. What is
/// left is a fallback for a window the OS destroys directly, without asking it
/// to close first — which is also exactly why this still has to check the
/// marker rather than reclaim unconditionally: `WindowEvent::Destroyed` fires
/// for *every* window when a shutdown tears them all down that way, and a
/// reclaim that trusted it would collapse a three-window session into one on
/// the way out, and persist that as the layout to restore. See
/// `ShellState::closing`.
pub fn reclaim(app: &AppHandle, state: &ShellState, label: &str) {
    state.reclaim_window(app, label);
}
