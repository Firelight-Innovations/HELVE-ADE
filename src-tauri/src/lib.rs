//! Helve orchestrator — the entry point that ties the multi-repo stack together.
//!
//! The Rust side owns everything that touches the machine: reading the stack
//! manifest, finding component checkouts on disk, and comparing what's there
//! against the pinned versions. The web frontend is a pure view over the
//! `StackSnapshot` this produces.

mod apps;
mod boot;
mod commands;
mod discovery;
mod error;
mod git;
mod layout;
mod manifest;
mod presets;
mod project;
mod pty;
mod search;
mod shell_state;
mod shell_store;
mod state;
mod tool;
mod tool_frontend;
mod windows;

use project::ProjectState;
use pty::PtySessions;
use shell_state::ShellState;
use state::AppState;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Tool frontends mount as iframes on their own origin. In a release
        // build that origin is this scheme, backed by each tool's built `dist`
        // directory — see `tool_frontend`. In development the frames point at
        // the tools' own dev servers instead, so this never gets hit.
        .register_uri_scheme_protocol(tool_frontend::SCHEME, |ctx, request| {
            let (status, mime, body) = tool_frontend::serve(ctx.app_handle(), request.uri().path());
            tauri::http::Response::builder()
                .status(status)
                .header(tauri::http::header::CONTENT_TYPE, mime)
                .body(body)
                .expect("tool asset response is well-formed")
        })
        // `manage` puts a value into Tauri's type-keyed state map. Any command
        // that asks for `State<'_, AppState>` gets a reference to this one
        // instance, so there's no global to thread around by hand.
        .manage(AppState::default())
        // Placement and terminal sessions, shared by every window. Separate
        // from `AppState` because they answer a different question: `AppState`
        // is what the *stack* looks like on disk, this is what the *shell*
        // currently looks like on screen.
        .manage(ShellState::default())
        // The live pseudo-terminals, keyed by the session ids `ShellState`
        // hands out. Kept apart from `ShellState` deliberately: that is small,
        // serializable, and broadcast to every window on every change, whereas
        // this holds OS handles and reader threads that must never be cloned or
        // sent anywhere near the frontend.
        .manage(PtySessions::default())
        // The Recent list: every project this machine has opened. *Not* which
        // one is open — that belongs to a cluster and travels in `layout.json`
        // with the rest of the layout, so that two windows can be working on
        // two projects at once. See `project`'s module doc for the split, and
        // `project::store` for why this was the first thing here to touch the
        // disk at all.
        .manage(ProjectState::default())
        // The one counter that lets an in-flight content search notice a
        // newer one has started and abandon itself early. See
        // `search::SearchState` for why one process-wide counter is enough.
        .manage(search::SearchState::default())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                // Where a window is, so it can be put back there next launch.
                // Recorded without broadcasting or writing — these fire on
                // every frame of a drag. `windows::request_close`, below, and
                // the next real mutation are what commit them; see
                // `ShellState::set_geometry`.
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    if let Some(geometry) = windows::geometry_of(window) {
                        app.state::<ShellState>().set_geometry(window.label(), geometry);
                    }
                }
                // A window has been asked to close — by our own titlebar's ×,
                // by Alt+F4, by the taskbar, or by the OS shutting down
                // gracefully. All of them reach this event identically; see
                // `windows::request_close` for why that matters and what it
                // does before letting the close proceed.
                WindowEvent::CloseRequested { .. } => {
                    windows::request_close(app, &app.state::<ShellState>(), window.label());
                }
                // A window closing on purpose must not strand what was inside
                // it, so its clusters go back to the main window. `CloseRequested`
                // above now does that fold before the window actually closes, so
                // by the time `Destroyed` lands here the marker it left is
                // already consumed and this is normally a no-op. It stays as a
                // fallback for a window the OS destroys directly, skipping
                // `CloseRequested` — which is also why it must never reclaim
                // unconditionally: at a shutdown that destroys every window that
                // way, `Destroyed` fires for every one of them, and a reclaim
                // that trusted it would collapse the whole session and save the
                // wreckage as the layout to restore. See `ShellState::closing`.
                WindowEvent::Destroyed => {
                    windows::reclaim(app, &app.state::<ShellState>(), window.label());
                }
                _ => {}
            }
        })
        // `.setup` runs once, after every window declared in tauri.conf.json
        // has been created — so the splash window (`visible: true`) is
        // already on screen by the time this fires. `app.handle()` borrows
        // an `AppHandle` from the `&mut App` this closure receives; `.clone()`
        // turns that borrow into an owned handle `boot::start` can move onto
        // its own thread. `AppHandle` is cheap to clone by design — it's a
        // thin reference to the app's shared internals, not a copy of them.
        .setup(|app| {
            // Before the layout, because `restore_session` reads the old global
            // open project out of this store to migrate it onto a cluster. The
            // launch terminal below opens *inside* whatever cluster the main
            // window ends up showing, and the Files app takes its cluster's
            // project as its default directory — so a restore that ran after
            // either of those would leave them pointing at the stack root for
            // the rest of the session.
            project::restore(app.handle());

            let handle = app.handle().clone();
            restore_session(&handle);

            // After `restore_session`, because what boot waits for is whichever
            // apps that restore actually put on screen. See `boot::EXPECTED`.
            boot::start(app.handle().clone(), apps_on_screen(&handle));

            // The launch terminal. Opened here rather than baked into
            // `ShellState::default` because a session must not exist before the
            // shell behind it does — and spawning a process is exactly the kind
            // of work a `Default` impl has no business doing.
            //
            // A failure is not fatal: a machine with no usable shell should
            // still get an orchestrator, with an empty panel and a working "+".
            // It is reported rather than swallowed, though — this is the one
            // step in a terminal's life that can fail for reasons no amount of
            // reading the code will reveal, and a silently empty panel gives
            // whoever hits it nothing to go on.
            //
            // Skipped entirely when a session was restored: that session
            // brought its own terminals back, and adding one more on every
            // launch would grow the panel by a tab a day.
            if handle.state::<ShellState>().snapshot().terminals.is_empty() {
                if let Err(e) = commands::open_terminal(
                    &handle,
                    &handle.state::<ShellState>(),
                    &handle.state::<PtySessions>(),
                    "main",
                    80,
                    24,
                ) {
                    eprintln!("helve: could not open the launch terminal: {e}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_stack,
            commands::cached_stack,
            commands::reveal_tool,
            commands::finish_boot,
            commands::boot_status,
            commands::app_painted,
            commands::shell_state,
            commands::open_instance,
            commands::close_instance,
            commands::activate_instance,
            commands::set_instance_title,
            commands::move_instance,
            commands::split_pane,
            commands::set_pane_sizes,
            commands::add_cluster,
            commands::set_active_cluster,
            commands::rename_cluster,
            commands::close_cluster,
            commands::set_cluster_project,
            commands::cluster_project,
            commands::list_presets,
            commands::save_preset,
            commands::apply_preset,
            commands::new_window,
            commands::detach_cluster,
            commands::detach_instance,
            commands::window_at_cursor,
            commands::set_window_geometry,
            commands::close_window,
            commands::create_terminal,
            commands::open_terminal_in_pane,
            commands::close_terminal,
            commands::split_terminal,
            commands::terminal_attach,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_busy,
            commands::move_terminal,
            commands::set_active_terminal,
            commands::set_terminal_title,
            commands::set_engine_state,
            commands::tool_frontend,
            commands::list_apps,
            commands::list_openables,
            commands::app_call,
            git::git_cluster_diff,
            git::git_cluster_stage,
            git::git_cluster_unstage,
            git::git_cluster_commit,
            git::git_worktrees,
            git::git_worktree_create,
            git::git_worktree_remove,
            git::git_worktree_reconcile,
            git::git_graph,
            git::git_divergence,
            git::git_divergence_diff,
            git::git_cluster_status,
            git::git_hunks,
            git::git_head_text,
            search::search_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Which apps have at least one instance in the layout, with their names.
///
/// What boot waits to hear `helve/painted` from. Every app in the registry used
/// to be docked at startup, so the registry and "what is on screen" were the
/// same list; a restored session makes them different, and waiting on an app
/// with no frame mounted would hold the splash for the full timeout on every
/// launch that did not happen to have it open.
fn apps_on_screen(app: &tauri::AppHandle) -> Vec<(String, String)> {
    let snapshot = app.state::<ShellState>().snapshot();
    let open: std::collections::HashSet<String> =
        snapshot.instances.iter().map(|i| i.app_id.clone()).collect();

    apps::roster()
        .into_iter()
        .filter(|(id, _)| open.contains(*id))
        .map(|(id, name)| (id.to_string(), name.to_string()))
        .collect()
}

/// Put the shell back the way it was left.
///
/// Runs after `project::restore`, because both branches below need the old
/// global open project: one to name the cluster a first launch seeds, the other
/// to migrate it onto the cluster that used to be showing it.
///
/// Two things deliberately do *not* come back. A pty dies with the process, so
/// a restored terminal tab gets a fresh shell rather than a dead one — a tab
/// that looks alive and silently eats keystrokes is the exact failure
/// `open_terminal`'s ordering exists to prevent, and it would be strange to
/// reintroduce it here. And a window whose monitor is no longer attached is
/// re-centred rather than restored to coordinates that now name nowhere; see
/// `shell_store::place_within`.
fn restore_session(app: &tauri::AppHandle) {
    let stored = shell_store::load(app);
    let shell = app.state::<ShellState>();

    if stored.windows.is_empty() {
        seed_first_run(app, &shell);
        return;
    }

    shell.restore(shell_state::ShellSnapshot {
        windows: stored.windows,
        instances: stored.instances,
        terminals: stored.terminals,
        // Not restored: a stale "building" would be a claim about a process
        // that is not running. See `shell_store::Stored`.
        engine: shell_state::EngineState::Idle,
    });

    migrate_global_project(app, &shell);

    // Geometry first, windows second. `main` already exists — it is declared in
    // tauri.conf.json — so it is moved rather than built; everything else is
    // built at the position it should already be in, because creating a window
    // and then moving it is a visible jump on screen.
    let snapshot = shell.snapshot();
    for placement in &snapshot.windows {
        let geometry = placement
            .geometry
            .and_then(|g| shell_store::clamp_to_visible(app, g));

        if placement.label == "main" {
            if let (Some(window), Some(g)) = (app.get_webview_window("main"), geometry) {
                let _ = window.set_position(tauri::PhysicalPosition::new(g.x, g.y));
                let _ = window.set_size(tauri::PhysicalSize::new(g.width, g.height));
            }
            continue;
        }

        if let Err(e) = windows::create(app, &placement.label, geometry, false) {
            eprintln!("helve: could not restore window {}: {e}", placement.label);
        }
    }

    respawn_terminals(app, &shell);
    project::retitle(app);
}

/// **The one-time migration** from the old global open project to a cluster.
///
/// Before this change, "the open project" was one value for the whole process,
/// stored in `projects.json`. Braden has a live session on disk right now, so a
/// build that simply started reading `Cluster::project` would open to a
/// workspace with nothing in it and no indication that anything had moved. The
/// old value is taken and given to the first cluster of the main window — the
/// one that *was* showing it, since there was only one project to show.
///
/// Two things make this run exactly once and no more.
///
/// `take_migration_seed` **consumes** the field: it reads the path, writes
/// `None` back, and saves. So the source is gone after the first launch of this
/// build, rather than sitting there waiting to be applied again the next time
/// somebody closes a project. That is the whole reason it is a take and not a
/// read — a migration whose input survives it is a migration that re-runs.
///
/// The guard is the belt to that braces: a layout where some cluster already
/// has a project has already been through this, so the seed is still drained
/// but nothing is overwritten. Without it, a `projects.json` restored from a
/// backup could reach in and change a project the user had since chosen.
fn migrate_global_project(app: &tauri::AppHandle, shell: &ShellState) {
    let Some(seed) = project::take_migration_seed(app) else {
        return;
    };
    if shell.any_cluster_has_a_project() {
        return;
    }
    let Some(cluster_id) = shell.first_cluster_id() else {
        return;
    };

    shell.set_cluster_project(app, &cluster_id, Some(seed.display().to_string()));
}

/// Give every restored terminal tab a live shell.
///
/// A tab whose shell will not start is closed rather than left on screen. The
/// alternative is a tab that draws, accepts focus, and swallows every keystroke
/// with nothing to send them to — which looks like HELVE being broken rather
/// than like one shell being unavailable.
///
/// Each one respawns in **its own window's** project, resolved at this moment
/// the same way `commands::terminal_cwd` resolves it for a fresh terminal. A
/// terminal belongs to a window's panel and not to any cluster, so there is no
/// project stored with it to restore; what there is instead is the project the
/// window is pointed at now, which is the same answer opening a terminal there
/// would give. Two windows on two projects therefore come back with their
/// shells in the right two directories rather than all of them in one.
fn respawn_terminals(app: &tauri::AppHandle, shell: &ShellState) {
    let ptys = app.state::<PtySessions>();

    for terminal in shell.snapshot().terminals {
        let cwd = project::window_path(app, &terminal.window_label)
            .unwrap_or_else(|| std::path::PathBuf::from("."));

        if let Err(e) = ptys.open(app, &terminal.id, &cwd, 80, 24) {
            eprintln!(
                "helve: could not restore the shell behind {}: {e}",
                terminal.id
            );
            shell.close_terminal(app, &terminal.id);
        }
    }
}

/// The very first launch, or one after the layout file was lost.
///
/// Home, and nothing else. Not every app: opening a surface the user did not
/// ask for is the thing this whole feature exists to stop doing, and Home is
/// the one place a session with no project has anywhere to go from.
///
/// The migration applies here too, and it has to. Losing `layout.json` while
/// keeping `projects.json` is an ordinary way to arrive here — the layout file
/// is the newer of the two and the one a bad shutdown can truncate — and a
/// first run that threw the remembered project away would be a data loss with
/// a plausible-looking cause. The seeded cluster takes it, and takes its name
/// from it as it always has.
fn seed_first_run(app: &tauri::AppHandle, shell: &ShellState) {
    let seed = project::take_migration_seed(app);

    if let Some(cluster_id) = shell.first_cluster_id() {
        if let Some(path) = seed.as_deref() {
            if let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) {
                shell.rename_cluster(app, &cluster_id, &name);
            }
            shell.set_cluster_project(app, &cluster_id, Some(path.display().to_string()));
        }
    }

    // No pane preference and no split direction: there is one empty pane and
    // no window drawn yet to have measured it in. See `PaneNode::open_into`.
    shell.open_instance(
        app,
        "main",
        "home",
        shell_state::SurfaceKind::App,
        "Home",
        None,
        None,
    );

    project::retitle(app);
}
