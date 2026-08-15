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
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Default size for a window that has no remembered geometry.
const DEFAULT_SIZE: (f64, f64) = (900.0, 620.0);
const MIN_SIZE: (f64, f64) = (480.0, 360.0);

/// Build a window for a label the state already knows about.
///
/// `geometry` is the remembered rectangle, already clamped to a display that
/// exists — see `shell_store::clamp_to_visible`. `None` means "put it wherever
/// Tauri would", which is right both for a brand-new window and for a restored
/// one whose saved monitor is gone.
///
/// `visible` is false only while restoring a session: those windows are built
/// behind the splash and shown together by `boot::finish`, so that none of them
/// is caught half-drawn. A window created by a drag has no splash to wait for
/// and must appear at once — an invisible one would read as the drag having
/// silently lost the tab.
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
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        // The custom title bar is part of the design, in a detached window
        // exactly as in the main one.
        .decorations(false)
        .title("Helve")
        .visible(visible)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1);

    builder = match geometry {
        Some(g) => builder
            .position(f64::from(g.x), f64::from(g.y))
            .inner_size(f64::from(g.width), f64::from(g.height)),
        None => builder.inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1),
    };

    builder.build().map_err(|source| AppError::Window {
        label: label.to_string(),
        source,
    })?;

    Ok(())
}

/// Pull a surface out of its window and into a new one.
///
/// Bookkeeping first, window second. `detach_instance` returning false means
/// the surface is not on screen anywhere — creating a window for it would put
/// an empty frame on screen with nothing to show and no way to get it back.
pub fn detach(app: &AppHandle, state: &ShellState, instance_id: &str) -> Result<()> {
    let label = state.claim_window_label();

    if !state.detach_instance(app, instance_id, &label) {
        return Err(AppError::UnknownTool(instance_id.to_string()));
    }

    create(app, &label, None, true)
}

/// Pull a whole cluster out of its window and into a new one.
///
/// The same shape and the same ordering as `detach` above, one level up: a
/// cluster is not a surface being lifted into a fresh cluster, it *is* the
/// cluster, so its tree arrives in the new window exactly as it left.
///
/// `move_cluster` returning false means the move was refused — most often
/// because it was the last cluster in its window, which a window may not be left
/// without. Building the window first would have put an empty frame on screen
/// for a move that never happened.
pub fn detach_cluster(app: &AppHandle, state: &ShellState, cluster_id: &str) -> Result<()> {
    let label = state.claim_window_label();

    if !state.move_cluster(app, cluster_id, &label) {
        return Err(AppError::UnknownTool(cluster_id.to_string()));
    }

    create(app, &label, None, true)
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

/// Called when a window closes: fold its clusters back into the main window so
/// nothing is stranded in a window that no longer exists.
///
/// This does nothing unless the close was announced through `close_window`.
/// `WindowEvent::Destroyed` cannot tell a deliberate close from the application
/// shutting down, and at shutdown it fires for *every* window — so a reclaim
/// that trusted it would collapse a three-window session into one on the way
/// out, and persist that as the layout to restore. See `ShellState::closing`.
pub fn reclaim(app: &AppHandle, state: &ShellState, label: &str) {
    state.reclaim_window(app, label);
}
