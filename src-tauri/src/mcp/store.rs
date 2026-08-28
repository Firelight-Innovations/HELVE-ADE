//! Which server switches the user moved, across launches.
//!
//! Built to the same four rules as [`crate::settings::store`] and the three
//! stores before it — never fatal, atomic write, forward-compatible, outside the
//! repo — for the reasoning in `presets::store`, which is unchanged here.
//!
//! ## Why this file exists at all
//!
//! Until the UI server, every server shipped switched on, so nobody noticed that
//! moving a switch lasted only until the next launch. A server that ships
//! switched *off* makes it obvious: turning it on and finding it off again
//! tomorrow is not a limitation anyone would call deliberate.
//!
//! ## What is not in the file
//!
//! Any server still in the state it ships in. A machine where nobody has touched
//! the MCP section has no `mcp.json`, and one where a single switch moved holds
//! one line — the same sparseness `settings.json` has, for the same reason: a
//! later build that changes what a server ships as reaches everyone who never
//! disagreed with the old answer.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FILE: &str = "mcp.json";

/// What is on disk: server id to the switch position the user chose.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stored {
    pub switched: BTreeMap<String, bool>,
}

/// Read the store, or start empty. Never fails — see the module doc.
pub fn load(app: &AppHandle) -> Stored {
    let Some(path) = file(app) else {
        return Stored::default();
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                crate::kaava_log!("could not read {}: {e}", path.display());
            }
            return Stored::default();
        }
    };

    serde_json::from_str(&raw).unwrap_or_else(|e| {
        crate::kaava_log!(
            "{} is not readable, falling back to what each server ships as: {e}",
            path.display()
        );
        Stored::default()
    })
}

/// Write the store, atomically.
pub fn save(app: &AppHandle, stored: &Stored) {
    let Some(path) = file(app) else { return };

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            crate::kaava_log!("could not create {}: {e}", parent.display());
            return;
        }
    }

    let json = match serde_json::to_string_pretty(stored) {
        Ok(json) => json,
        Err(e) => {
            crate::kaava_log!("could not serialize the MCP switches: {e}");
            return;
        }
    };

    let temp = path.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&temp, json) {
        crate::kaava_log!("could not write {}: {e}", temp.display());
        return;
    }
    if let Err(e) = std::fs::rename(&temp, &path) {
        crate::kaava_log!("could not replace {}: {e}", path.display());
        let _ = std::fs::remove_file(&temp);
    }
}

/// `%APPDATA%/<identifier>/mcp.json` on Windows, the equivalent elsewhere.
///
/// Beside `settings.json`, never inside a project. `.mcp.json` in a checkout is
/// a different file with a different owner: that one is the project's and is
/// meant to be committed, this one is the person's and is not.
fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A document this build cannot parse yields the shipped states rather than
    /// an error, and one from a build that added a field still loads.
    #[test]
    fn an_unreadable_store_falls_back_to_what_each_server_ships_as() {
        let broken: std::result::Result<Stored, _> = serde_json::from_str("{ not json");
        assert!(broken.is_err(), "the parse itself fails");

        let newer: Stored = serde_json::from_str(r#"{"switched":{},"pinnedByPolicy":true}"#)
            .expect("an unknown field must not fail the read");
        assert!(newer.switched.is_empty());
    }

    #[test]
    fn an_empty_document_is_a_store_with_nothing_moved() {
        let stored: Stored = serde_json::from_str("{}").expect("`{}` is a store with no switches");
        assert!(stored.switched.is_empty());
    }

    /// The whole point of the file: a switch that writes and does not read back
    /// is a switch that resets itself overnight.
    #[test]
    fn a_moved_switch_survives_a_round_trip_through_the_file_format() {
        let stored = Stored {
            switched: BTreeMap::from([("ui".to_string(), true), ("echo".to_string(), false)]),
        };

        let json = serde_json::to_string_pretty(&stored).expect("serializes");
        let back: Stored = serde_json::from_str(&json).expect("and reads back");

        assert_eq!(back.switched, stored.switched);
    }

    /// A server this build does not have still parses. Dropping it is
    /// `Registry::hydrate`'s job — a store that failed to load over one unknown
    /// id would lose every known one beside it.
    #[test]
    fn a_server_this_build_does_not_have_still_parses() {
        let stored: Stored = serde_json::from_str(r#"{"switched":{"forger":true}}"#)
            .expect("the file loads whatever JSON it holds");
        assert!(stored.switched["forger"]);
    }
}
