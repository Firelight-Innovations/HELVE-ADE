//! Helve orchestrator — the entry point that ties the multi-repo stack together.
//!
//! The Rust side owns everything that touches the machine: reading the stack
//! manifest, finding component checkouts on disk, and comparing what's there
//! against the pinned versions. The web frontend is a pure view over the
//! `StackSnapshot` this produces.

mod boot;
mod commands;
mod discovery;
mod error;
mod manifest;
mod shell_state;
mod state;
mod tool;
mod tool_frontend;
mod windows;

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
            boot::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_stack,
            commands::cached_stack,
            commands::reveal_tool,
            commands::finish_boot,
            commands::boot_status,
            commands::shell_state,
            commands::set_docked_tools,
            commands::set_active_tool,
            commands::detach_tool,
            commands::window_at_cursor,
            commands::create_terminal,
            commands::close_terminal,
            commands::move_terminal,
            commands::set_engine_state,
            commands::tool_frontend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
