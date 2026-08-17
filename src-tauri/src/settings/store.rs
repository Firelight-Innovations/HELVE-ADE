//! Where HELVE remembers what you changed, across launches.
//!
//! The fourth thing in the orchestrator to touch the disk, after
//! [`crate::project::store`], [`crate::shell_store`] and
//! [`crate::presets::store`], and built to the same four rules those three
//! share — read `presets::store` for the reasoning, which is unchanged here:
//! never fatal, atomic write, forward-compatible, and outside the repo.
//!
//! ## What is not in the file
//!
//! Anything still at its default. `settings.json` on a machine nobody has
//! touched the screen on does not exist, and on one where a single toggle moved
//! it holds one line. That is [`super::Registry::values`]'s sparseness carried
//! through to disk, and it is what lets a later build change a default and have
//! the new one reach everyone who never disagreed with the old one.
//!
//! The *schema* is not in it either. What settings exist, what they are called
//! and what they accept is code — `super::schema` and every app's own group —
//! so a file written by a newer build degrades to "the keys this build still
//! knows" rather than teaching this build about settings it cannot draw.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FILE: &str = "settings.json";

/// What is on disk: changed values, keyed by setting.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stored {
    pub values: BTreeMap<String, Value>,
}

/// Read the store, or start empty. Never fails — see the module doc.
pub fn load(app: &AppHandle) -> Stored {
    let Some(path) = file(app) else {
        return Stored::default();
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        // Not-found is the ordinary case — nobody has changed a setting yet —
        // and says nothing worth printing. Anything else is a real read failure
        // and is worth a line, because the visible symptom is a screen showing
        // every default, which looks exactly like a first launch.
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!("helve: could not read {}: {e}", path.display());
            }
            return Stored::default();
        }
    };

    serde_json::from_str(&raw).unwrap_or_else(|e| {
        eprintln!(
            "helve: {} is not readable, falling back to the defaults: {e}",
            path.display()
        );
        Stored::default()
    })
}

/// Write the store, atomically. A copy of `presets::store::save` down to the
/// error handling — deliberately, because the failure it guards against is the
/// same one and a second version of it that drifted would be a second way to
/// lose a file.
pub fn save(app: &AppHandle, stored: &Stored) {
    let Some(path) = file(app) else { return };

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("helve: could not create {}: {e}", parent.display());
            return;
        }
    }

    let json = match serde_json::to_string_pretty(stored) {
        Ok(json) => json,
        Err(e) => {
            eprintln!("helve: could not serialize the settings: {e}");
            return;
        }
    };

    let temp = path.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&temp, json) {
        eprintln!("helve: could not write {}: {e}", temp.display());
        return;
    }
    if let Err(e) = std::fs::rename(&temp, &path) {
        eprintln!("helve: could not replace {}: {e}", path.display());
        let _ = std::fs::remove_file(&temp);
    }
}

/// `%APPDATA%/<identifier>/settings.json` on Windows, the equivalent elsewhere.
///
/// Beside `projects.json`, `layout.json` and `presets.json`, never inside a
/// project. Settings are the person's, not the repository's — a `settings.json`
/// committed into a checkout would be one contributor's font size arriving in
/// everybody else's editor.
fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The degradation promise, as a test. A document this build cannot parse
    /// yields the defaults rather than an error, and a document from a build
    /// that added a top-level field still loads.
    #[test]
    fn an_unreadable_store_falls_back_to_the_defaults() {
        let broken: std::result::Result<Stored, _> = serde_json::from_str("{ not json");
        assert!(broken.is_err(), "the parse itself fails");

        let newer: Stored = serde_json::from_str(r#"{"values":{},"syncedWithTheTeam":true}"#)
            .expect("an unknown field must not fail the read");
        assert!(newer.values.is_empty());
    }

    #[test]
    fn an_empty_document_is_a_store_with_nothing_changed() {
        let stored: Stored =
            serde_json::from_str("{}").expect("`{}` is a store holding no changes");
        assert!(stored.values.is_empty());
    }

    /// The file is the thing that survives a restart, so a setting that writes
    /// and does not read back is a setting that resets itself overnight.
    #[test]
    fn a_changed_setting_survives_a_round_trip_through_the_file_format() {
        let stored = Stored {
            values: BTreeMap::from([
                ("editor.fontSize".to_string(), json!(15)),
                ("editor.wordWrap".to_string(), json!(true)),
                ("terminal.defaultShell".to_string(), json!("bash")),
            ]),
        };

        let json = serde_json::to_string_pretty(&stored).expect("serializes");
        let back: Stored = serde_json::from_str(&json).expect("and reads back");

        assert_eq!(back.values, stored.values);
    }

    /// A value whose *type* this build no longer accepts still parses here.
    /// Refusing it is `Registry::hydrate`'s job, not this file's — a store that
    /// failed to load because of one bad line would lose every good one beside
    /// it.
    #[test]
    fn a_value_this_build_would_refuse_still_parses() {
        let stored: Stored = serde_json::from_str(r#"{"values":{"editor.fontSize":"huge"}}"#)
            .expect("the file loads whatever JSON it holds");
        assert_eq!(stored.values["editor.fontSize"], json!("huge"));
    }
}
