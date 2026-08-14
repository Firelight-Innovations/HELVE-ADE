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
mod manifest;
mod project;
mod pty;
mod shell_state;
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
        // A detached window closing must not strand the tool inside it. This
        // fires before the window is gone, and hands its tools and terminals
        // back to the main window — so closing a detached Journeyman puts its
        // tab back in the switcher bar rather than losing it.
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                let app = window.app_handle();
                windows::reclaim(app, &app.state::<ShellState>(), window.label());
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
            let handle = app.handle().clone();
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
            commands::set_docked_tools,
            commands::set_active_tool,
            commands::detach_tool,
            commands::window_at_cursor,
            commands::create_terminal,
            commands::close_terminal,
            commands::split_terminal,
            commands::terminal_attach,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_busy,
            commands::move_terminal,
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
