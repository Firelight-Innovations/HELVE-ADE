//! The bridge between Rust and the web frontend.
//!
//! Every `#[tauri::command]` here becomes callable from TypeScript via
//! `invoke("name", { args })`. Arguments and return values cross the boundary as
//! JSON, which is why the types involved derive `Serialize`/`Deserialize`.
//!
//! Note the naming convention: Rust `snake_case` command names are invoked from
//! JS by that same snake_case string, but their *arguments* are converted to
//! camelCase. The typed wrappers in `src/bindings.ts` hide that asymmetry.

use crate::apps;
use crate::boot;
use crate::discovery::{self, StackSnapshot};
use crate::error::{AppError, Result};
use crate::manifest::{self, Manifest};
use crate::project;
use crate::pty::{self, PtySessions};
use crate::layout::SplitDir;
use crate::shell_state::{
    EngineState, ShellSnapshot, ShellState, SurfaceKind, WindowGeometry,
};
use crate::state::AppState;
use crate::tool_frontend;
use crate::windows;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
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
        total: boot::total_steps(),
        label: "Starting…".to_string(),
    })
}

/// A first-party app's UI has drawn its first meaningful frame.
///
/// Reported by the *shell*, not by the app: an app's frontend sends
/// `helve/painted` over transport B, and `ToolWindow` — the only thing that can
/// say which mounted frame a message came from — forwards it here with the id
/// it resolved. So an app cannot report on another app's behalf, for the same
/// reason it cannot answer another app's `invoke`.
///
/// Boot holds the splash window until every app has said this, which is what
/// makes the first frame after the splash the real Home rather than the boot
/// overlay laid over it. See `boot::await_apps`.
#[tauri::command]
pub fn app_painted(id: String) {
    boot::painted(&id);
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

/// Open a new instance of an app or tool.
///
/// The id that comes back is an *instance* id (`files-2`), not the app id that
/// went in. Everything downstream — which frame a message came from, which tab
/// to close — is keyed on it, and the app id survives only as the thing that
/// says which code to load and where to route an `invoke`.
#[tauri::command]
pub fn open_instance(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    app_id: String,
    pane_id: Option<String>,
) -> Result<String> {
    // An app ships in this binary; a tool is a checkout that may not be here.
    // The distinction decides where an `invoke` from the resulting frame is
    // answered, so it is resolved once, here, from the registry itself rather
    // than trusted from the frontend.
    let kind = if apps::is_app(&app_id) {
        SurfaceKind::App
    } else {
        SurfaceKind::Tool
    };

    let title = apps::list()
        .into_iter()
        .find(|a| a.id == app_id)
        .map(|a| a.name.to_string())
        .unwrap_or_else(|| app_id.clone());

    shell
        .open_instance(&app, &label, &app_id, kind, &title, pane_id.as_deref())
        .ok_or_else(|| AppError::UnknownTool(app_id))
}

#[tauri::command]
pub fn close_instance(app: tauri::AppHandle, shell: State<'_, ShellState>, instance_id: String) {
    shell.close_instance(&app, &instance_id);
}

/// An app naming its own tab — "Files" becoming `client.ts`, the way an editor
/// tab says what is in it.
///
/// The same shape as `set_terminal_title` and for the same reason: a title is
/// identity, identity is Rust's because a tab can be dragged into another
/// window, and this only ever *reports* — the title to render comes back around
/// through `shell:state`. The empty and no-op guards live in `ShellState`.
#[tauri::command]
pub fn set_instance_title(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    instance_id: String,
    title: String,
) {
    shell.set_instance_title(&app, &instance_id, &title);
}

#[tauri::command]
pub fn activate_instance(app: tauri::AppHandle, shell: State<'_, ShellState>, instance_id: String) {
    shell.activate_instance(&app, &instance_id);
}

/// Move a tab into a pane — reordering within one strip, or across windows.
#[tauri::command]
pub fn move_instance(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    instance_id: String,
    cluster_id: String,
    pane_id: String,
    index: Option<usize>,
) {
    shell.move_instance(&app, &instance_id, &cluster_id, &pane_id, index);
}

/// Drop a tab on a pane's edge: split there and put it in the new half.
#[tauri::command]
pub fn split_pane(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    pane_id: String,
    dir: SplitDir,
    instance_id: String,
    before: bool,
) {
    shell.split_with_instance(&app, &pane_id, dir, &instance_id, before);
}

/// What a divider drag commits on release. Weights, not pixels — see `layout`.
#[tauri::command]
pub fn set_pane_sizes(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    split_id: String,
    sizes: Vec<f32>,
) {
    shell.set_pane_sizes(&app, &split_id, sizes);
}

// --- clusters ---------------------------------------------------------------

#[tauri::command]
pub fn add_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    name: String,
) -> Option<String> {
    shell.add_cluster(&app, &label, &name)
}

#[tauri::command]
pub fn set_active_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    cluster_id: Option<String>,
) {
    shell.set_active_cluster(&app, &label, cluster_id);
}

#[tauri::command]
pub fn rename_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    cluster_id: String,
    name: String,
) {
    shell.rename_cluster(&app, &cluster_id, &name);
}

/// Close a cluster and everything in it.
///
/// The ptys are killed here rather than left to be tidied later. `close_cluster`
/// hands back the session ids precisely so they cannot be forgotten: a shell
/// still running with no tab anywhere on screen is a process nobody can see,
/// stop, or find out about.
#[tauri::command]
pub fn close_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    ptys: State<'_, PtySessions>,
    cluster_id: String,
) {
    let (_instances, terminals) = shell.close_cluster(&app, &cluster_id);
    for id in terminals {
        ptys.close(&id);
    }
}

// --- windows ----------------------------------------------------------------

/// Which HELVE window the cursor is over, or `None` if it is over none of them.
///
/// Called by the drag layer on drop, to find out which window a tab was let go
/// over. The frontend cannot answer this for itself — see `windows::at_cursor`.
#[tauri::command]
pub fn window_at_cursor(app: tauri::AppHandle) -> Option<String> {
    windows::at_cursor(&app)
}

/// Drag a tab clear of its window. The gesture that makes a second window.
#[tauri::command]
pub fn detach_instance(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    instance_id: String,
) -> Result<()> {
    windows::detach(&app, &shell, &instance_id)
}

/// A window reporting where it now is, after a move or a resize.
///
/// Deliberately does not broadcast: this fires continuously while a window is
/// being dragged, and telling every other window about each frame of that would
/// be a storm none of them need. See `ShellState::set_geometry`.
#[tauri::command]
pub fn set_window_geometry(
    shell: State<'_, ShellState>,
    label: String,
    geometry: WindowGeometry,
) {
    shell.set_geometry(&label, geometry);
}

/// Close a window on purpose.
///
/// The title bar's × goes through here rather than calling `close()` directly,
/// and that indirection is the entire mechanism separating a deliberate close
/// from a shutdown. `WindowEvent::Destroyed` cannot tell them apart, and at
/// shutdown it fires for every window — so without this announcement, closing
/// HELVE would fold every window into `main` on the way out and save that as
/// the layout to restore. See `ShellState::closing`.
#[tauri::command]
pub fn close_window(app: tauri::AppHandle, shell: State<'_, ShellState>, label: String) {
    shell.mark_closing(&label);
    // The geometry updates above are recorded but never written; this is the
    // last moment they can be.
    shell.flush(&app);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
}

/// Open a terminal: a session in the shared state, and a real shell behind it.
///
/// Both halves, in that order, because the session id is what names the pty.
/// If the shell cannot be spawned the session is rolled back rather than left
/// on screen as a tab with nothing behind it.
///
/// `cols`/`rows` are the emulator's first guess. It corrects them the moment it
/// has measured itself, so being briefly wrong here is harmless — but being
/// *absent* is not, since a pty must be created with some size and a program
/// that starts before the first resize would draw to whatever we picked.
#[tauri::command]
pub fn create_terminal(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    ptys: State<'_, PtySessions>,
    label: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    open_terminal(&app, &shell, &ptys, &label, cols.unwrap_or(80), rows.unwrap_or(24))
}

/// The one path that opens a terminal, shared by the command above and by the
/// launch terminal `lib.rs` opens at setup.
///
/// The ordering is the point: claim an id, spawn the shell, and only publish the
/// session once there is something behind it. A spawn that fails leaves nothing
/// on screen, so there is no state to roll back and no window that briefly saw a
/// tab that never worked.
pub fn open_terminal(
    app: &tauri::AppHandle,
    shell: &ShellState,
    ptys: &PtySessions,
    label: &str,
    cols: u16,
    rows: u16,
) -> Result<String> {
    // A terminal belongs to a cluster, not to a window — the panel is the
    // cluster's, so a terminal opened while looking at the `auth` cluster
    // stays with `auth` when you switch to `billing` and back. The caller
    // knows which *window* asked, which is one lookup away from the answer
    // and the only thing a frontend can honestly report about itself.
    let cluster_id = shell
        .active_cluster_of(label)
        .ok_or_else(|| AppError::Pty {
            id: label.to_string(),
            reason: "that window is not showing a cluster to open a terminal in".to_string(),
        })?;

    let (id, ordinal) = shell.claim_terminal_id();
    let name = ptys.open(app, &id, &terminal_cwd(app), cols, rows)?;

    // "pwsh", then "pwsh 2", "pwsh 3" — the first of a kind goes unnumbered,
    // which is what the handoff's panel draws and what every terminal
    // application does.
    let title = if ordinal <= 1 {
        name
    } else {
        format!("{name} {ordinal}")
    };

    shell.add_terminal(app, &id, &title, &cluster_id);
    Ok(id)
}

/// Where a new terminal opens: the open project, or the stack root when nothing
/// is open.
///
/// The project comes first because a terminal is opened to do something to the
/// thing you are working on, and until there is a project that thing is the
/// stack itself. Not the process's working directory, which `tauri dev` sets to
/// `src-tauri/` — nobody's idea of where a terminal should start. The last two
/// fallbacks only matter when there is no manifest at all, which is a broken
/// install rather than a state worth failing a terminal over.
fn terminal_cwd(app: &tauri::AppHandle) -> PathBuf {
    project::open_path(app)
        .or_else(|| {
            manifest::locate(app)
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
        })
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

#[tauri::command]
pub fn close_terminal(app: tauri::AppHandle, shell: State<'_, ShellState>, ptys: State<'_, PtySessions>, id: String) {
    ptys.close(&id);
    shell.close_terminal(&app, &id);
}

/// Split a terminal: open a second pty and fold it into `id`'s tab.
///
/// Reuses `open_terminal` for the spawn itself — there is exactly one path
/// that opens a pty, splitting included. What this adds is the second step:
/// putting the new session in `id`'s group, minting one if `id` didn't have
/// one yet. That bookkeeping is `ShellState::group_with`'s, not this
/// function's, for the same reason grouping lives on `TerminalSession` at
/// all — see the doc comment there.
///
/// The new pty opens beside the one it is splitting from, in that session's
/// own cluster, read off `ShellState` rather than taken as an argument — the
/// caller already told the backend that once, when the session was created or
/// last moved, and asking it to repeat itself here would just be a second place
/// for the two to disagree.
#[tauri::command]
pub fn split_terminal(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    ptys: State<'_, PtySessions>,
    id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    let cluster = shell.cluster_of_terminal(&id).ok_or_else(|| AppError::Pty {
        id: id.clone(),
        reason: "no such terminal to split".to_string(),
    })?;
    let label = shell.window_of_cluster(&cluster).ok_or_else(|| AppError::Pty {
        id: id.clone(),
        reason: "that terminal's cluster is not in any window".to_string(),
    })?;

    let new_id = open_terminal(&app, &shell, &ptys, &label, cols.unwrap_or(80), rows.unwrap_or(24))?;
    shell.group_with(&app, &id, &new_id);
    Ok(new_id)
}

/// A keystroke on its way to the shell. High-traffic, so it returns nothing and
/// reports nothing — a write to a dead pty is not an error worth a round trip,
/// and `pty:exit` already told the frontend the session ended.
#[tauri::command]
pub fn terminal_write(ptys: State<'_, PtySessions>, id: String, data: String) {
    ptys.write(&id, &data);
}

/// An emulator has mounted and is listening. Answers with everything the shell
/// has said so far and where the live stream picks up.
///
/// Called once per emulator, right after its listener is registered, and it is
/// what makes a terminal work at all rather than an optimisation. A pty starts
/// talking the instant it is spawned — on Windows, by asking the terminal where
/// the cursor is and then waiting for the answer before printing anything else
/// — and Tauri events have no replay. Without this call, the launch terminal's
/// opening question is emitted into an empty room and the shell waits for a
/// reply that can never come.
#[tauri::command]
pub fn terminal_attach(ptys: State<'_, PtySessions>, id: String) -> Option<pty::Attachment> {
    ptys.attach(&id)
}

/// The emulator has measured itself. See `PtySessions::resize` for why this is
/// not cosmetic.
#[tauri::command]
pub fn terminal_resize(ptys: State<'_, PtySessions>, id: String, cols: u16, rows: u16) {
    ptys.resize(&id, cols, rows);
}

/// Is this terminal running something? Asked once, when its close button is
/// clicked. `None` means the shell is at a prompt and the close needs no
/// confirming.
#[tauri::command]
pub fn terminal_busy(ptys: State<'_, PtySessions>, id: String) -> Option<pty::Busy> {
    pty::busy(&ptys, &id)
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
    // Named by *window*, because that is the only thing the drag layer can
    // find out — `window_at_cursor` hit-tests screen rectangles and a cluster
    // has none. Which cluster inside it is this side's to answer: the one that
    // window is showing, since that is the panel the terminal was dropped on.
    let Some(cluster) = shell.active_cluster_of(&to_label) else {
        return;
    };
    shell.move_terminal(&app, &id, &cluster);
}

/// Which terminal a cluster's panel is showing.
#[tauri::command]
pub fn set_active_terminal(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    cluster_id: String,
    id: Option<String>,
) {
    shell.set_active_terminal(&app, &cluster_id, id);
}

/// A terminal's own program set its title (an OSC `0`/`2` escape sequence),
/// and the emulator that saw it is reporting up.
///
/// Just a thin forward to `ShellState::set_terminal_title` — that's where the
/// empty/no-op guards and the path-shortening live, both explained there.
/// This command exists purely so the frontend has something to `invoke`.
#[tauri::command]
pub fn set_terminal_title(app: tauri::AppHandle, shell: State<'_, ShellState>, id: String, title: String) {
    shell.set_terminal_title(&app, &id, &title);
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

/// Every first-party app this build ships, for the switcher bar.
///
/// Not part of the stack snapshot, and not refreshable: apps are compiled in
/// (see `apps::REGISTRY`), so the answer cannot change while the app is running
/// the way a tool's checkout can. The frontend asks once.
#[tauri::command]
pub fn list_apps() -> Vec<apps::AppInfo> {
    apps::list()
}

/// One `invoke` from an app's frontend, routed to that app's Rust half.
///
/// This is the shell end of transport B for apps. The iframe posts a `request`
/// message, `ToolWindow` forwards it here, and the reply goes back as a
/// `response` — so an app's UI calls `invoke("files/list")` through
/// `@helve/bridge` exactly as a tool's UI would, and never learns that its host
/// answered in-process rather than over a pipe.
///
/// The error type is `RpcError`, not this crate's `AppError`: it carries the
/// JSON-RPC `code` the bridge turns back into a `HelveRpcError`, which is what
/// lets a frontend tell "no such method" from "that file isn't text" without
/// parsing an error string.
///
/// ## Why this runs on a blocking thread
///
/// A synchronous `#[tauri::command]` runs on the **main thread**, and an app's
/// Rust half does things that must not happen there. `home/open-project` opens a
/// native folder picker, which needs the main thread to pump events while it is
/// up — called from the main thread it would be waiting for a thread it is
/// itself occupying, and the app would hang with a dialog that never appears.
/// `files/read` is a milder case of the same thing: a quarter-megabyte read off
/// a slow disk freezes every window for as long as it takes.
///
/// So the whole dispatch moves to a blocking worker and this command awaits it.
/// The cost is one thread hop per `invoke`; the property bought is that an app's
/// Rust half can do ordinary blocking work without having to know it is running
/// somewhere that forbids it.
#[tauri::command]
pub async fn app_call(
    app: tauri::AppHandle,
    id: String,
    method: String,
    params: Option<serde_json::Value>,
) -> std::result::Result<serde_json::Value, helve_rpc::RpcError> {
    tauri::async_runtime::spawn_blocking(move || apps::call(&app, &id, &method, params))
        .await
        // The worker itself failed — it panicked, or the runtime is shutting
        // down. Neither is something the app's own error vocabulary describes,
        // so it becomes a plain internal error rather than being unwrapped into
        // a panic that would take the main thread with it.
        .unwrap_or_else(|e| {
            Err(helve_rpc::RpcError::new(
                helve_rpc::INTERNAL_ERROR,
                format!("the app call did not complete: {e}"),
            ))
        })
}

/// Stubbed until the engine has something real to report. Kept as a command so
/// the seam is already the right shape — when the engine reports for itself,
/// this stops being called by the frontend and starts being called by whatever
/// supervises the process.
#[tauri::command]
pub fn set_engine_state(app: tauri::AppHandle, shell: State<'_, ShellState>, engine: EngineState) {
    shell.set_engine(&app, engine);
}
