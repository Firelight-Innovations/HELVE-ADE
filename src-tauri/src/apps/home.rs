//! The Home app's Rust half — projects.
//!
//! Home is where a session starts, and what a session starts *on* is a project.
//! So this is a thin layer over `crate::project`: it picks folders, and it turns
//! that module's `Result<ProjectSnapshot>` into the JSON-RPC shape an app's
//! frontend receives. The rules about what a project is live there, not here.
//!
//! ## Where the dialogs live, and why here
//!
//! `crate::project` never opens a dialog. It takes paths and touches the
//! filesystem, which makes it testable and makes "open this project" a thing the
//! rest of the orchestrator can do without a human at the keyboard — a command
//! line flag, a recent-projects jump list, a `.helve` file double-clicked in
//! Explorer. Choosing a folder by pointing at it is a *user interface* act, and
//! this module is Home's user interface half.
//!
//! Cancelling a picker is not an error. Every method that opens one returns the
//! unchanged snapshot when the user backs out, because a JSON-RPC error would
//! make the frontend draw a failure for something the user did on purpose.

use crate::error::AppError;
use crate::project::{self, ProjectSnapshot};
use crate::state::AppState;
use helve_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn call(app: &AppHandle, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
    match method {
        "home/state" => state(app),

        "home/new-project" => match pick(app, "Choose a folder for the new project") {
            Some(dir) => shape(project::create(app, &dir).map_err(rpc)?),
            None => state(app),
        },

        "home/open-project" => match pick(app, "Open a HELVE project") {
            Some(dir) => shape(project::open(app, &dir).map_err(rpc)?),
            None => state(app),
        },

        // Stubbed on purpose. Cloning is a git operation with progress, auth
        // prompts and a partial-checkout failure mode, and this repo already has
        // git work in flight on its own branch — the real one is built on top of
        // that rather than beside it. The method exists so the seam is visible
        // from both halves; the frontend keeps the action disabled.
        "home/clone-project" => Err(RpcError::new(
            INTERNAL_ERROR,
            "cloning is not built yet — clone the repository yourself, then use Open Project",
        )),

        "home/open-recent" => shape(project::open(app, &path_param(params.as_ref())?).map_err(rpc)?),
        "home/initialize-project" => {
            shape(project::initialize(app, &path_param(params.as_ref())?).map_err(rpc)?)
        }
        "home/forget-recent" => shape(project::forget(app, &path_param(params.as_ref())?)),
        "home/close-project" => shape(project::close(app)),

        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
}

/// Everything Home draws, in one round trip.
///
/// One method rather than one per region, because the alternative is a page that
/// renders three times as three calls land, and there is nothing here expensive
/// enough for that to buy anything.
fn state(app: &AppHandle) -> Result<Value, RpcError> {
    let mut value = shape(project::snapshot(app))?;

    // The stack's version, for the heading. All that is left of the component
    // list Home used to draw — the shell's warning badge is where stack health
    // is reported now, and saying it twice made neither one the place to look.
    // `None` before the boot scan lands, which the heading simply omits.
    let version = app.state::<AppState>().get().map(|s| s.stack_version);
    if let Some(object) = value.as_object_mut() {
        object.insert("version".to_string(), json!(version));
    }

    Ok(value)
}

fn shape(snapshot: ProjectSnapshot) -> Result<Value, RpcError> {
    serde_json::to_value(snapshot).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("the project state could not be serialized: {e}"),
        )
    })
}

/// Ask the OS for a folder. `None` means the user cancelled.
///
/// Two things here are load-bearing:
///
/// **It must not run on the main thread.** `rfd`'s synchronous picker runs its
/// own message loop, so on the main thread it would be waiting for the very
/// thread it is occupying and the app would hang with no dialog on screen.
/// `commands::app_call` moves every app call to a blocking worker — see the note
/// there — which is what makes this safe.
///
/// **The parent is set.** Without an owner window the picker is a separate
/// top-level window: it can fall behind the app, and alt-tab treats it as a
/// second application. With one it is modal to HELVE, which is what a person
/// opening a project expects. It opens where the last one did, so this passes no
/// starting directory — the OS remembers better than we would.
fn pick(app: &AppHandle, title: &str) -> Option<PathBuf> {
    let mut dialog = rfd::FileDialog::new().set_title(title);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder()
}

/// The required `path` parameter, for the methods that act on a row the frontend
/// already has in hand rather than on a folder it has to ask for.
fn path_param(params: Option<&Value>) -> Result<PathBuf, RpcError> {
    match params.and_then(|p| p.get("path")) {
        Some(Value::String(raw)) if !raw.is_empty() => Ok(PathBuf::from(raw)),
        Some(other) => Err(RpcError::new(
            INVALID_PARAMS,
            format!("path must be a non-empty string, got {other}"),
        )),
        None => Err(RpcError::new(INVALID_PARAMS, "path is required")),
    }
}

/// `AppError` carries no JSON-RPC code, so everything it can be becomes
/// `-32603`. That is honest today — every variant reachable from here is a
/// filesystem failure the user can only react to by reading the message. When
/// one of them becomes something a frontend should *branch* on, it earns its own
/// code rather than being distinguished by parsing this string.
fn rpc(error: AppError) -> RpcError {
    RpcError::new(INTERNAL_ERROR, error.to_string())
}
