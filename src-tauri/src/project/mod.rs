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
//! ## A project belongs to a cluster, not to the process
//!
//! This module used to own "the open project" as a single global, stored beside
//! the Recent list in `projects.json`. It does not any more, and the change is
//! the reason most of what follows reads the way it does.
//!
//! **[`crate::shell_state::Cluster::project`] is the authority.** A cluster is
//! one thing being worked on, so the folder that work is in is a fact about the
//! cluster — which means two windows on two monitors can show two projects at
//! the same time, and a project switch in one of them touches nothing in the
//! other. A global made that unexpressible rather than merely awkward: whichever
//! window opened something last would have re-rooted every Files in the process
//! and retitled every window.
//!
//! What is left here is everything that was never per-cluster. The Recent list
//! *is* global — it is this machine's history with projects, not a property of
//! any one place you are working — so it stays in [`store::Stored`] and stays in
//! `projects.json`. So does the filesystem knowledge: what makes a folder a
//! project, what its manifest says, whether it is still there. Opening one is
//! still this module's verb; it now takes the cluster it is opening *into*.
//!
//! ## The broadcast
//!
//! Every mutator below returns the whole new [`ProjectSnapshot`], and Home
//! renders the answer it got back — Home reaches Rust over transport B, which
//! carries request/response, and a surface that asked the question can just
//! read the reply.
//!
//! Home is not the only surface that draws this, and the second one cannot work
//! that way. Files renders a tree rooted at its cluster's project and has to
//! redraw when that changes, with no request of its own to hang the answer off
//! — nothing asked it anything. So [`open`] and [`close`] also emit
//! [`PROJECT_CHANGED_EVENT`], exactly the way `ShellState` emits `shell:state`.
//! The shell window listens for it and forwards it into app frames as a
//! transport-B `event` message (`src/shell/toolwindow/ToolWindow.tsx`).
//!
//! **The event names its cluster, and the relay is filtered by it.** That is not
//! an optimisation. An unfiltered relay would wake every Files in the process
//! when one cluster's project changed, and each of them would re-root itself at
//! a project it is not in — which is precisely the bug the per-cluster model
//! exists to prevent, reintroduced on the way out. [`ProjectChanged`] therefore
//! carries `clusterId` alongside the snapshot, and `ToolWindow` posts it only
//! into frames whose instance is in that cluster.
//!
//! The payload is the whole snapshot rather than a delta, for `shell:state`'s
//! reasons: it is small, it changes only on deliberate user action, and a
//! subscriber can never apply half of it. A delta would additionally oblige an
//! app that mounted late to have heard every earlier one, which nothing here
//! can promise — Tauri events have no replay.
//!
//! What this is not is a filesystem watcher. It fires when *which project a
//! cluster is pointed at* changes, and never because something inside one did.
//! An app that needs to notice a file appearing still has to ask again.

mod marker;
mod store;

use crate::error::{AppError, Result};
use crate::shell_state::ShellState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::{AppHandle, Emitter, Manager};

/// The event a project switch broadcasts on, carrying a [`ProjectChanged`] —
/// the whole new snapshot, and the cluster it is about. See the module doc.
pub const PROJECT_CHANGED_EVENT: &str = "project:changed";

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

/// One cluster's project and the global history, in one payload — see the
/// module doc on why every mutator returns the whole thing.
///
/// `open` is the *asking cluster's* project, not a process-wide one. Two Home
/// surfaces in two clusters therefore get two different answers to `home/state`,
/// which is the whole point: each of them draws the project of the work it is
/// sitting in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub open: Option<ProjectInfo>,
    pub recents: Vec<ProjectInfo>,
}

/// What [`PROJECT_CHANGED_EVENT`] carries.
///
/// A [`ProjectSnapshot`] with the cluster stamped on it. The stamp is the
/// load-bearing part: `ToolWindow` relays this into app frames, and it must
/// relay it *only* into frames in `cluster_id` — see the module doc.
///
/// Written out rather than composed with `#[serde(flatten)]` so the wire shape
/// is legible from this one declaration; the frontend reads `clusterId`, `open`
/// and `recents` off one object either way.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanged {
    pub cluster_id: String,
    pub open: Option<ProjectInfo>,
    pub recents: Vec<ProjectInfo>,
}

/// The Recent list, behind a lock.
///
/// All that is left in this state after the open project moved onto the
/// cluster. `RwLock` for the same reason `AppState` and `ShellState` use one:
/// read on every Home render, written only when someone opens something.
#[derive(Default)]
pub struct ProjectState {
    inner: RwLock<store::Stored>,
}

impl ProjectState {
    fn read(&self) -> store::Stored {
        self.inner
            .read()
            .expect("project store lock poisoned")
            .clone()
    }
}

/// Load the store from disk. Called once, from `lib.rs`'s setup, before the
/// layout is restored — the migration below reads `Stored::open` out of it.
pub fn restore(app: &AppHandle) {
    let stored = store::load(app);
    *app.state::<ProjectState>()
        .inner
        .write()
        .expect("project store lock poisoned") = stored;
}

/// Take the pre-per-cluster global open project, consuming it.
///
/// **The migration, and it runs once by construction.** `Stored::open` is the
/// field this module used to be built around; it is now written by nothing and
/// read only here, so `lib.rs` can move Braden's existing session onto the first
/// cluster instead of opening the upgraded build to an empty workspace.
///
/// Consuming it — taking the value and persisting the `None` — is what makes
/// "once" a property of the data rather than of a flag someone has to remember
/// to set. Without that, closing the project in cluster 1 would leave the seed
/// still sitting in `projects.json`, and the next launch would helpfully open it
/// again. See [`store::Stored::open`] for why the field is kept at all rather
/// than deleted outright.
pub fn take_migration_seed(app: &AppHandle) -> Option<PathBuf> {
    let state = app.state::<ProjectState>();
    let mut guard = state.inner.write().expect("project store lock poisoned");
    let taken = guard.open.take();
    if taken.is_some() {
        store::save(app, &guard);
    }
    taken.filter(|p| p.is_dir())
}

/// Where a cluster's work actually happens, for everything that needs to
/// start somewhere: a Files app's root, a new terminal's working directory,
/// a search's scope.
///
/// A worktree wins over the project whenever the cluster has one — see
/// `ShellState::cluster_root` for why. `None` when that root is no longer on
/// disk, on top of the plain "no cluster, no root" cases — a caller wanting
/// a directory to work in should not be handed a path that was true last
/// week.
///
/// That disk filter is why [`cluster_pointer`] exists beside this. The two
/// differ on exactly one case and it is a case that has to be drawn rather
/// than hidden: a project whose folder has been deleted or unplugged. This
/// one says "nowhere to work", which is what a terminal and a file tree need
/// to hear; that one says "still pointed there", which is what Home needs in
/// order to draw the row as unavailable instead of claiming nothing is open.
pub fn cluster_path(app: &AppHandle, cluster_id: &str) -> Option<PathBuf> {
    cluster_root_pointer(app, cluster_id).filter(|p| p.is_dir())
}

/// What a cluster is pointed at, whether or not it is still there.
///
/// This is the *project*, never the worktree — deliberately, and unlike
/// [`cluster_path`] and [`cluster_root_pointer`], which follow a worktree
/// when one is set. Home draws a deleted project's row as unavailable rather
/// than as closed, and the title bar names the project a cluster is *about*;
/// both would misreport if this followed the worktree instead. Nothing here
/// touches the disk, which is also what makes it the right thing for the
/// window title to read: retitling should not cost a `stat` on a network
/// share every time somebody clicks a chip.
pub fn cluster_pointer(app: &AppHandle, cluster_id: &str) -> Option<PathBuf> {
    app.state::<ShellState>()
        .cluster_project(cluster_id)
        .map(PathBuf::from)
}

/// What a cluster's work is pointed at, whether or not it is still there —
/// the worktree-aware counterpart to [`cluster_pointer`], which stays on the
/// project on purpose. See [`cluster_path`] for the disk-existence filter
/// this deliberately omits, and `ShellState::cluster_root` for the
/// precedence itself.
pub fn cluster_root_pointer(app: &AppHandle, cluster_id: &str) -> Option<PathBuf> {
    app.state::<ShellState>()
        .cluster_root(cluster_id)
        .map(PathBuf::from)
}

/// The working root of whatever cluster a window is showing.
///
/// The window-shaped question, for the two things that are the window's
/// rather than any cluster's: the terminal panel, and where it spawns. A
/// terminal opened in a window starts in the root that window is looking at
/// *at that moment* and then stays where it is — see
/// `ShellState::active_cluster_root` for why it does not follow later
/// cluster switches, and for the worktree-over-project precedence a plain
/// `active_cluster_project` would have missed.
pub fn window_path(app: &AppHandle, label: &str) -> Option<PathBuf> {
    app.state::<ShellState>()
        .active_cluster_root(label)
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

/// Everything Home draws, from the asking cluster's point of view.
///
/// `cluster_id` is `None` for a caller with no cluster to speak of — an app
/// frame whose instance has just been closed, or the shell asking before any
/// cluster exists. That reads as "nothing open", which is the truthful answer:
/// there is no cluster whose project could be reported.
pub fn snapshot(app: &AppHandle, cluster_id: Option<&str>) -> ProjectSnapshot {
    let stored = app.state::<ProjectState>().read();
    // `cluster_pointer`, not `cluster_path`: a project whose folder has been
    // deleted or unplugged is still the one this cluster is open on, and Home
    // draws it as unavailable — that is what `ProjectInfo::exists` is for.
    // Filtering it out here would report "nothing is open" for a cluster whose
    // title bar is still naming the project, and would silently swap Home's
    // "this folder is gone" state for its "pick a project" one.
    let open_path = cluster_id.and_then(|id| cluster_pointer(app, id));

    // `last_opened` for the open project comes from the recents entry, which is
    // the same record — opening a project and recording it are one act, even
    // though one of them is now the cluster's and the other is global.
    let open = open_path.as_ref().map(|path| {
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

/// Open a folder as a project **in `cluster_id`**. Creates nothing — a folder
/// with no manifest opens as one that is not initialized, and the frontend
/// offers to fix that.
///
/// Two stores are touched and they are deliberately different in scope. The
/// cluster is pointed at the folder, which is what "open" means now; and the
/// Recent list is touched, which stays global because it is this machine's
/// history rather than anything about the place you are working. Opening the
/// same project in a second cluster is one recent entry, not two.
pub fn open(app: &AppHandle, path: &Path, cluster_id: &str) -> Result<ProjectSnapshot> {
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
        store::save(app, &guard);
    }

    // The lock above is dropped first, for the reason `changed` documents: this
    // goes through `ShellState::mutate`, which emits and writes to disk, and
    // holding one store's lock across another's broadcast is how a deadlock
    // gets written.
    let shell = app.state::<ShellState>();

    // The worktree goes before the project does, and it is not optional. A
    // worktree belongs to the repository it was cut from, so a cluster that was
    // working in one and is now pointed at a *different* project holds a binding
    // to a checkout of something else entirely — and since a worktree outranks
    // the project in `cluster_root`, leaving it set would send this cluster's
    // terminals, file tree and search into the old project's worktree while the
    // title bar named the new one. Opening a project is the one moment we know
    // for certain the old binding cannot still be right.
    //
    // Ordered first so that no subscriber ever observes the pair mid-swap: the
    // intermediate state is "new project, no worktree", which is exactly what a
    // freshly opened project looks like anyway.
    shell.set_cluster_worktree(app, cluster_id, None);
    shell.set_cluster_project(app, cluster_id, Some(path.display().to_string()));

    retitle(app);

    // The emit lives here rather than in each mutator, because `create` and
    // `initialize` both finish by calling this: one user-visible change, one
    // event. Emitting in all four would fire twice for a create, and a
    // subscriber cannot tell that from two real switches.
    Ok(changed(app, cluster_id))
}

/// Make `dir` a HELVE project and open it in `cluster_id`.
///
/// The project's name is the folder's, which is why this takes no name argument:
/// the native folder picker already lets someone create and name a folder, and a
/// second name field on the way in would be a second thing to keep in agreement
/// with the first. The manifest can be renamed later; the folder is the project.
pub fn create(app: &AppHandle, dir: &Path, cluster_id: &str) -> Result<ProjectSnapshot> {
    std::fs::create_dir_all(dir).map_err(|source| AppError::Io {
        path: dir.display().to_string(),
        source,
    })?;

    marker::create(dir, &folder_name(dir))?;
    open(app, dir, cluster_id)
}

/// Write a manifest into a folder that is already open without one — the
/// "set this up as a HELVE project" action.
///
/// Separate from [`create`] even though it does nearly the same thing, because
/// the two answer differently when the folder is already a project: creating
/// over one is a mistake worth refusing, while initializing one that got
/// initialized in the meantime is just a no-op the user should not see an error
/// for.
pub fn initialize(app: &AppHandle, dir: &Path, cluster_id: &str) -> Result<ProjectSnapshot> {
    if marker::find(dir).is_none() {
        marker::create(dir, &folder_name(dir))?;
    }
    open(app, dir, cluster_id)
}

/// Point `cluster_id` at nothing, without touching the history.
///
/// Scoped to the one cluster, like every other mutator here. Closing the project
/// in the cluster you are looking at leaves the cluster on the next monitor
/// exactly where it was — which is the difference this whole change is about.
pub fn close(app: &AppHandle, cluster_id: &str) -> ProjectSnapshot {
    let shell = app.state::<ShellState>();

    // Both, for the reason `open` spells out: a worktree left behind by a closed
    // project outranks the `None` project in `cluster_root`, so a cluster that
    // was supposed to have nothing open would still be handing out a directory
    // to work in. Closing the project closes the checkout it was working in.
    shell.set_cluster_worktree(app, cluster_id, None);
    shell.set_cluster_project(app, cluster_id, None);

    retitle(app);
    changed(app, cluster_id)
}

/// Drop one entry from the Recent list. Deletes nothing on disk — this is the
/// history forgetting a project, not HELVE removing one.
///
/// The Recent list is global, so this is global too: forgetting a project
/// forgets it everywhere, whichever cluster asked. `cluster_id` is only here so
/// the snapshot handed back reports the *asking* cluster's open project, which
/// is what Home redraws with.
///
/// The only mutator that does not broadcast, and provably safely: `Stored::
/// forget` touches `recents` and never any cluster's project, so nothing a
/// subscriber to `project:changed` acts on can differ afterwards. Home draws the
/// Recent list and gets the new one as this call's return value. Firing here
/// would wake every app frame in the cluster to tell it the thing it watches did
/// not change.
pub fn forget(app: &AppHandle, path: &Path, cluster_id: Option<&str>) -> ProjectSnapshot {
    {
        let state = app.state::<ProjectState>();
        let mut guard = state.inner.write().expect("project store lock poisoned");
        guard.forget(path);
        store::save(app, &guard);
    }

    snapshot(app, cluster_id)
}

// --- helpers -----------------------------------------------------------------

/// Take the new snapshot, broadcast it stamped with its cluster, and hand it
/// back to the caller who is also going to return it.
///
/// Same posture as `ShellState::mutate`, deliberately: `app.emit` with the
/// result dropped. A failed emit means there is no webview left to hear it,
/// which is not a condition a mutator can act on or a caller can fix — and
/// turning it into an error would fail an `open` that had already succeeded.
/// Every caller has dropped the store's write lock before reaching here, for
/// the reason `mutate` documents: `emit` goes into Tauri's event machinery, and
/// holding a lock across a call that may want to read the same state is how a
/// deadlock gets written.
///
/// The `cluster_id` on the wire is what makes the relay in `ToolWindow` able to
/// be selective; see the module doc on why an unfiltered relay would undo the
/// whole change.
fn changed(app: &AppHandle, cluster_id: &str) -> ProjectSnapshot {
    let snapshot = snapshot(app, Some(cluster_id));
    let _ = app.emit(
        PROJECT_CHANGED_EVENT,
        &ProjectChanged {
            cluster_id: cluster_id.to_string(),
            open: snapshot.open.clone(),
            recents: snapshot.recents.clone(),
        },
    );
    snapshot
}

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

/// Put each window's own project in its OS window title.
///
/// The shell draws its own title bar, so this is not what the user reads inside
/// the app — it is what the taskbar, the alt-tab switcher, and a screen reader
/// announce. Those are the places where "which HELVE window is this" is a real
/// question, and the only ones that can answer it are outside the webview.
///
/// **Per window, from the cluster that window is showing.** It used to hardcode
/// `main`, which was correct while there was one project in the process and
/// silently wrong the moment there were several: two windows working on two
/// projects would have shown one name in the taskbar, or two entries with the
/// same one. A window showing a cluster with no project — or showing no cluster
/// at all — falls back to plain "HELVE" rather than inheriting a neighbour's
/// name, which would be the same lie in a quieter form.
///
/// Called after anything that can change the answer: a project opening or
/// closing, and every cluster command in `commands.rs` (adding, closing,
/// switching, detaching), since all of those change *which* cluster a window is
/// showing without touching any project.
pub fn retitle(app: &AppHandle) {
    for (label, project) in app.state::<ShellState>().window_projects() {
        let title = match project.as_deref() {
            Some(path) => format!("{} — HELVE", folder_name(Path::new(path))),
            None => "HELVE".to_string(),
        };
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_title(&title);
        }
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
