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

    /// The repository's own `.mcp.json` is a real file this module's output has
    /// to keep matching, not just a fixture. It was committed once, by a
    /// merge (`9f5e300`) that landed each of `kaava-debug` and `kaava-echo`
    /// twice with identical bodies — `serde_json` silently kept the last
    /// occurrence of each on read, so the file parsed and worked, and nobody
    /// noticed the JSON text itself was malformed.
    ///
    /// `merge` cannot reproduce that: it builds a `serde_json::Map`, which has
    /// no way to hold two entries under one key. So the bug was never in this
    /// module — it was the tracked file drifting from anything this module
    /// would write. This test reads the tracked file as text, the way a
    /// hand-edit or a bad merge would leave it, rather than going through
    /// `serde_json::Value` first, which would have hidden the very duplication
    /// it exists to catch.
    #[test]
    fn the_tracked_mcp_json_has_no_duplicate_keys() {
        let text = include_str!("../../../.mcp.json");
        if let Err(key) = duplicate_object_key(text) {
            panic!("{key} appears twice in the tracked .mcp.json");
        }
    }

    /// The other half of staying current: the tracked file is meant to be what
    /// a fresh checkout's first `sync` would write — `merge`'s own docs call it
    /// "the same file for every developer" — so it has to name every server
    /// that ships enabled by default, not just the two that existed when it was
    /// last hand-updated. `kaava-design` shipped after the file was last
    /// touched and was missing from it until this test was added.
    #[test]
    fn the_tracked_mcp_json_matches_a_fresh_syncs_default_output() {
        let tracked: Value = serde_json::from_str(include_str!("../../../.mcp.json"))
            .expect("the tracked file is valid JSON");

        let registry = crate::mcp::Registry::default();
        crate::mcp::servers::seed(&registry);
        let ids = registry.enabled_ids(false);

        let generated = merge(None, &ids).unwrap();

        assert_eq!(
            tracked, generated,
            "the tracked .mcp.json no longer matches what a fresh checkout's \
             first sync would write for the servers that ship enabled by \
             default; regenerate it"
        );
    }

    /// A duplicate top-level `mcpServers` key, or a duplicate key inside it,
    /// makes `Err` with the repeated key. Walks the whole document rather than
    /// just `mcpServers`, since a merge can duplicate any object in the file,
    /// not only the one this module writes into.
    ///
    /// `serde_json::Value` cannot answer this itself — deserializing into it
    /// silently keeps the last of a repeated key, which is exactly the
    /// behaviour that let the bug this test exists for go unnoticed. So this
    /// walks the token stream directly with a `Visitor` that tracks the keys
    /// it has already seen at each object it opens.
    fn duplicate_object_key(text: &str) -> Result<(), String> {
        use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
        use std::collections::HashSet;
        use std::fmt;

        struct NoDuplicateKeys;

        impl<'de> Visitor<'de> for NoDuplicateKeys {
            type Value = ();

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                write!(f, "any JSON value")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
                let mut seen = HashSet::new();
                while let Some(key) = map.next_key::<String>()? {
                    if !seen.insert(key.clone()) {
                        return Err(serde::de::Error::custom(key));
                    }
                    map.next_value::<Checked>()?;
                }
                Ok(())
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
                while seq.next_element::<Checked>()?.is_some() {}
                Ok(())
            }

            fn visit_bool<E>(self, _: bool) -> Result<(), E> {
                Ok(())
            }
            fn visit_i64<E>(self, _: i64) -> Result<(), E> {
                Ok(())
            }
            fn visit_u64<E>(self, _: u64) -> Result<(), E> {
                Ok(())
            }
            fn visit_f64<E>(self, _: f64) -> Result<(), E> {
                Ok(())
            }
            fn visit_str<E>(self, _: &str) -> Result<(), E> {
                Ok(())
            }
            fn visit_unit<E>(self) -> Result<(), E> {
                Ok(())
            }
        }

        /// A value visited only for its duplicate-key check; its content is
        /// otherwise discarded.
        struct Checked;

        impl<'de> Deserialize<'de> for Checked {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                deserializer
                    .deserialize_any(NoDuplicateKeys)
                    .map(|_| Checked)
            }
        }

        let mut de = serde_json::Deserializer::from_str(text);
        Checked::deserialize(&mut de)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Proves the checker above actually looks: a hand-built document with a
    /// repeated key must fail it, or `the_tracked_mcp_json_has_no_duplicate_keys`
    /// would be trusting a check that always passes.
    #[test]
    fn duplicate_object_key_catches_a_repeated_key() {
        let err =
            duplicate_object_key(r#"{ "mcpServers": { "kaava-echo": {}, "kaava-echo": {} } }"#)
                .expect_err("a repeated key must be reported");
        assert!(
            err.contains("kaava-echo"),
            "expected the repeated key in the error, got {err}"
        );
    }

    #[test]
    fn duplicate_object_key_accepts_a_well_formed_document() {
        assert!(duplicate_object_key(r#"{ "a": { "b": 1 }, "c": [1, 2, 3] }"#).is_ok());
    }
}
