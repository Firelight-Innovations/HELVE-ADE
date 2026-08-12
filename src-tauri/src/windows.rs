//! Creating and destroying the windows a detached tool lives in.
//!
//! Detaching is drag-only — there is no pop-out button anywhere in the shell —
//! so the only caller of this is the drag layer, once a tab has been pulled
//! clear of the switcher bar.
//!
//! Every window loads the same `index.html` with a `?window=<label>` query.
//! There is no second frontend and no reduced build: a detached window mounts
//! the same `WindowRoot` and reads the same shared state, and the only thing it
//! renders differently is that it has no switcher bar, because it holds exactly
//! one tool. Keeping it the same code is what makes a detached tool feel like
//! the same application rather than a stripped-down popup.

use crate::error::{AppError, Result};
use crate::shell_state::ShellState;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Detached windows are labelled `tool-<id>`. The prefix is what the capability
/// file globs on, and what `reclaim` recognises on close.
pub fn label_for(tool_id: &str) -> String {
    format!("tool-{tool_id}")
}

/// Pull a tool out of its window and into a new one.
///
/// Bookkeeping first, window second. `detach_tool` returning false means the
/// tool wasn't docked anywhere — creating a window for it would put an empty
/// frame on screen with nothing to show and no way to get it back.
pub fn detach(app: &AppHandle, state: &ShellState, tool_id: &str) -> Result<()> {
    let label = label_for(tool_id);

    if app.get_webview_window(&label).is_some() {
        // Already out. Bring it forward instead of building a second one.
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.set_focus();
        }
        return Ok(());
    }

    if !state.detach_tool(app, tool_id, &label) {
        return Err(AppError::UnknownTool(tool_id.to_string()));
    }

    let url = WebviewUrl::App(format!("index.html?window={label}").into());
    WebviewWindowBuilder::new(app, &label, url)
        // The custom title bar is part of the design, in a detached window
        // exactly as in the main one — same 34px band, same logo at the
        // leading edge, same centred `HELVE Engine — [tool]`.
        .decorations(false)
        .title("Helve")
        .inner_size(900.0, 620.0)
        .min_inner_size(480.0, 360.0)
        .build()
        .map_err(|source| AppError::Window {
            label: label.clone(),
            source,
        })?;

    Ok(())
}

/// Which HELVE window the cursor is over, if any.
///
/// A terminal moves between windows by being dropped into another window's
/// panel, and no window's frontend can work out where that is. Each window is
/// its own webview with its own DOM and its own coordinate space; a page's
/// pointer events stop at that page's edge, so the window holding the drag
/// cannot see another window's geometry, let alone whether the cursor is over
/// it. Only the process that owns all of them can hit-test a screen point
/// against all of them, which is why this is here and not in TypeScript.
///
/// The splash window is deliberately not a candidate — it is not a place a
/// terminal can live, and by the time anyone is dragging one it is closed.
pub fn at_cursor(app: &AppHandle) -> Option<String> {
    let cursor = app.cursor_position().ok()?;

    let candidates: Vec<(String, WebviewWindow)> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label == "main" || label.starts_with("tool-"))
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

/// Whether a window's outer rectangle contains a screen point. Physical pixels
/// on both sides — `cursor_position` and `outer_position` agree on that, which
/// is the only reason this comparison is meaningful on a scaled display.
fn contains(window: &WebviewWindow, x: f64, y: f64) -> bool {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let (left, top) = (f64::from(pos.x), f64::from(pos.y));
    x >= left && x < left + f64::from(size.width) && y >= top && y < top + f64::from(size.height)
}

/// Called when a detached window closes: fold its tools and terminals back into
/// the main window so nothing is stranded in a window that no longer exists.
pub fn reclaim(app: &AppHandle, state: &ShellState, label: &str) {
    if label == "main" {
        return;
    }
    state.reclaim_window(app, label);
}
