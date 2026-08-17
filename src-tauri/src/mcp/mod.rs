//! MCP servers HELVE hosts for whatever coding agent the user brought — BYOH,
//! so assume nothing about it. Design: `docs/mcp-server-manager.md`; the rule
//! about what may be added is in [`servers`].

// Public so `tauri::generate_handler!` can name each command directly. The
// macro emits hidden helper items beside every `#[tauri::command]`, and a
// `pub use` of the function alone does not carry them — the same reason `git`
// and `search` are reached as modules in `lib.rs` rather than re-exported.
pub mod commands;

mod config;
mod listener;
mod registry;
mod servers;

pub use config::sync_all;
pub use listener::{start, Endpoint};
pub use registry::{config_key, route, McpServer, McpTool, Registry, ServerInfo, ToolDescriptor};
pub use servers::seed;
