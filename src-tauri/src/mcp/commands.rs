//! What the settings UI and the status bar call.
//!
//! Declared here rather than in `commands.rs` for the same reason `git` and
//! `search` declare their own: the command is the module's public surface, and
//! separating the two means a change to what MCP exposes is one file rather than
//! two that have to agree.

use super::{config, listener::Endpoint, Registry, ServerInfo};
use serde::Serialize;
use tauri::{AppHandle, State};

/// Whether an agent could reach us at all, for the status bar.
///
/// `port` is `Option` because binding can fail and the UI has to say so rather
/// than draw a connected state over a listener that never came up. **The token
/// is deliberately not here.** Nothing on screen needs it, and a secret that
/// crosses into a renderer is a secret in a devtools console.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointStatus {
    pub port: Option<u16>,
    pub servers: Vec<ServerInfo>,
}

/// Every registered server and where they answer.
#[tauri::command]
pub fn mcp_status(registry: State<'_, Registry>, endpoint: State<'_, Endpoint>) -> EndpointStatus {
    EndpointStatus {
        port: endpoint.get().map(|(port, _)| port),
        servers: registry.list(),
    }
}

/// Switch a server on or off.
///
/// Rewrites every open project's `.mcp.json` on the way out, because that file
/// is what a client reads and a toggle that changed only our own state would
/// leave the two disagreeing until the next launch.
///
/// The route stays mounted either way — see `listener::router`. What changes is
/// that the server stops being advertised and starts answering `tools/list`
/// with an empty list.
#[tauri::command]
pub fn mcp_set_server_enabled(
    app: AppHandle,
    registry: State<'_, Registry>,
    id: String,
    enabled: bool,
) -> bool {
    let changed = registry.set_enabled(&id, enabled);
    if changed {
        config::sync_all(&app);
    }
    changed
}

/// Rewrite `.mcp.json` for every open project.
///
/// Exposed because the file is the user's and they may have edited or deleted
/// it, and because a project opened mid-session has not been through the boot
/// path that writes it.
#[tauri::command]
pub fn mcp_sync_config(app: AppHandle) {
    config::sync_all(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The token must never be part of anything serialised to a window.
    #[test]
    fn the_status_payload_carries_no_token() {
        let status = EndpointStatus {
            port: Some(4321),
            servers: Vec::new(),
        };

        let json = serde_json::to_string(&status).expect("status serialises");
        assert!(json.contains("4321"), "the port is what the UI needs");
        assert!(
            !json.to_lowercase().contains("token"),
            "no token field may exist on this payload: {json}"
        );
    }
}
