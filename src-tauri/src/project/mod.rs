//! What a HELVE project is, and which one is open.
//!
//! A project is **a folder**. That is the whole of the definition, and it is
//! chosen rather than defaulted to: a game is already a tree of files that a
//! person moves, copies to another machine, and puts under version control, and
//! any definition that made the project something other than that folder would
//! immediately have to explain what happens when the folder moves without it.
//!
//! A folder becomes a *HELVE* project when it holds a `<name>.helve` manifest —
//! see [`marker`] for why that name and not `.helve`. But an un-marked folder
//! still opens. That matters more than it sounds: it means HELVE can be pointed
//! at a game that already exists, today, before the format is finished, and the
//! answer to "what happens to my project when the `.helve` format changes" is
//! never "it stops opening". [`ProjectInfo::initialized`] is how the frontend
//! tells the two apart, so it can offer to set one up rather than refusing it.
//!
//! ## Why there is no broadcast
//!
//! `ShellState` emits `shell:state` on every mutation because several windows
//! render it. Nothing here does that, and the omission is deliberate. The one
//! surface that draws this is Home, which lives in an iframe and reaches Rust
//! over transport B — a path that carries request/response and has no event
//! channel until the broker exists. So every mutator below returns the *whole*
//! new [`ProjectSnapshot`] and Home renders the answer it got back. A broadcast
//! today would be a mechanism with no subscriber, and the shape of the one it
//! eventually needs is a question for when there is something to receive it.

mod marker;
mod store;

use crate::error::{AppError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

/// One project, as a frontend needs to see it.
///
/// Paths are `String`, not `PathBuf`, because this crosses into JSON and a
/// Windows path is not guaranteed to be UTF-8 — `PathBuf` would serialize as
/// whatever `Display` produced anyway. Doing the conversion here makes that one
/// decision in one place instead of an accident at the boundary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    /// The manifest's stable id, when there is a manifest. `None` for a folder
    /// that isn't set up yet — which is why the *path* is what identifies a row
    /// on the frontend, not this. It is here because it is the only handle that
    /// survives the folder being renamed or moved, and the first thing anything
    /// cross-referencing projects later will want.
    pub id: Option<String>,
    /// Whether a `<name>.helve` manifest was found. `false` is a plain folder
    /// HELVE has been pointed at — openable, and offered a setup.
    pub initialized: bool,
    /// Whether the folder is still on disk. A recent entry can outlive the
    /// project it names — a moved folder, an unplugged drive — and a row that
    /// silently failed on click would be worse than one drawn as unavailable.
    pub exists: bool,
    /// The manifest's `format`, when there is one. Greater than
    /// [`marker::FORMAT`] means a newer HELVE wrote it and this build is reading
    /// it partially.
    pub format: Option<i64>,
    /// Milliseconds since the Unix epoch, when HELVE last opened it. `None` for
    /// a project opened for the first time this session.
    pub last_opened: Option<u64>,
    /// The folder's own mtime, in the same units. What *the work* last changed,
    /// as opposed to when it was last looked at.
    pub modified: Option<u64>,
}

/// The open project and the history, in one payload — see the module doc on why
/// every mutator returns the whole thing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub open: Option<ProjectInfo>,
    pub recents: Vec<ProjectInfo>,
}

/// The live store behind a lock.
///
/// `RwLock` for the same reason `AppState` and `ShellState` use one: read on
/// every Home render, written only when someone opens or closes something.
#[derive(Default)]
pub struct ProjectState {
    inner: RwLock<store::Stored>,
}

impl ProjectState {
    fn read(&self) -> store::Stored {
        self.inner.read().expect("project store lock poisoned").clone()
    }
}

/// Load the store from disk. Called once, from `lib.rs`'s setup, before anything
/// asks where the open project is — the launch terminal in particular, which
/// wants to start inside it.
pub fn restore(app: &AppHandle) {
    let stored = store::load(app);
    *app.state::<ProjectState>()
        .inner
        .write()
        .expect("project store lock poisoned") = stored;

    // The title is set from whatever was restored, including the `None` case,
    // so a launch with no open project doesn't inherit a stale name from
    // tauri.conf.json's static title.
    retitle(app);
}

/// The open project's folder, for everything that needs to start somewhere: the
/// Files app's default directory, a new terminal's working directory.
///
/// `None` when nothing is open, *or* when what is open no longer exists on disk
/// — a caller wanting a directory to work in should not be handed a path that
/// was true last week.
pub fn open_path(app: &AppHandle) -> Option<PathBuf> {
    app.state::<ProjectState>()
        .read()
        .open
        .filter(|p| p.is_dir())
}

/// Everything Home draws.
pub fn snapshot(app: &AppHandle) -> ProjectSnapshot {
    let stored = app.state::<ProjectState>().read();

    // `last_opened` for the open project comes from the recents entry, which is
    // the same record — `open` and the head of `recents` describe one act.
    let open = stored.open.as_ref().map(|path| {
        let last_opened = stored
            .recents
            .iter()
            .find(|r| &r.path == path)
            .map(|r| r.last_opened);
        describe(path, None, last_opened)
    });

    let recents = stored
        .recents
        .iter()
        .map(|r| describe(&r.path, Some(&r.name), Some(r.last_opened)))
        .collect();

    ProjectSnapshot { open, recents }
}

/// Open a folder as a project. Creates nothing — a folder with no manifest opens
/// as one that is not initialized, and the frontend offers to fix that.
pub fn open(app: &AppHandle, path: &Path) -> Result<ProjectSnapshot> {
    if !path.is_dir() {
        return Err(AppError::NotAProject(path.display().to_string()));
    }

    // The manifest's name wins over the folder's. They are usually the same, but
    // when they differ it is because someone renamed the folder — and the name
    // they typed into the project is the one they meant.
    let name = marker::find(path)
        .and_then(|m| marker::load(&m).ok())
        .map(|m| m.name)
        .unwrap_or_else(|| folder_name(path));

    {
        let state = app.state::<ProjectState>();
        let mut guard = state.inner.write().expect("project store lock poisoned");
        guard.touch(path, &name, marker::now_ms());
        guard.open = Some(path.to_path_buf());
        store::save(app, &guard);
    }

    retitle(app);
    Ok(snapshot(app))
}

/// Make `dir` a HELVE project and open it.
///
/// The project's name is the folder's, which is why this takes no name argument:
/// the native folder picker already lets someone create and name a folder, and a
/// second name field on the way in would be a second thing to keep in agreement
/// with the first. The manifest can be renamed later; the folder is the project.
pub fn create(app: &AppHandle, dir: &Path) -> Result<ProjectSnapshot> {
    std::fs::create_dir_all(dir).map_err(|source| AppError::Io {
        path: dir.display().to_string(),
        source,
    })?;

    marker::create(dir, &folder_name(dir))?;
    open(app, dir)
}

/// Write a manifest into a folder that is already open without one — the
/// "set this up as a HELVE project" action.
///
/// Separate from [`create`] even though it does nearly the same thing, because
/// the two answer differently when the folder is already a project: creating
/// over one is a mistake worth refusing, while initializing one that got
/// initialized in the meantime is just a no-op the user should not see an error
/// for.
pub fn initialize(app: &AppHandle, dir: &Path) -> Result<ProjectSnapshot> {
    if marker::find(dir).is_none() {
        marker::create(dir, &folder_name(dir))?;
    }
    open(app, dir)
}

/// Close the open project without touching the history.
pub fn close(app: &AppHandle) -> ProjectSnapshot {
    {
        let state = app.state::<ProjectState>();
        let mut guard = state.inner.write().expect("project store lock poisoned");
        guard.open = None;
        store::save(app, &guard);
    }

    retitle(app);
    snapshot(app)
}

/// Drop one entry from the Recent list. Deletes nothing on disk — this is the
/// history forgetting a project, not HELVE removing one.
pub fn forget(app: &AppHandle, path: &Path) -> ProjectSnapshot {
    {
        let state = app.state::<ProjectState>();
        let mut guard = state.inner.write().expect("project store lock poisoned");
        guard.forget(path);
        store::save(app, &guard);
    }

    snapshot(app)
}

// --- helpers -----------------------------------------------------------------

/// Build a [`ProjectInfo`] by asking the filesystem what is true right now.
///
/// Every field but the cached name is read fresh on each call rather than stored
/// — a project can be initialized, renamed, or deleted by something that is not
/// HELVE, and a Recent list that reported its own last belief instead of the
/// disk's current state would be confidently wrong in exactly the cases that
/// matter.
fn describe(path: &Path, cached_name: Option<&str>, last_opened: Option<u64>) -> ProjectInfo {
    let exists = path.is_dir();
    let found = if exists { marker::find(path) } else { None };
    let loaded = found.as_ref().and_then(|m| marker::load(m).ok());

    let name = loaded
        .as_ref()
        .map(|m| m.name.clone())
        .or_else(|| cached_name.map(str::to_owned))
        .unwrap_or_else(|| folder_name(path));

    ProjectInfo {
        name,
        path: path.display().to_string(),
        id: loaded
            .as_ref()
            .map(|m| m.id.clone())
            .filter(|id| !id.is_empty()),
        initialized: found.is_some(),
        exists,
        format: loaded.as_ref().map(|m| m.format),
        last_opened,
        modified: modified_ms(path),
    }
}

fn modified_ms(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// A folder's last component, or its whole path if it has none — a drive root
/// like `D:\` has no file name, and calling that project "" would be worse than
/// calling it `D:\`.
fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.display().to_string())
}

/// Put the open project's name in the OS window title.
///
/// The shell draws its own title bar, so this is not what the user reads inside
/// the app — it is what the taskbar, the alt-tab switcher, and a screen reader
/// announce. Those are the places where "which HELVE window is this" is a real
/// question, and the only ones that can answer it are outside the webview.
fn retitle(app: &AppHandle) {
    let stored = app.state::<ProjectState>().read();
    let title = match stored.open.as_deref() {
        Some(path) => format!("{} — HELVE", folder_name(path)),
        None => "HELVE".to_string(),
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&title);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_name_takes_the_last_component() {
        assert_eq!(folder_name(Path::new(r"C:\code\MyGame")), "MyGame");
        assert_eq!(folder_name(Path::new("/home/braden/MyGame")), "MyGame");
    }

    /// A drive root has no file name at all. `Path::file_name` returns `None`,
    /// and the fallback is what stops a project there being called "".
    #[test]
    fn folder_name_of_a_root_falls_back_to_the_path() {
        let root = Path::new(r"C:\");
        assert!(!folder_name(root).is_empty());
    }
}
