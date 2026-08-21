//! MCP servers HELVE hosts for whatever coding agent the user brought — BYOH,
//! so assume nothing about it. Design: `docs/mcp-server-manager.md`; the rule
//! about what may be added is in [`servers`].

// Public so `tauri::generate_handler!` can name each command directly. The
// macro emits hidden helper items beside every `#[tauri::command]`, and a
// `pub use` of the function alone does not carry them — the same reason `git`
// and `search` are reached as modules in `lib.rs` rather than re-exported.
pub mod commands;

mod config;
mod handoff;
mod listener;
mod registry;
mod servers;

pub use config::sync_all;
pub use listener::{start, Endpoint};
pub use registry::{
    config_key, route, McpServer, McpTool, Registry, ServerInfo, ToolAnswer, ToolDescriptor,
};
pub use servers::seed;

use tauri::AppHandle;

/// Whether developer-only servers are visible, advertised and dispatchable.
///
/// Read here rather than cached in [`Registry`], and read again on every call
/// that depends on it. The cost is a map lookup; what it buys is that switching
/// the setting off takes a server away from a connected client on its next
/// request, with nothing to invalidate and no window in which the two
/// disagree.
pub fn dev_mode(app: &AppHandle) -> bool {
    crate::settings::flag(app, crate::settings::keys::DEVELOPER_MODE)
}
