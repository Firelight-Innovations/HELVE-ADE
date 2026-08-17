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
use crate::layout::SplitDir;
use crate::manifest::{self, Manifest};
use crate::presets;
use crate::project;
use crate::pty::{self, PtySessions};
use crate::shell_state::{EngineState, ShellSnapshot, ShellState, SurfaceKind, WindowGeometry};
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
///
/// `dir` is the axis the caller measured `pane_id` along, and it is what makes
/// this open into a pane of its own rather than a tab beside whatever was
/// already there. It comes from the frontend because it is a fact about pixels
/// and the tree stores fractions — `PaneNode::open_into` has the whole argument,
/// and every rule about when the split is refused.
#[tauri::command]
pub fn open_instance(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    app_id: String,
    pane_id: Option<String>,
    dir: Option<SplitDir>,
) -> Result<String> {
    // A terminal is offered in the same menu as an app now (see
    // `apps::openables`) and is not one: it has no frontend to mount and no
    // `Dispatch` to route an `invoke` to. Left to fall through, it would resolve
    // as a *tool* below — `is_app` is false for it — and mint a surface pointing
    // at a checkout that does not exist, which draws as a frame that never
    // loads. Refused by name instead, and pointed at the command that does the
    // right thing, because a menu with both kinds in it is exactly where this
    // mistake gets made.
    if app_id == apps::TERMINAL_ID {
        return Err(AppError::Pty {
            id: app_id,
            reason: "a terminal is not an app surface — open one with `open_terminal_in_pane`"
                .to_string(),
        });
    }

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
        .open_instance(&app, &label, &app_id, kind, &title, pane_id.as_deref(), dir)
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
///
/// Reports a move that landed nowhere, for the reason `split_pane` gives below.
#[tauri::command]
pub fn move_instance(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    instance_id: String,
    cluster_id: String,
    pane_id: String,
    index: Option<usize>,
) -> Result<()> {
    match shell.move_instance(&app, &instance_id, &cluster_id, &pane_id, index) {
        true => Ok(()),
        false => Err(AppError::UnknownTool(pane_id)),
    }
}

/// Drop a tab on a pane's edge: split there and put it in the new half.
///
/// Both of these used to return `()`, throwing away a boolean that already said
/// whether anything had happened. That is how "dropping a tab on a pane's edge
/// does nothing" stayed a mystery through a whole round of investigation: the
/// call succeeded, the promise resolved, and every layer above was entitled to
/// assume the drop had worked. An `Err` here reaches the drag layer's `attempt`,
/// which puts it in the console with the pane it could not find — which is the
/// one fact needed to tell a stale drop target apart from a broken one.
#[tauri::command]
pub fn split_pane(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    pane_id: String,
    dir: SplitDir,
    instance_id: String,
    before: bool,
) -> Result<()> {
    match shell.split_with_instance(&app, &pane_id, dir, &instance_id, before) {
        true => Ok(()),
        false => Err(AppError::UnknownTool(pane_id)),
    }
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
//
// Every command in this section finishes with `project::retitle`, and it is the
// same reason each time: the OS window title names the project of the cluster
// its window is *showing*, so anything that changes which cluster that is —
// adding one, closing one, clicking a chip, dragging one to another monitor —
// changes the title without touching a single project. `project::open` and
// `project::close` retitle for the other half of it, when the cluster stays and
// the project under it moves.

/// Add a cluster, and open Home in it.
///
/// Home rather than nothing, for the same reason `seed_first_run` opens it on a
/// first launch: a cluster is where a piece of work starts, and Home is the one
/// surface that can start one — it is where a project is opened. An empty
/// cluster would hand you a blank window and the Apps menu, which is a puzzle
/// rather than a starting point.
///
/// Composed here rather than folded into `ShellState::add_cluster`, which stays
/// a primitive that does exactly what its name says. That costs a second
/// broadcast and a second write of `layout.json`; both are cheap, and the
/// alternative is a state method that quietly opens a surface nobody asked it
/// for. `open_instance` needs no cluster id because `add_cluster` has already
/// made this one active.
///
/// The new cluster has **no project**, and Home is what that gets you: the
/// pick-a-project state, which is the state a session starts on. Deliberately
/// not the previous cluster's project and deliberately not a folder picker
/// raised unbidden — a new cluster is a new piece of work, and guessing which
/// one would be wrong about half the time while a picker nobody asked for is
/// wrong about all of it.
#[tauri::command]
pub fn add_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    name: String,
) -> Option<String> {
    let cluster_id = shell.add_cluster(&app, &label, &name)?;
    // No direction, so no split: the cluster's one pane is empty and Home fills
    // it. `open_into` would refuse a split here anyway — an empty pane is the
    // first of the two cases it declines — but there is also nothing on screen
    // to have measured, and passing an axis nobody measured would be a lie.
    shell.open_instance(&app, &label, "home", SurfaceKind::App, "Home", None, None);
    project::retitle(&app);
    Some(cluster_id)
}

#[tauri::command]
pub fn set_active_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    cluster_id: Option<String>,
) {
    shell.set_active_cluster(&app, &label, cluster_id);
    project::retitle(&app);
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

/// Close a cluster and everything in it, including the last one in a window.
///
/// The ptys are killed here rather than left to be tidied later. `close_cluster`
/// hands back the session ids precisely so they cannot be forgotten: a shell
/// still running with no tab anywhere on screen is a process nobody can see,
/// stop, or find out about. Only the ones that were *in its tree* come back —
/// the panel's terminals are the window's and outlive every cluster in it,
/// which is what keeps the panel usable after the last cluster goes.
///
/// Closing the last one leaves a window with no clusters, which is a legal
/// state: the app area draws an empty state and the panel keeps working.
/// `detach_cluster` below can leave a window in the same state, and no longer
/// refuses to — see `move_cluster_pure`.
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
    project::retitle(&app);
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

/// File > New Window: an empty window with a cluster of its own.
///
/// Distinct from `detach_instance`, which makes a window by *moving* a surface
/// into it. This takes nothing from the window that asked, which is what the
/// menu item has always claimed and could not do while a window's label was
/// derived from the tool inside it — there was no label a second empty window
/// could have had.
#[tauri::command]
pub fn new_window(app: tauri::AppHandle, shell: State<'_, ShellState>) -> Result<()> {
    let label = shell.claim_window_label();
    // Bookkeeping first, window second, the same order `detach` uses: a window
    // on screen with no entry in the shared state would render nothing and have
    // no way to be given anything.
    shell.add_window(&app, &label);
    // And Home in the cluster that came with it, for the reason `add_cluster`
    // above gives. A new window is a new cluster; "empty" should not mean two
    // different things depending on which menu item made it. No direction, for
    // the reason `add_cluster` gives: the window it would be measured in does
    // not exist yet.
    shell.open_instance(&app, &label, "home", SurfaceKind::App, "Home", None, None);
    let created = windows::create(&app, &label, None, true);
    // After the window exists, not before: `retitle` sets titles on windows it
    // can look up, and one that has not been built yet is not one of them.
    project::retitle(&app);
    created
}

/// Drag a whole cluster clear of its window — the multi-monitor gesture.
///
/// `to_label` is where it lands. `Some(label)` moves it into a HELVE window that
/// is already open, which is what a release over another window means; `None`
/// gives it a window of its own.
///
/// That first case is deliberately built here where the same thing for a single
/// tab was deliberately left out (see the `detach` case in
/// `src/shell/drag/useDrag.tsx`). The reason a tab could not do it is that
/// `window_at_cursor` answers with a label and cannot say *where inside* the
/// window the cursor was, so a pane would have to be guessed. A cluster is not
/// dropped into a pane: it is appended to the window's cluster list, and the
/// label is the whole of the address. There is nothing left to guess, so the
/// two gestures differing is not an inconsistency to be tidied up later.
///
/// A `to_label` that names no window in the shared state falls back to making
/// one, rather than being an error: the only caller passes what
/// `window_at_cursor` just returned, and a window that has since closed should
/// still leave the cluster somewhere on screen.
///
/// The `Err` below therefore says one thing only — no window holds that cluster,
/// so it was closed between the release and this call. It used to also carry
/// "that was the last cluster in its window", a refusal that is gone; see
/// `move_cluster_pure`. The frontend reports whatever comes back rather than
/// dropping it, because a detach that quietly does nothing is the single hardest
/// failure in this gesture to diagnose from the outside.
#[tauri::command]
pub fn detach_cluster(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    cluster_id: String,
    to_label: Option<String>,
) -> Result<()> {
    let moved = match to_label.filter(|label| shell.has_window(label)) {
        // Into a window that is already open: bookkeeping only, since the
        // window it is going to is on screen already.
        Some(label) => match shell.move_cluster(&app, &cluster_id, &label) {
            true => Ok(()),
            false => Err(AppError::UnknownTool(cluster_id)),
        },
        None => windows::detach_cluster(&app, &shell, &cluster_id),
    };

    // Two windows' titles can change here at once: the one the cluster left now
    // shows a neighbour, and the one it arrived in shows it. `retitle` walks
    // every window, so both are correct without either being named.
    project::retitle(&app);
    moved
}

/// Drag a tab clear of its window. The gesture that makes a second window.
#[tauri::command]
pub fn detach_instance(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    instance_id: String,
) -> Result<()> {
    let detached = windows::detach(&app, &shell, &instance_id);
    // The new window's cluster inherits the project the surface was already
    // working in (see `ShellState::detach_instance`), so it has a title to take.
    project::retitle(&app);
    detached
}

/// A window reporting where it now is, after a move or a resize.
///
/// Deliberately does not broadcast: this fires continuously while a window is
/// being dragged, and telling every other window about each frame of that would
/// be a storm none of them need. See `ShellState::set_geometry`.
#[tauri::command]
pub fn set_window_geometry(shell: State<'_, ShellState>, label: String, geometry: WindowGeometry) {
    shell.set_geometry(&label, geometry);
}

/// Close a window on purpose.
///
/// Just asks the OS to close it. That used to be enough of a lie to build a
/// whole mechanism on — the title bar's × was the *only* path that announced
/// a close as deliberate before doing it, so this command used to mark the
/// label closing and reclaim its clusters itself, right here. The trouble is
/// this is not the only way a window closes: Alt+F4, the taskbar's "Close
/// window", and a graceful OS shutdown all ask a window to close without ever
/// calling this command, and none of them were reclaiming anything, which
/// reproduced the exact "closed window comes back" bug this file's history is
/// about, just by a route the command could not see.
///
/// `WebviewWindow::close` documents the fix: it "emits `CloseRequested` first
/// like a user-initiated close request", and that event fires identically no
/// matter who asked — this command, Alt+F4, or the OS. So the bookkeeping
/// moved to `windows::request_close`, which runs from `WindowEvent::
/// CloseRequested` in `lib.rs`'s `on_window_event`, and now covers all of
/// them by construction instead of by whichever one remembered to ask
/// nicely. This command is left only because the frontend needs some command
/// to call.
#[tauri::command]
pub fn close_window(app: tauri::AppHandle, label: String) {
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
    open_terminal(
        &app,
        &shell,
        &ptys,
        &label,
        cols.unwrap_or(80),
        rows.unwrap_or(24),
    )
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
    let (id, title) = spawn_terminal(app, shell, ptys, label, cols, rows)?;
    shell.add_terminal(app, &id, &title, label);
    Ok(id)
}

/// Everything before a session is published: claim an id, spawn the shell, and
/// work out what the tab is called.
///
/// Split out from [`open_terminal`] so that a terminal destined for a *pane* can
/// be published straight into the tree in one mutation, rather than appearing in
/// the panel and being moved out of it a broadcast later — see
/// `ShellState::add_terminal_in_pane` for what that intermediate state looks
/// like on screen. The spawn itself is shared rather than repeated: there is one
/// thing in this application that starts a shell, and neither publishing path is
/// a second one.
fn spawn_terminal(
    app: &tauri::AppHandle,
    shell: &ShellState,
    ptys: &PtySessions,
    label: &str,
    cols: u16,
    rows: u16,
) -> Result<(String, String)> {
    // A terminal belongs to the window, not to whichever cluster that window
    // happened to be showing — the panel is the window's, so a terminal opened
    // while looking at `auth` is still there when you switch to `billing`. That
    // is what makes it useful for work that spans clusters: a shell on one
    // worktree while the layout in front of it is about another.
    //
    // Checked rather than assumed, because a label naming no window would put a
    // live shell behind a tab no panel draws. It is the window that is checked
    // even for a terminal headed into a pane: the pty's working directory and
    // its `window_label` are both the window's, whichever half of the shell
    // ends up drawing it.
    if !shell.has_window(label) {
        return Err(AppError::Pty {
            id: label.to_string(),
            reason: "no such window to open a terminal in".to_string(),
        });
    }

    let (id, ordinal) = shell.claim_terminal_id();
    let name = ptys.open(app, &id, &terminal_cwd(app, label), cols, rows)?;

    // "pwsh", then "pwsh 2", "pwsh 3" — the first of a kind goes unnumbered,
    // which is what the handoff's panel draws and what every terminal
    // application does.
    let title = if ordinal <= 1 {
        name
    } else {
        format!("{name} {ordinal}")
    };

    Ok((id, title))
}

/// Open a terminal **into a pane of the active cluster**, rather than into the
/// window's panel.
///
/// ## There are two ways to make a terminal now, and it is not a contradiction
///
/// The panel's own `+` still makes a terminal in the *window's* panel, and that
/// is still the default and still right: a panel terminal outlives every cluster
/// switch, which is the whole reason it belongs to the window (see
/// `shell_state`'s module doc, and `TerminalSession::window_label`). A shell
/// watching one worktree while the layout in front of it is about another has
/// nowhere else to live.
///
/// This is the other one: a terminal that is *part of an arrangement* — the
/// right-hand pane of "Files & Terminal", or whatever someone drags there by
/// hand. It belongs to the cluster because it is drawn inside it, and it closes
/// with it.
///
/// That is VS Code's terminal panel against a terminal in the editor area, and
/// it reads as a contradiction only until you notice the two answer different
/// questions: *what am I watching* against *what am I working in*. Both entry
/// points had to keep working, and both do.
///
/// ## Why it is not a third spawn path
///
/// A terminal in a pane *is* a session whose id appears in a tree — there is no
/// second representation of one, by design, so that a terminal can never draw in
/// two places at once. So the shell is spawned the one way shells are spawned
/// (`spawn_terminal`, shared with the panel's route), and the session is
/// published with its id already in the tree. Putting an id in a tree is exactly
/// what dragging a terminal's tab into a pane does; this just does it at birth.
///
/// It is published in one step rather than opened-then-moved because the
/// two-step version has a visible cost — see `ShellState::add_terminal_in_pane`,
/// which is where that is written down.
#[allow(clippy::too_many_arguments)]
fn open_terminal_into_pane(
    app: &tauri::AppHandle,
    shell: &ShellState,
    ptys: &PtySessions,
    label: &str,
    cluster_id: &str,
    pane_id: &str,
    index: Option<usize>,
    dir: Option<SplitDir>,
) -> Result<String> {
    // 80×24 is the same placeholder the panel's route uses. A pty must be
    // created with some size, and the emulator corrects it the moment it has
    // measured the pane it landed in.
    let (id, title) = spawn_terminal(app, shell, ptys, label, 80, 24)?;
    shell.add_terminal_in_pane(app, &id, &title, label, cluster_id, pane_id, index, dir);
    Ok(id)
}

/// The Apps menu's Terminal row, and the switcher `+`'s.
///
/// `pane_id` is the pane the open is relative to; `None` means the active
/// cluster's first pane, which is the same forgiveness `open_instance` shows and
/// for the same reason — a caller with no opinion should not have to invent one.
///
/// `dir` gets the terminal a pane of its own, exactly as it does for an app.
/// Terminal is a row in the same Apps menu as the apps, so a menu where one row
/// splits and another stacks would be two products in one list.
#[tauri::command]
pub fn open_terminal_in_pane(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    ptys: State<'_, PtySessions>,
    label: String,
    pane_id: Option<String>,
    dir: Option<SplitDir>,
) -> Result<String> {
    let (cluster_id, pane) = shell
        .active_pane(&label, pane_id.as_deref())
        .ok_or(AppError::NoCluster("open a terminal in"))?;

    open_terminal_into_pane(&app, &shell, &ptys, &label, &cluster_id, &pane, None, dir)
}

/// Where a new terminal opens: the project of whatever cluster `label`'s window
/// is showing, or the stack root when that cluster has none.
///
/// The project comes first because a terminal is opened to do something to the
/// thing you are working on, and until there is a project that thing is the
/// stack itself. Not the process's working directory, which `tauri dev` sets to
/// `src-tauri/` — nobody's idea of where a terminal should start. The last two
/// fallbacks only matter when there is no manifest at all, which is a broken
/// install rather than a state worth failing a terminal over.
///
/// **Resolved from the window, and only at this moment.** A terminal belongs to
/// a window's panel rather than to any cluster (see `shell_state`'s module doc)
/// precisely so it survives cluster switches — so its working directory is a
/// snapshot of where the window was pointed when it opened, not a subscription.
/// A shell that chased the active cluster would `cd` under the user's feet
/// every time they clicked a chip, which is the opposite of what a panel
/// terminal is for.
fn terminal_cwd(app: &tauri::AppHandle, label: &str) -> PathBuf {
    project::window_path(app, label)
        .or_else(|| {
            manifest::locate(app)
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
        })
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

#[tauri::command]
pub fn close_terminal(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    ptys: State<'_, PtySessions>,
    id: String,
) {
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
/// own window, read off `ShellState` rather than taken as an argument — the
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
    let label = shell.window_of_terminal(&id).ok_or_else(|| AppError::Pty {
        id: id.clone(),
        reason: "no such terminal to split".to_string(),
    })?;

    let new_id = open_terminal(
        &app,
        &shell,
        &ptys,
        &label,
        cols.unwrap_or(80),
        rows.unwrap_or(24),
    )?;
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
    // Named by *window*, which is both what the drag layer can find out —
    // `window_at_cursor` hit-tests screen rectangles — and what a panel now
    // belongs to. No lookup in between: the label is the answer.
    shell.move_terminal(&app, &id, &to_label);
}

/// Which terminal a window's panel is showing.
#[tauri::command]
pub fn set_active_terminal(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    id: Option<String>,
) {
    shell.set_active_terminal(&app, &label, id);
}

/// A terminal's own program set its title (an OSC `0`/`2` escape sequence),
/// and the emulator that saw it is reporting up.
///
/// Just a thin forward to `ShellState::set_terminal_title` — that's where the
/// empty/no-op guards and the path-shortening live, both explained there.
/// This command exists purely so the frontend has something to `invoke`.
#[tauri::command]
pub fn set_terminal_title(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    id: String,
    title: String,
) {
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
///
/// **This is the list of things with a frontend**, and it is what the shell
/// resolves a mountable URL from. It is *not* the Apps menu's list — see
/// `list_openables`, which is the union of this and a terminal.
#[tauri::command]
pub fn list_apps() -> Vec<apps::AppInfo> {
    apps::list()
}

/// Everything the Apps menu offers: every app, then a terminal.
///
/// A second command rather than a wider `list_apps`, because the two answer
/// different questions and only one of them has a URL in it. `apps::openables`
/// carries the full reasoning; the short version is that a terminal has no
/// frontend, and an `AppInfo` with an empty `url` would put a blank iframe
/// behind every terminal — `state/toolFrontend.ts` resolves a mountable URL
/// straight off the app list, so an entry in it is a promise there is something
/// to mount.
///
/// Asked once per window, like `list_apps` and for the same reason: both lists
/// are compiled in and cannot change while the process runs.
#[tauri::command]
pub fn list_openables() -> Vec<apps::Openable> {
    apps::openables()
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
///
/// ## Why it takes an instance id
///
/// `id` names the app — the code that answers. `instance_id` names the surface
/// that asked, and it is what decides *which project* the answer is about now
/// that a project belongs to a cluster: Rust resolves the instance to the
/// cluster whose pane tree holds it, and that cluster to its project (see
/// [`apps::CallContext`]). Without it two Files in two clusters would be
/// indistinguishable here and both would root at whichever project answered
/// first.
///
/// It is `Option` because not every caller has one and pretending otherwise
/// would mean inventing one. The shell's own File > Open… is a title-bar menu
/// item with no frame behind it; it passes `cluster_id` instead, which is the
/// same question answered from the other end. A call with neither gets a
/// context with no cluster and no project, which every app already has to
/// handle — it is the same state as a cluster nobody has opened anything in.
#[tauri::command]
pub async fn app_call(
    app: tauri::AppHandle,
    id: String,
    instance_id: Option<String>,
    cluster_id: Option<String>,
    method: String,
    params: Option<serde_json::Value>,
) -> std::result::Result<serde_json::Value, helve_rpc::RpcError> {
    tauri::async_runtime::spawn_blocking(move || {
        // Resolved on the worker rather than before the hop, so the lookup sees
        // the layout as it is when the call runs. A context read on the main
        // thread and then carried across could name a cluster that closed while
        // the call was queued.
        let context =
            apps::CallContext::resolve(&app, instance_id.as_deref(), cluster_id.as_deref());
        apps::call(&app, &context, &id, &method, params)
    })
    .await
    // The worker itself failed — it panicked, or the runtime is shutting down.
    // Neither is something the app's own error vocabulary describes, so it
    // becomes a plain internal error rather than being unwrapped into a panic
    // that would take the main thread with it.
    .unwrap_or_else(|e| {
        Err(helve_rpc::RpcError::new(
            helve_rpc::INTERNAL_ERROR,
            format!("the app call did not complete: {e}"),
        ))
    })
}

/// One cluster's project, for the title bar.
///
/// The shell's own read, where `home/state` used to be borrowed for it. Home's
/// method answers the *calling surface's* cluster, which is exactly the wrong
/// scope for a title bar: the bar names whichever cluster the window is
/// showing, and that changes with a click on a chip rather than with anything a
/// frame does. It is also asked on every cluster switch, and routing that
/// through an app's dispatcher to fetch the Recent list as well would be paying
/// for a list nobody in the title bar draws.
///
/// A `ProjectInfo` rather than a bare path, because the bar names the project
/// and the manifest's name wins over the folder's — see `project::describe`.
#[tauri::command]
pub fn cluster_project(
    app: tauri::AppHandle,
    cluster_id: Option<String>,
) -> Option<project::ProjectInfo> {
    project::snapshot(&app, cluster_id.as_deref()).open
}

/// Point a cluster at a project, or at nothing, without going through Home.
///
/// Home's methods are the ones a person reaches — they raise a picker, touch
/// the Recent list, and initialize a folder that needs it. This is the
/// primitive underneath: it moves the cluster's pointer and nothing else.
///
/// It exists because the layout has to be able to say so on its own. Restoring
/// a session, seeding a first run, and the migration in `lib.rs` all set a
/// cluster's project without any of them being a user opening one, and routing
/// those through Home would put a folder in the Recent list every launch.
#[tauri::command]
pub fn set_cluster_project(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    cluster_id: String,
    path: Option<String>,
) {
    shell.set_cluster_project(&app, &cluster_id, path);
    project::retitle(&app);
    // A new project needs its `.mcp.json` before an agent starts in it.
    crate::mcp::sync_all(&app);
}

// --- layout presets ---------------------------------------------------------
//
// A preset is a named arrangement: the split shape, and which app belongs in
// each pane. See `presets`'s module doc for the model and for why it is not a
// `PaneNode`.
//
// Every command here acts on the **calling window's active cluster**, and none
// of them takes a cluster id. That is what the menu means by "this cluster" —
// the row is drawn in the bar of the cluster you are looking at — and a cluster
// id in the arguments would be a second answer to a question the window has
// already answered, with a window able to apply a preset to a cluster it is not
// showing and cannot see the result of.

/// Every preset: the compiled-in built-ins, then whatever survives of
/// `presets.json`.
///
/// Fetched once per window, because Tauri events have no replay — the same gap
/// `shell_state` and `boot_status` both close this way. Afterwards a window
/// keeps up through `presets:changed`, which `save_preset` emits.
#[tauri::command]
pub fn list_presets(app: tauri::AppHandle) -> Vec<presets::LayoutPreset> {
    presets::list(&app)
}

/// Capture the active cluster's arrangement and save it under `name`.
///
/// Returns the whole merged list, so the window that asked repaints its menu
/// without waiting for the broadcast it is also about to receive — the same
/// double answer `project`'s mutators give Home, and for the same reason: the
/// caller has a reply to read, and everyone else needs the event.
///
/// Refuses a blank name and a built-in's name; see `presets::save` for why the
/// second one is a refusal rather than a second row with the same label.
#[tauri::command]
pub fn save_preset(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    label: String,
    name: String,
) -> Result<Vec<presets::LayoutPreset>> {
    let root = shell
        .capture_preset(&label)
        .ok_or(AppError::NoCluster("save the arrangement of"))?;
    presets::save(&app, &name, root)
}

/// Rearrange the active cluster to match a preset.
///
/// Two phases, and the split is forced rather than chosen. `ShellState` does the
/// rearranging in one mutation — every surface already open is moved into the
/// slot that matches it, and everything the preset did not mention is left in
/// the last pane, **with nothing closed** — and hands back the slots it had
/// nothing to fill. Filling those is this function's half, because a slot may
/// want a terminal, and a terminal is a pty: it comes from `PtySessions` through
/// `open_terminal`, which is the one path in the app that spawns a shell and is
/// not about to become two.
///
/// Each fill is its own broadcast and its own write of `layout.json`. That is
/// the same trade `add_cluster` makes a few sections up and for the same reason:
/// both are cheap, and the alternative is a `ShellState` primitive that quietly
/// opens surfaces nobody asked it for.
///
/// A gap that cannot be filled is skipped rather than failing the whole apply.
/// The arrangement is already on screen by then, and refusing it because one
/// shell would not spawn would undo work the user can see in front of them.
#[tauri::command]
pub fn apply_preset(
    app: tauri::AppHandle,
    shell: State<'_, ShellState>,
    ptys: State<'_, PtySessions>,
    label: String,
    preset_id: String,
) -> Result<()> {
    let preset = presets::find(&app, &preset_id)
        .ok_or_else(|| AppError::UnknownPreset(preset_id.clone()))?;

    let (cluster_id, gaps) = shell
        .apply_preset(&app, &label, &preset.root)
        .ok_or(AppError::NoCluster("apply a preset to"))?;

    for gap in gaps {
        match gap.slot {
            presets::PresetSlot::App { app_id } => {
                // Resolved from the registry rather than trusted from the
                // preset, exactly as `open_instance` above resolves it: the
                // registry is what decides where an `invoke` from the resulting
                // frame is answered. `normalized` has already dropped any slot
                // naming something outside it, so this is `App` in practice —
                // spelled out anyway, because a preset file is user-editable
                // input and this is the door it comes through.
                let kind = if apps::is_app(&app_id) {
                    SurfaceKind::App
                } else {
                    SurfaceKind::Tool
                };
                let title = apps::display_name(&app_id);
                // **No direction, so no split.** `apply_preset` has already
                // built the tree the preset describes and named the pane each
                // gap belongs to; an open that split that pane would rearrange
                // the arrangement being restored, one surface at a time. The
                // whole feature depends on this staying `None`.
                let Some(instance_id) = shell.open_instance(
                    &app,
                    &label,
                    &app_id,
                    kind,
                    &title,
                    Some(&gap.pane_id),
                    None,
                ) else {
                    eprintln!("helve: could not open `{app_id}` for a preset slot");
                    continue;
                };
                // Only when appending would have put it in the wrong place,
                // which is only ever a pane holding more than one slot. See
                // `presets::Gap::index`: the common pane costs one mutation, not
                // two.
                if let Some(index) = gap.index {
                    shell.move_instance(&app, &instance_id, &cluster_id, &gap.pane_id, Some(index));
                }
            }
            presets::PresetSlot::Terminal => {
                // The same path the Apps menu's Terminal row takes — see
                // `open_terminal_into_pane`, which is where the spawn-then-move
                // and the two-kinds-of-terminal reasoning are written down. A
                // preset slot and a menu click asking for the same thing must
                // not be able to produce two different kinds of terminal.
                if let Err(e) = open_terminal_into_pane(
                    &app,
                    &shell,
                    &ptys,
                    &label,
                    &cluster_id,
                    &gap.pane_id,
                    gap.index,
                    // No direction, for the reason the app branch above gives:
                    // the preset already decided the shape.
                    None,
                ) {
                    eprintln!("helve: could not open a terminal for a preset slot: {e}");
                }
            }
        }
    }

    Ok(())
}

/// Stubbed until the engine has something real to report. Kept as a command so
/// the seam is already the right shape — when the engine reports for itself,
/// this stops being called by the frontend and starts being called by whatever
/// supervises the process.
#[tauri::command]
pub fn set_engine_state(app: tauri::AppHandle, shell: State<'_, ShellState>, engine: EngineState) {
    shell.set_engine(&app, engine);
}
