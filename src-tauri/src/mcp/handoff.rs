//! How an agent that OpenKaava did not spawn finds the MCP endpoint.
//!
//! [`Endpoint::env`](super::listener::Endpoint::env) hands the port and token to
//! every terminal OpenKaava opens, which covers the agent working *inside* OpenKaava and
//! nothing else. An agent in Windows Terminal, in an editor, or in a session
//! started before OpenKaava was, inherits neither and has no way to ask. This writes
//! them down so it can.
//!
//! **The token is a bearer credential and this puts it in a file**, readable by
//! anything running as this user. That is only a reasonable trade while the
//! served surface stays read-only, and a server that mutates anything has to
//! reopen the decision rather than inherit it. `mcp::servers::design` is the
//! first that has; `docs/design-notes/design-comments.md` is where. Nothing
//! deletes the file either; `pid` is what tells a reader whether it is live.
//!
//! Both arguments in full: `docs/design-notes/agent-debugging.md`.

use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FILE: &str = "mcp-endpoint.json";

/// Write the endpoint where an outside agent can find it.
///
/// Never fatal, on the same rule the four other stores follow: a machine that
/// will not take this file is one where OpenKaava should still open. It costs the
/// out-of-process agent path and nothing else — terminals OpenKaava spawns still get
/// the environment variables.
pub fn publish(app: &AppHandle, port: u16, token: &str) {
    let Some(path) = file(app) else { return };

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            crate::kaava_log!("could not create {}: {e}", parent.display());
            return;
        }
    }

    // Temp file then rename, like every other store here. A reader that opens
    // this while it is being written gets the previous launch's file or the new
    // one, never half of each.
    let temp = path.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&temp, document(std::process::id(), port, token)) {
        crate::kaava_log!("could not write {}: {e}", temp.display());
        return;
    }

    if let Err(e) = std::fs::rename(&temp, &path) {
        crate::kaava_log!("could not replace {}: {e}", path.display());
        let _ = std::fs::remove_file(&temp);
    }
}

/// The file's contents.
///
/// Split out from [`publish`] so the shape can be tested without an `AppHandle`,
/// which a unit test cannot build.
///
/// `url` is included even though it is `port` with a prefix. The alternative is
/// every reader concatenating it, and a reader that gets that wrong fails with a
/// connection error rather than with anything that names this file.
fn document(pid: u32, port: u16, token: &str) -> String {
    let contents = json!({
        "pid": pid,
        "port": port,
        "token": token,
        "url": format!("http://127.0.0.1:{port}"),
        // Spelled out because the alternative is a reader guessing, and the
        // guess that fails silently is sending the token as a query parameter.
        "authorization": format!("Bearer {token}"),
    });

    format!("{contents:#}\n")
}

/// Where the file lives. `None` on a machine with no resolvable config dir,
/// which is the same condition that stops `layout.json` from being written.
fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn parsed() -> Value {
        serde_json::from_str(&document(4321, 51234, "sekrit")).expect("the document is JSON")
    }

    #[test]
    fn the_document_carries_everything_a_client_needs_to_connect() {
        let doc = parsed();
        assert_eq!(doc["pid"], 4321);
        assert_eq!(doc["port"], 51234);
        assert_eq!(doc["token"], "sekrit");
        assert_eq!(doc["url"], "http://127.0.0.1:51234");
        assert_eq!(doc["authorization"], "Bearer sekrit");
    }

    /// Loopback, and spelled as an address rather than as `localhost`. The
    /// listener binds `127.0.0.1`, and on a machine where `localhost` resolves
    /// to `::1` first a client following that name would be refused.
    #[test]
    fn the_url_is_the_loopback_address_the_listener_actually_bound() {
        let doc = parsed();
        let url = doc["url"].as_str().expect("url is a string");
        assert!(url.starts_with("http://127.0.0.1:"));
    }

    /// Written for a person to read as well as a program: this is the file
    /// somebody opens when the connection is not working.
    #[test]
    fn the_document_is_pretty_printed_and_newline_terminated() {
        let raw = document(1, 2, "t");
        assert!(raw.contains('\n'));
        assert!(raw.ends_with('\n'));
    }
}
