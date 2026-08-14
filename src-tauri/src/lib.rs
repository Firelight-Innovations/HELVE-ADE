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
mod project;
mod pty;
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
        // Which project is open, and the ones opened before it. The only state
        // in the orchestrator that outlives the process — see `project::store`
        // for where it is written and why that is the first thing here to touch
        // the disk at all.
        .manage(ProjectState::default())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                // Where a window is, so it can be put back there next launch.
                // Recorded without broadcasting or writing — these fire on
                // every frame of a drag. `close_window` and the next real
                // mutation are what commit them; see `ShellState::set_geometry`.
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    if let Some(geometry) = windows::geometry_of(window) {
                        app.state::<ShellState>().set_geometry(window.label(), geometry);
                    }
                }
                // A window closing on purpose must not strand what was inside
                // it, so its clusters go back to the main window. This does
                // nothing unless the close came through `close_window` — at
                // shutdown `Destroyed` fires for every window, and reclaiming
                // then would collapse the whole session and save the wreckage
                // as the layout to restore. See `ShellState::closing`.
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
            // Before anything else that wants to know where the user is. The
            // launch terminal below opens *inside* the restored project, and the
            // Files app takes it as its default directory — so a restore that
            // ran after either of those would leave them pointing at the stack
            // root for the rest of the session.
            project::restore(app.handle());

            let handle = app.handle().clone();
            restore_session(&handle);

            boot::start(app.handle().clone());

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
            commands::new_window,
            commands::detach_instance,
            commands::window_at_cursor,
            commands::set_window_geometry,
            commands::close_window,
            commands::create_terminal,
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
            commands::app_call,
            git::git_status,
            git::git_diff,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Put the shell back the way it was left.
///
/// Runs after `project::restore`, because the cluster a first launch seeds is
/// named after the open project and there is no name to use before that.
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
}

/// Give every restored terminal tab a live shell.
///
/// A tab whose shell will not start is closed rather than left on screen. The
/// alternative is a tab that draws, accepts focus, and swallows every keystroke
/// with nothing to send them to — which looks like HELVE being broken rather
/// than like one shell being unavailable.
fn respawn_terminals(app: &tauri::AppHandle, shell: &ShellState) {
    let ptys = app.state::<PtySessions>();
    let cwd = project::open_path(app).unwrap_or_else(|| std::path::PathBuf::from("."));

    for terminal in shell.snapshot().terminals {
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
fn seed_first_run(app: &tauri::AppHandle, shell: &ShellState) {
    if let Some(name) = project::open_path(app)
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
    {
        let snapshot = shell.snapshot();
        if let Some(cluster) = snapshot.windows.first().and_then(|w| w.clusters.first()) {
            shell.rename_cluster(app, &cluster.id, &name);
        }
    }

    shell.open_instance(
        app,
        "main",
        "home",
        shell_state::SurfaceKind::App,
        "Home",
        None,
    );
}
