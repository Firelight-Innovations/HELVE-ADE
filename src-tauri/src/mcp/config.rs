//! Writing OpenKaava's servers into a project's `.mcp.json`.
//!
//! This is the discovery step: the file is how a harness learns that these
//! servers exist at all. Two rules govern everything here.
//!
//! **The file is the user's, not ours.** A project may already configure its own
//! servers, and this must round-trip them untouched. Only the `kaava-` prefixed
//! keys are ours to add, change or remove.
//!
//! **Nothing machine-specific goes in it.** The port and the token are written
//! as `${KAAVA_MCP_PORT}` and `${KAAVA_MCP_TOKEN}`, which the client expands
//! from the environment OpenKaava gave the shell. So the file holds no secret and no
//! per-machine value, and can be committed and shared like any other project
//! config — see `docs/mcp-server-manager.md` §6.

use super::{config_key, route, Registry};
use crate::settings::{self, keys};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The `mcpServers` table, and the prefix that marks a row as ours.
const SERVERS_KEY: &str = "mcpServers";
const OURS: &str = "kaava-";

#[derive(Debug, PartialEq)]
pub enum ConfigError {
    /// The file exists and is not JSON, or is JSON that is not an object.
    ///
    /// A refusal rather than an overwrite. Something the user hand-edited into
    /// an unparseable state is still something they wrote, and replacing it with
    /// our own would destroy the only copy.
    NotAnObject,
}

/// Update a project's `.mcp.json` to match the enabled servers.
///
/// Reads what is there, merges, writes back. A project with no `.mcp.json` and
/// no enabled servers is left alone rather than given an empty file.
///
/// `mcp.writeProjectConfig` off does not skip this — it merges as though
/// nothing were enabled. A stale `kaava-` row pointing at a route nobody
/// advertises is worse than no row at all, so a file that already exists still
/// gets rewritten with those rows removed; only a project with no file to begin
/// with stays untouched, via the same `existing.is_none()` check below that
/// already covers "no file, nothing enabled".
pub fn sync(app: &AppHandle, project: &Path) {
    let path = config_path(project);
    let enabled = if settings::flag(app, keys::MCP_WRITE_PROJECT_CONFIG) {
        app.state::<Registry>().enabled_ids(super::dev_mode(app))
    } else {
        Vec::new()
    };

    let existing = match std::fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) => Some(value),
            Err(e) => {
                crate::kaava_log!(
                    "{} is not valid JSON, leaving it alone: {e}",
                    path.display()
                );
                return;
            }
        },
        Err(_) => None,
    };

    if existing.is_none() && enabled.is_empty() {
        return;
    }

    let merged = match merge(existing, &enabled) {
        Ok(merged) => merged,
        Err(ConfigError::NotAnObject) => {
            crate::kaava_log!(
                "{} is JSON but not an object, leaving it alone",
                path.display()
            );
            return;
        }
    };

    // Two spaces and a trailing newline, which is what every other tool writing
    // this file produces and what a diff of it should look like.
    let Ok(mut text) = serde_json::to_string_pretty(&merged) else {
        return;
    };
    text.push('\n');

    if let Err(e) = std::fs::write(&path, text) {
        crate::kaava_log!("could not write {}: {e}", path.display());
    }
}

/// Where a project's MCP config lives.
pub fn config_path(project: &Path) -> PathBuf {
    project.join(".mcp.json")
}

/// Bring every open project's `.mcp.json` up to date.
///
/// Idempotent, and cheap enough to call whenever the answer might have changed:
/// at boot, when a cluster is pointed at a project, and when a server is toggled
/// in settings. Two clusters on one project resolve to one path and the second
/// write is a no-op.
pub fn sync_all(app: &AppHandle) {
    let shell = app.state::<crate::shell_state::ShellState>();
    let mut done: Vec<PathBuf> = Vec::new();

    for window in shell.snapshot().windows {
        for cluster in window.clusters {
            let Some(project) = crate::project::cluster_path(app, &cluster.id) else {
                continue;
            };
            if done.contains(&project) {
                continue;
            }
            sync(app, &project);
            done.push(project);
        }
    }
}

/// Merge our servers into whatever was already there.
///
/// Pure, so the round-trip rules below can be tested without a project on disk.
///
/// **Every** `kaava-` key is dropped before ours are added, not just the ones we
/// are about to rewrite. That is what makes a server the user switched off — or
/// one this build no longer has — disappear from the file rather than linger as
/// a row pointing at a route that no longer answers.
fn merge(existing: Option<Value>, enabled: &[String]) -> Result<Value, ConfigError> {
    let mut root = match existing {
        Some(Value::Object(map)) => map,
        Some(_) => return Err(ConfigError::NotAnObject),
        None => Map::new(),
    };

    let mut servers = match root.remove(SERVERS_KEY) {
        Some(Value::Object(map)) => map,
        Some(_) => return Err(ConfigError::NotAnObject),
        None => Map::new(),
    };

    servers.retain(|key, _| !key.starts_with(OURS));

    for id in enabled {
        servers.insert(config_key(id), entry(id));
    }

    root.insert(SERVERS_KEY.to_string(), Value::Object(servers));
    Ok(Value::Object(root))
}

/// One server's row.
///
/// `type` is mandatory and easy to leave out. A `url` with no `type` is read as
/// a stdio server, and the client skips the entry with a message about a missing
/// command rather than anything mentioning HTTP.
fn entry(id: &str) -> Value {
    json!({
        "type": "http",
        "url": format!("http://127.0.0.1:${{KAAVA_MCP_PORT}}{}", route(id)),
        "headers": { "Authorization": "Bearer ${KAAVA_MCP_TOKEN}" },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn servers_of(value: &Value) -> &Map<String, Value> {
        value[SERVERS_KEY]
            .as_object()
            .expect("mcpServers should be an object")
    }

    #[test]
    fn a_project_with_no_config_gets_one_naming_every_enabled_server() {
        let merged = merge(None, &["echo".to_string(), "acme".to_string()]).unwrap();
        let servers = servers_of(&merged);

        assert_eq!(servers.len(), 2);
        assert!(servers.contains_key("kaava-echo"));
        assert!(servers.contains_key("kaava-acme"));
    }

    /// The rule the rest of this module exists to protect: a project's own
    /// servers, and any other top-level key, survive untouched.
    #[test]
    fn the_users_own_servers_and_keys_round_trip() {
        let existing = json!({
            "mcpServers": {
                "github": { "type": "http", "url": "https://api.github.com/mcp" },
            },
            "someOtherKey": { "kept": true },
        });

        let merged = merge(Some(existing), &["echo".to_string()]).unwrap();

        assert_eq!(
            servers_of(&merged)["github"]["url"],
            "https://api.github.com/mcp",
            "the user's own server is untouched"
        );
        assert_eq!(
            merged["someOtherKey"]["kept"], true,
            "an unrelated top-level key survives"
        );
        assert!(servers_of(&merged).contains_key("kaava-echo"));
    }

    /// Switching a server off has to remove its row, or the file keeps
    /// advertising a route that answers nothing.
    #[test]
    fn a_server_that_is_no_longer_enabled_is_removed() {
        let existing = json!({
            "mcpServers": {
                "kaava-echo": { "type": "http", "url": "http://127.0.0.1:1/mcp/echo" },
                "kaava-gone": { "type": "http", "url": "http://127.0.0.1:1/mcp/gone" },
                "github": { "type": "http", "url": "https://api.github.com/mcp" },
            },
        });

        let merged = merge(Some(existing), &["echo".to_string()]).unwrap();
        let servers = servers_of(&merged);

        assert!(servers.contains_key("kaava-echo"));
        assert!(
            !servers.contains_key("kaava-gone"),
            "a stale row is dropped"
        );
        assert!(servers.contains_key("github"), "and only ours are touched");
    }

    /// What `sync` does when `mcp.writeProjectConfig` reads false: it passes
    /// `merge` an empty enabled list rather than skipping the write, so a
    /// `kaava-` row already in the file is removed instead of left pointing at
    /// a route nobody advertises. Exercised here at the `merge` level, which is
    /// pure, rather than through `sync` itself, which needs a Tauri
    /// `AppHandle` to read the setting.
    #[test]
    fn the_toggle_being_off_merges_as_though_nothing_were_enabled() {
        let existing = json!({
            "mcpServers": {
                "kaava-echo": { "type": "http", "url": "http://127.0.0.1:1/mcp/echo" },
                "github": { "type": "http", "url": "https://api.github.com/mcp" },
            },
        });

        let merged = merge(Some(existing), &[]).unwrap();
        let servers = servers_of(&merged);

        assert!(
            !servers.contains_key("kaava-echo"),
            "a stale row is removed when discovery is switched off"
        );
        assert!(
            servers.contains_key("github"),
            "the user's own server survives"
        );
    }

    #[test]
    fn disabling_everything_leaves_the_users_config_intact() {
        let existing = json!({
            "mcpServers": { "kaava-echo": {}, "github": { "type": "http" } },
        });

        let merged = merge(Some(existing), &[]).unwrap();
        let servers = servers_of(&merged);

        assert_eq!(servers.len(), 1);
        assert!(servers.contains_key("github"));
    }

    /// The entry has to carry no port and no secret, or the file stops being
    /// safe to commit — which is the whole reason it is shaped this way.
    #[test]
    fn an_entry_names_variables_rather_than_a_port_or_a_token() {
        let row = entry("acme");

        assert_eq!(row["type"], "http");
        assert_eq!(row["url"], "http://127.0.0.1:${KAAVA_MCP_PORT}/mcp/acme");
        assert_eq!(row["headers"]["Authorization"], "Bearer ${KAAVA_MCP_TOKEN}");

        // `entry` is given neither the port nor the token, so the only digits
        // that can appear are the loopback address itself. Anything else would
        // mean a live value had found its way in.
        let url = row["url"].as_str().unwrap_or_default();
        assert_eq!(
            url.matches(|c: char| c.is_ascii_digit()).count(),
            "127001".len(),
            "the only digits in {url} should be the loopback address"
        );
    }

    /// `type` is what tells the client this is HTTP. Without it the entry is
    /// read as a stdio server and skipped for a missing command.
    #[test]
    fn every_entry_declares_its_transport() {
        let merged = merge(None, &["echo".to_string()]).unwrap();
        assert_eq!(servers_of(&merged)["kaava-echo"]["type"], "http");
    }

    /// Something hand-edited into a shape we did not expect is still the user's
    /// only copy. Refuse rather than replace it.
    #[test]
    fn a_config_that_is_not_an_object_is_refused_rather_than_overwritten() {
        assert_eq!(
            merge(Some(json!([1, 2, 3])), &[]),
            Err(ConfigError::NotAnObject)
        );
        assert_eq!(
            merge(Some(json!({ "mcpServers": "not a table" })), &[]),
            Err(ConfigError::NotAnObject)
        );
    }

    #[test]
    fn the_config_sits_at_the_project_root() {
        let path = config_path(Path::new("/projects/thing"));
        assert_eq!(path.file_name().and_then(|n| n.to_str()), Some(".mcp.json"));
    }
}
