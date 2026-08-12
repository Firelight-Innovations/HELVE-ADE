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
mod state;
mod tool;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // `manage` puts a value into Tauri's type-keyed state map. Any command
        // that asks for `State<'_, AppState>` gets a reference to this one
        // instance, so there's no global to thread around by hand.
        .manage(AppState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
