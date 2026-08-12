//! The bridge between Rust and the web frontend.
//!
//! Every `#[tauri::command]` here becomes callable from TypeScript via
//! `invoke("name", { args })`. Arguments and return values cross the boundary as
//! JSON, which is why the types involved derive `Serialize`/`Deserialize`.
//!
//! Note the naming convention: Rust `snake_case` command names are invoked from
//! JS by that same snake_case string, but their *arguments* are converted to
//! camelCase. The typed wrappers in `src/bindings.ts` hide that asymmetry.

use crate::boot;
use crate::discovery::{self, StackSnapshot};
use crate::error::{AppError, Result};
use crate::manifest::{self, Manifest};
use crate::state::AppState;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

/// Read helve.toml, resolve every declared tool against the filesystem, cache
/// the result, and hand it to the UI.
///
/// Safe to call repeatedly — it always re-reads from disk, so this doubles as
/// the "refresh" action.
#[tauri::command]
pub fn load_stack(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<StackSnapshot> {
    let path = manifest::locate(&app)?;
    let manifest = Manifest::load(&path)?;
    let snapshot = discovery::resolve(&path, &manifest)?;

    state.store(snapshot.clone());
    Ok(snapshot)
}

/// The last snapshot without touching the disk. `None` before the first load.
#[tauri::command]
pub fn cached_stack(state: State<'_, AppState>) -> Option<StackSnapshot> {
    state.get()
}

/// Show a tool's local checkout in the OS file manager.
#[tauri::command]
pub fn reveal_tool(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    let snapshot = state
        .get()
        .ok_or_else(|| AppError::UnknownTool(id.clone()))?;

    let tool = snapshot
        .tools
        .iter()
        .find(|t| t.spec.id == id)
        .ok_or_else(|| AppError::UnknownTool(id.clone()))?;

    app.opener()
        .reveal_item_in_dir(&tool.checkout_path)
        .map_err(|source| AppError::Reveal { id, source })
}

/// Show the main window and close the splash.
///
/// Called by the splash's own frontend once it has something to show for
/// (`boot:status` reaching `Ready` or `Failed`), and also by `boot::start`'s
/// watchdog if that never happens. This just forwards to `boot::finish`,
/// which is where the idempotency lives — see its doc comment. No `Result`
/// here because there is nothing a caller could usefully do with a failure
/// to show or close a window; `boot::finish` already swallows those.
#[tauri::command]
pub fn finish_boot(app: tauri::AppHandle) {
    boot::finish(&app);
}

/// The latest boot status, fetched directly rather than waited for over an
/// event.
///
/// Exists because `boot:status` events aren't replayable (see the comment on
/// `AppState::boot_status`): the splash window's own startup — webview init,
/// React mount, the effect that calls `listen` — is routinely slower than
/// `boot::start`'s filesystem work, so the frontend often mounts *after*
/// boot already reported something. This command is how it catches up.
///
/// Returns a concrete `BootStatus` rather than `Option<BootStatus>`. Before
/// `boot::start` has stored anything, `AppState::boot_status` is `None`; this
/// is the one place that turns that into the same `Working` shape step 1
/// would have reported anyway, so the frontend always deals in one
/// non-nullable type instead of adding a null check for a gap that only
/// exists for a few microseconds at process start.
#[tauri::command]
pub fn boot_status(state: State<'_, AppState>) -> boot::BootStatus {
    state.boot_status().unwrap_or(boot::BootStatus::Working {
        step: 0,
        total: boot::STEPS,
        label: "Starting…".to_string(),
    })
}
