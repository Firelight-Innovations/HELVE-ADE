//! Where HELVE remembers which project you had open, across launches.
//!
//! This is the first thing in the orchestrator that writes to disk. Everything
//! else it knows it re-derives at boot — the stack snapshot is a scan, the shell
//! layout starts from `Default`, a terminal dies with its process. That was fine
//! while nothing had to survive a restart. "Open HELVE and land back where you
//! were" is the first thing that does.
//!
//! It lives in the OS's config directory for this app, not in the repo and not
//! beside any project. It is about *this machine's* history with projects, which
//! is not a fact about any one of them and must not end up in someone's version
//! control.
//!
//! ## Never fatal
//!
//! Every read here degrades to [`Stored::default`]. A recents file that is
//! missing, truncated by a power cut, or written by a future build must not stop
//! HELVE from starting — the worst honest outcome of a corrupt file is an empty
//! Recent list, and that is a great deal better than an app that will not open.
//! The write side is what makes that rare: it writes a temp file and renames it,
//! so a reader either sees the whole previous file or the whole new one.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// How many projects the Recent list remembers.
///
/// A cap rather than everything-forever, because this file is read at every
/// launch and each entry costs a `stat` to find out whether it still exists.
/// Twenty is well past where a person stops scanning a list and starts using
/// Open instead.
const RECENT_LIMIT: usize = 20;

const FILE: &str = "projects.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stored {
    /// The project that was open when HELVE last closed, if any. Restored at
    /// launch — this is the field the whole module exists for.
    pub open: Option<PathBuf>,
    /// Most recently opened first.
    pub recents: Vec<Recent>,
}

/// A remembered project.
///
/// `name` is cached rather than re-read from the marker on every launch, and
/// that is deliberate: a recent whose drive is unplugged still has to draw a
/// row, and a row that could only say a path would be a worse answer than a
/// slightly stale name.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub path: PathBuf,
    pub name: String,
    /// Milliseconds since the Unix epoch.
    pub last_opened: u64,
}

impl Stored {
    /// Record a project as just-opened: to the front of the list, once.
    pub fn touch(&mut self, path: &Path, name: &str, at: u64) {
        self.recents.retain(|r| r.path != path);
        self.recents.insert(
            0,
            Recent {
                path: path.to_path_buf(),
                name: name.to_string(),
                last_opened: at,
            },
        );
        self.recents.truncate(RECENT_LIMIT);
    }

    pub fn forget(&mut self, path: &Path) {
        self.recents.retain(|r| r.path != path);
        // A forgotten project that happens to be the open one stays open. The
        // Recent list is a history, and editing history is not the same act as
        // closing what is in front of you.
    }
}

/// Read the store, or start empty. Never fails — see the module doc.
pub fn load(app: &AppHandle) -> Stored {
    let Some(path) = file(app) else {
        return Stored::default();
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        // Not-found is the ordinary first-launch case and says nothing worth
        // printing. Anything else is a real read failure and is worth a line in
        // the log, since the visible symptom — an empty Recent list — looks
        // identical to a first launch.
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!("helve: could not read {}: {e}", path.display());
            }
            return Stored::default();
        }
    };

    serde_json::from_str(&raw).unwrap_or_else(|e| {
        eprintln!("helve: {} is not readable, starting fresh: {e}", path.display());
        Stored::default()
    })
}

/// Write the store, atomically.
///
/// Temp file then rename, because the alternative — truncating the real file and
/// writing into it — has a window where a crash leaves a half-written JSON
/// document that the next launch cannot parse. `rename` over an existing file is
/// atomic on both NTFS and POSIX filesystems, so a reader sees one whole version
/// or the other and never a partial one.
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
            eprintln!("helve: could not serialize the project store: {e}");
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

/// `%APPDATA%/<identifier>/projects.json` on Windows, the equivalent elsewhere.
///
/// `None` only if the platform has no config directory at all, which is not a
/// state any desktop this ships to is in — but it is an `Option` rather than an
/// `expect` because losing the Recent list is a smaller failure than a panic.
fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_with(paths: &[&str]) -> Stored {
        let mut stored = Stored::default();
        for (i, p) in paths.iter().enumerate() {
            stored.touch(Path::new(p), p, i as u64);
        }
        stored
    }

    #[test]
    fn touching_moves_a_project_to_the_front_without_duplicating_it() {
        let mut stored = stored_with(&["a", "b", "c"]);
        assert_eq!(stored.recents[0].path, PathBuf::from("c"));

        stored.touch(Path::new("a"), "a", 99);

        assert_eq!(stored.recents.len(), 3, "re-opening is not a new entry");
        assert_eq!(stored.recents[0].path, PathBuf::from("a"));
        assert_eq!(stored.recents[0].last_opened, 99);
    }

    #[test]
    fn the_recent_list_is_capped() {
        let paths: Vec<String> = (0..RECENT_LIMIT + 5).map(|i| format!("p{i}")).collect();
        let mut stored = Stored::default();
        for (i, p) in paths.iter().enumerate() {
            stored.touch(Path::new(p), p, i as u64);
        }

        assert_eq!(stored.recents.len(), RECENT_LIMIT);
        assert_eq!(
            stored.recents[0].path,
            PathBuf::from(paths.last().unwrap()),
            "the newest survives"
        );
    }

    #[test]
    fn forgetting_removes_only_that_entry() {
        let mut stored = stored_with(&["a", "b", "c"]);
        stored.forget(Path::new("b"));

        let left: Vec<&PathBuf> = stored.recents.iter().map(|r| &r.path).collect();
        assert_eq!(left, vec![&PathBuf::from("c"), &PathBuf::from("a")]);
    }

    /// The degradation promise, as a test: a store this build cannot fully
    /// understand still yields a usable value rather than an error.
    #[test]
    fn an_unreadable_store_deserializes_to_nothing_rather_than_failing() {
        let broken: std::result::Result<Stored, _> = serde_json::from_str("{ this is not json");
        assert!(broken.is_err(), "the parse itself fails");

        // And a *parseable* document with unknown fields still loads, which is
        // what lets a newer build's store open here.
        let newer: Stored =
            serde_json::from_str(r#"{"open":null,"recents":[],"workspaces":["something new"]}"#)
                .expect("an unknown field must not fail the read");
        assert!(newer.recents.is_empty());
    }
}
