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
use crate::shell_state::{EngineState, ShellSnapshot, ShellState};
use crate::state::AppState;
use crate::tool_frontend;
use crate::windows;
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

// --- shell state ------------------------------------------------------------
//
// Placement and terminal sessions are shared across every HELVE window, so they
// live in `ShellState` rather than in any window's React tree. Each of these
// mutators broadcasts `shell:state` on the way out — see `ShellState::mutate`.
//
// Every one takes the calling window's label explicitly rather than inferring
// it from a `Window` argument. The caller always knows which window it is (it
// was told on the URL), and passing it makes the drag commands honest: moving a
// terminal names a *destination*, which is not the window running the code.

/// The current shared state, for a window that has just mounted.
///
/// Tauri events have no replay buffer, so a window that subscribes to
/// `shell:state` after the last broadcast would sit empty until the next drag.
/// Same gap the splash window hit with `boot:status`, same fix: subscribe
/// first, then call this to catch up.
#[tauri::command]
pub fn shell_state(shell: State<'_, ShellState>) -> ShellSnapshot {
    shell.snapshot()
}

#[tauri::command]
pub fn set_docked_tools(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    tool_ids: Vec<String>,
) {
    shell.set_docked(&app, &label, tool_ids);
}

#[tauri::command]
pub fn set_active_tool(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    tool_id: Option<String>,
) {
    shell.set_active_tool(&app, &label, tool_id);
}

/// Which HELVE window the cursor is over, or `None` if it is over none of them.
///
/// Called by the drag layer on drop, to find out which window's panel a
/// terminal was let go over. The frontend cannot answer this for itself — see
/// `windows::at_cursor`.
#[tauri::command]
pub fn window_at_cursor(app: tauri::AppHandle) -> Option<String> {
    windows::at_cursor(&app)
}

/// Drag a tab clear of the switcher bar. The only way a tool detaches.
#[tauri::command]
pub fn detach_tool(app: tauri::AppHandle, shell: State<'_, ShellState>, tool_id: String) -> Result<()> {
    windows::detach(&app, &shell, &tool_id)
}

#[tauri::command]
pub fn create_terminal(app: tauri::AppHandle, shell: State<'_, ShellState>, label: String) -> String {
    shell.create_terminal(&app, &label)
}

#[tauri::command]
pub fn close_terminal(app: tauri::AppHandle, shell: State<'_, ShellState>, id: String) {
    shell.close_terminal(&app, &id);
}

/// Drop a terminal into another window's panel. `to_label` is the destination,
/// which may be any HELVE window including the one it is already in.
#[tauri::command]
pub fn move_terminal(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    id: String,
    to_label: String,
) {
    shell.move_terminal(&app, &id, &to_label);
}

/// Where to point a tool's iframe, or why there is nothing to point it at.
///
/// The tool window calls this once per tool it mounts. Resolution is per-tool
/// and on demand rather than part of the stack snapshot: a tool's dev server
/// can come and go while the shell is running, and a checkout can be built
/// after the shell started.
#[tauri::command]
pub fn tool_frontend(app: tauri::AppHandle, id: String) -> Result<tool_frontend::ToolFrontend> {
    tool_frontend::resolve(&app, &id)
}

/// Stubbed until the engine has something real to report. Kept as a command so
/// the seam is already the right shape — when the engine reports for itself,
/// this stops being called by the frontend and starts being called by whatever
/// supervises the process.
#[tauri::command]
pub fn set_engine_state(app: tauri::AppHandle, shell: State<'_, ShellState>, engine: EngineState) {
    shell.set_engine(&app, engine);
}
