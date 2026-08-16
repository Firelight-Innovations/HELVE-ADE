//! What every HELVE window has to agree on.
//!
//! The shell runs in more than one window: the main one, plus a real OS window
//! for anything that has been dragged out of it. Most of what a window knows is
//! its own business — how wide its panel is, which popover is open — but the
//! layout cannot be, because two windows disagreeing about it would be a
//! visible bug. So the layout lives here, in the backend, and each window is a
//! projection of it: it subscribes to `shell:state` and renders whatever its
//! entry says it holds. Nothing is copied between windows, which means nothing
//! can drift out of sync.
//!
//! ## The shape
//!
//! A **window** holds zero or more **clusters** and shows one of them. A cluster
//! is one thing being worked on: a pane tree of app surfaces, the **project**
//! every surface in it resolves against, and — once Braden's git work lands —
//! the worktree it operates on. Switching cluster tabs swaps the whole layout
//! beneath the switcher bar, and the project underneath it.
//!
//! The project is the cluster's and not the process's, which is the reason
//! `Cluster::project` exists at all. Two windows on two monitors, each showing a
//! cluster of its own, are meant to be able to work on two different projects at
//! once — and a single global "the open project" makes that unexpressible, not
//! merely awkward: whichever window opened something last would have retitled
//! and re-rooted the other one.
//!
//! "Zero or more" is deliberate too, and it is a change. A window used to be
//! guaranteed a cluster; closing the last one is now allowed, and the app area
//! draws an empty state while the terminal panel — which is the *window's*, not
//! any cluster's — keeps working. Dragging the last one out to another window is
//! allowed for the same reason, and gets there the same way: see
//! `move_cluster_pure`, which used to refuse exactly that and no longer does.
//!
//! An **instance** is one live surface. `files-1` and `files-2` are two Files,
//! side by side, with their own open files and their own scroll positions. This
//! is the distinction the whole module exists to draw: `files` is a *type*, and
//! it stopped being an identity the moment two of them could be on screen.
//!
//! Terminals were already built this way — `term-1`, `term-2`, moveable between
//! windows, outliving whichever one is showing them — and that existing shape
//! is what everything here generalizes. A terminal names its **window**, not a
//! cluster: the panel is the window's, so a terminal opened there stays put
//! while you switch clusters beneath it. That is the point of it — a shell
//! watching one worktree while you move between the clusters working on others
//! has nowhere to live if it has to belong to one of them.
//!
//! ## Where a surface lives
//!
//! There is exactly one answer, and it is the tree. An instance is in whichever
//! cluster's `tree` contains its id, and nowhere else. A terminal is in its
//! window's panel *unless* its id appears in a tree — any cluster's tree, in
//! any window — in which case it has been dragged into the layout and is drawn
//! there as a surface instead. No second field records this, so no second field
//! can contradict it, and a terminal can never draw in two places at once.

use crate::layout::{PaneNode, SplitDir};
use crate::presets;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::{AppHandle, Emitter};

/// The event every window listens on. One event carrying the whole state,
/// rather than a family of granular ones: the state is small, it changes only
/// on deliberate user action, and a single message means a window can never
/// apply half an update.
pub const SHELL_STATE_EVENT: &str = "shell:state";

/// The five strings the status bar can show, and nothing else.
///
/// The engine's real reporting is not designed yet. This is deliberately the
/// smallest thing that lets the interface be finished — a state, no payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineState {
    Idle,
    Building,
    Running,
    Failed,
    None,
}

/// What kind of thing an instance is an instance *of*.
///
/// The distinction the frontend cannot make any other way: an app's `invoke` is
/// answered in-process by `app_call`, a tool's would go to its core over the
/// broker, and a terminal has no frame at all. Everything else about the three
/// is deliberately identical — they are all tabs, they all drag the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceKind {
    App,
    Tool,
    Terminal,
}

/// One live surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceInstance {
    /// `files-1`. Unique for the life of the process, and stable across a
    /// restart because it is written to disk with the tree that references it.
    pub id: String,
    /// `files`. Which app or tool this is an instance of — a type, never an
    /// identity. This is what `app_call` and `tool_frontend` are given.
    pub app_id: String,
    pub kind: SurfaceKind,
    pub title: String,
}

/// Where a cluster's work is happening on disk.
///
/// **A stub.** Braden is building the git half separately; this carries the
/// shape so that adding the behaviour later is not a migration of everything
/// already written to `layout.json`. Nothing reads it yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRef {
    pub path: String,
    pub branch: Option<String>,
}

/// One tab in the switcher bar: a layout, the project it is about, and its
/// worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cluster {
    pub id: String,
    pub name: String,
    /// The pane tree. Holds instance ids; see `layout`.
    pub tree: PaneNode,
    /// The folder this cluster's work is in, or `None` for a cluster that has
    /// not been pointed at one yet — a brand-new cluster, which draws Home's
    /// pick-a-project state rather than inheriting whatever the last one was
    /// looking at.
    ///
    /// A `String` and not a `PathBuf`, matching [`WorktreeRef::path`] and for
    /// the reason [`crate::project::ProjectInfo`] spells out: this crosses into
    /// JSON, a Windows path is not guaranteed to be UTF-8, and doing the
    /// conversion at one boundary is better than doing it by accident at
    /// several.
    ///
    /// `default` because a `layout.json` written before a cluster owned a
    /// project has no such key, and a layout that failed to load is a session
    /// lost. It arrives as `None` and the migration in `lib.rs` seeds the first
    /// cluster from the old global.
    #[serde(default)]
    pub project: Option<String>,
    pub worktree: Option<WorktreeRef>,
}

/// A window's outer rectangle, in physical pixels.
///
/// Physical rather than logical because that is what `outer_position` and
/// `outer_size` report and what `available_monitors` measures against; mixing
/// in a scale factor is how a window restores half-size on a scaled display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// What a given window is holding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    /// The Tauri window label. `main`, or `win-<n>`.
    ///
    /// Opaque, and deliberately so. It used to be `tool-<id>`, which made "one
    /// window per tool" true by construction — there was no second label a
    /// second Files could have had.
    pub label: String,
    pub clusters: Vec<Cluster>,
    pub active_cluster_id: Option<String>,
    /// Which terminal this window's panel is showing.
    ///
    /// A fact about the window, not about any cluster: the panel does not
    /// change when you switch clusters, so neither does what it has selected.
    /// The *set* of terminals is derived from `ShellSnapshot::terminals`
    /// rather than duplicated here — see the module doc on why there is only
    /// ever one answer to where a thing lives — and the invariant that this
    /// names one of them, and never one that has been dragged into a tree, is
    /// re-established after every mutation by `reseat_active_terminals`.
    ///
    /// `default` because `layout.json` files written before the panel became
    /// the window's have this on the cluster instead.
    #[serde(default)]
    pub active_terminal: Option<String>,
    /// `None` until the window has reported where it is. Only ever written from
    /// the window's own move and resize events.
    pub geometry: Option<WindowGeometry>,
}

impl WindowPlacement {
    pub fn cluster_mut(&mut self, id: &str) -> Option<&mut Cluster> {
        self.clusters.iter_mut().find(|c| c.id == id)
    }

    /// The cluster this window is showing, if it is showing one.
    pub fn active_cluster_mut(&mut self) -> Option<&mut Cluster> {
        let id = self.active_cluster_id.clone()?;
        self.cluster_mut(&id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub title: String,
    /// Which window's panel holds it. Not which cluster — see the module doc.
    ///
    /// Defaulted rather than required, because a `layout.json` written before
    /// terminals left the clusters has a `clusterId` here and no label at all.
    /// The default is `main` and not `""` on purpose: an empty label matches no
    /// window, so every restored terminal would vanish from every panel while
    /// its pty ran on, which reads as the shells having failed to start.
    #[serde(default = "main_window")]
    pub window_label: String,
    /// The dot on a terminal tab: *this agent finished*. Not tool health.
    pub agent_finished: bool,
    /// Sessions sharing a group id render as one tab, laid out side by side in
    /// the deck. `None` for an ordinary, unsplit session.
    pub group_id: Option<String>,
}

/// The window a terminal falls back to. See `TerminalSession::window_label`.
fn main_window() -> String {
    "main".to_string()
}

/// The whole shared state, as one serializable object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshot {
    pub windows: Vec<WindowPlacement>,
    /// Every live app and tool surface, flat. The trees hold ids; this is what
    /// they resolve against. Flat rather than nested in the trees so that a
    /// title change does not mean rewriting a tree, which is the same reason
    /// `TerminalSession` has never lived inside a window.
    pub instances: Vec<SurfaceInstance>,
    pub terminals: Vec<TerminalSession>,
    pub engine: EngineState,
}

/// Every monotonic id counter, under one lock.
///
/// Together rather than as loose atomics because minting an id and publishing
/// the thing it names must not be two separately-observable events — the old
/// `next_terminal` comment said exactly this, and it is true of panes and
/// clusters for the same reason.
#[derive(Default)]
struct Counters {
    /// Per app id, so ids read as `files-1`, `files-2`, `home-1` rather than
    /// sharing one global sequence that says nothing about what it names.
    instances: HashMap<String, u32>,
    terminals: u32,
    panes: u32,
    splits: u32,
    clusters: u32,
    windows: u32,
}

pub struct ShellState {
    inner: RwLock<ShellSnapshot>,
    counters: RwLock<Counters>,
    /// Labels of windows whose close has been asked for — as opposed to a
    /// window the OS destroys directly, with no request first.
    ///
    /// This exists because `WindowEvent::Destroyed` alone cannot tell the two
    /// apart, and the difference decides whether `reclaim` should run. A
    /// shutdown that destroys every window that way fires `Destroyed` for
    /// *every* one of them — so a `reclaim` that trusted `Destroyed` alone
    /// would fold every detached window into `main` on the way out, and,
    /// because every mutation is persisted, would write that collapsed layout
    /// to disk as the thing to restore. You would close HELVE with three
    /// windows and open it with one, every time, and the tree serialization
    /// would look broken when it was working perfectly.
    ///
    /// So intent is stated rather than inferred: `windows::request_close`
    /// marks the label here the moment `WindowEvent::CloseRequested` fires —
    /// which happens for a close requested by our own titlebar's ×, by
    /// Alt+F4, by the taskbar, or by a graceful OS shutdown closing windows
    /// one at a time, but never for a window destroyed with no close request
    /// at all. Anything that did not announce itself that way reclaims
    /// nothing and writes nothing.
    closing: RwLock<Vec<String>>,
}

impl Default for ShellState {
    fn default() -> Self {
        let mut counters = Counters::default();
        let seed = seed_window(&mut counters, "main");

        Self {
            inner: RwLock::new(ShellSnapshot {
                windows: vec![seed],
                instances: Vec::new(),
                // No terminals until one has a shell behind it. A tab here with
                // no process behind it is a tab that swallows keystrokes;
                // `lib.rs` opens the launch terminal properly, at setup,
                // through the same path everything else uses.
                terminals: Vec::new(),
                engine: EngineState::Idle,
            }),
            counters: RwLock::new(counters),
            closing: RwLock::new(Vec::new()),
        }
    }
}

/// A window with one empty cluster, ready to be filled.
///
/// A window always has at least one cluster, and a cluster always has at least
/// one pane, so that "where does this go?" always has an answer without any
/// caller having to create scaffolding first.
fn seed_window(counters: &mut Counters, label: &str) -> WindowPlacement {
    counters.clusters += 1;
    counters.panes += 1;
    let cluster_id = format!("cluster-{}", counters.clusters);
    let cluster = Cluster {
        id: cluster_id.clone(),
        // Renamed to the project's name once one is open — `lib.rs` does that
        // after `project::restore`, since only then is there a name to use.
        name: "Workspace".to_string(),
        tree: PaneNode::leaf(format!("pane-{}", counters.panes)),
        // No project. A seeded window is one nobody has pointed anywhere yet,
        // and Home is what points it — see `set_cluster_project`.
        project: None,
        worktree: None,
    };

    WindowPlacement {
        label: label.to_string(),
        clusters: vec![cluster],
        active_cluster_id: Some(cluster_id),
        active_terminal: None,
        geometry: None,
    }
}

impl ShellState {
    pub fn snapshot(&self) -> ShellSnapshot {
        self.inner.read().expect("shell state lock poisoned").clone()
    }

    /// Replace the whole state — the one door restoring a saved session uses.
    ///
    /// Takes the counters too, because ids restored from disk must not be
    /// mintable again: a fresh `files-1` handed out beside a restored `files-1`
    /// would put two surfaces behind one id, and every message for either would
    /// reach whichever the lookup found first.
    pub fn restore(&self, snapshot: ShellSnapshot) {
        {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            *counters = counters_for(&snapshot);
        }
        let mut snapshot = snapshot;
        // A file written by an older build has the panel's selection on the
        // cluster, so every window comes back with none. `mutate` fixes this up
        // after every change; a restore is the one way state arrives without
        // going through it.
        reseat_active_terminals(&mut snapshot);
        *self.inner.write().expect("shell state lock poisoned") = snapshot;
    }

    /// Run a mutation, tell every window, and write it down.
    ///
    /// Every public mutator goes through this, which is what guarantees no
    /// change can land without a broadcast — the bug where one window updates
    /// and the others don't is not expressible.
    ///
    /// The write lock is dropped before the emit: `emit` reaches into Tauri's
    /// event machinery, and holding a lock across a call that might itself want
    /// to read this state is how a deadlock gets written.
    ///
    /// Every mutation is followed by `reseat_active_terminals`, so that "a
    /// window's panel selection names one of that window's panel terminals" is
    /// a property of the state rather than something each mutator has to
    /// remember. Closing a terminal, closing the cluster a terminal was dragged
    /// into, moving one between windows and dragging one into a pane all
    /// invalidate it, and only one of them is obviously about the panel.
    fn mutate<F: FnOnce(&mut ShellSnapshot)>(&self, app: &AppHandle, f: F) {
        let updated = {
            let mut guard = self.inner.write().expect("shell state lock poisoned");
            f(&mut guard);
            reseat_active_terminals(&mut guard);
            guard.clone()
        };
        let _ = app.emit(SHELL_STATE_EVENT, &updated);
        crate::shell_store::persist(app, &updated);
    }

    // --- windows -----------------------------------------------------------

    pub fn claim_window_label(&self) -> String {
        let mut counters = self.counters.write().expect("counter lock poisoned");
        counters.windows += 1;
        format!("win-{}", counters.windows)
    }

    /// Announce that a window is about to be closed on purpose. See `closing`.
    pub fn mark_closing(&self, label: &str) {
        let mut closing = self.closing.write().expect("closing lock poisoned");
        if !closing.iter().any(|l| l == label) {
            closing.push(label.to_string());
        }
    }

    fn take_closing(&self, label: &str) -> bool {
        let mut closing = self.closing.write().expect("closing lock poisoned");
        let Some(i) = closing.iter().position(|l| l == label) else {
            return false;
        };
        closing.remove(i);
        true
    }

    /// Register a new, empty window — File > New Window's half of the work.
    ///
    /// Seeded with a cluster, unlike the window `detach_instance` builds, which
    /// is handed one holding the surface that was dragged out. A window with no
    /// clusters is a legal state now — closing the last one gets you there —
    /// but it is not a sensible thing to *open*: File > New Window that landed
    /// on the empty state would have asked the user to undo a step of its own
    /// making.
    pub fn add_window(&self, app: &AppHandle, label: &str) {
        let seed = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            seed_window(&mut counters, label)
        };
        self.mutate(app, |s| {
            if s.windows.iter().any(|w| w.label == label) {
                return;
            }
            s.windows.push(seed.clone());
        });
    }

    pub fn set_geometry(&self, label: &str, geometry: WindowGeometry) {
        // Not through `mutate`: a move or resize fires continuously while the
        // user drags, and broadcasting the whole state to every window on every
        // frame of that would be a storm no window needs to see. The value is
        // only ever read back at launch, so recording it and skipping both the
        // broadcast and the disk write is exactly right — the next real
        // mutation persists it, and so does a window closing (`flush` for
        // `main`, `reclaim_window`'s own `mutate` for anything else — see
        // `windows::request_close`).
        let mut guard = self.inner.write().expect("shell state lock poisoned");
        if let Some(w) = guard.windows.iter_mut().find(|w| w.label == label) {
            w.geometry = Some(geometry);
        }
    }

    /// Write the current state to disk without changing it.
    ///
    /// The counterpart to `set_geometry`'s deliberate silence: something has to
    /// commit those quiet updates eventually, and a window closing on purpose
    /// is the last chance to.
    pub fn flush(&self, app: &AppHandle) {
        crate::shell_store::persist(app, &self.snapshot());
    }

    /// Fold a closing window's clusters into the main window, so nothing is
    /// stranded in a window that is no longer on screen.
    ///
    /// Returns `false` — and changes nothing — when the close was not marked
    /// through `mark_closing`, which means the window is not actually closing
    /// on purpose. See the `closing` field.
    ///
    /// `windows::request_close` calls this itself, synchronously, from
    /// `WindowEvent::CloseRequested` — before the window is actually gone, so
    /// a closed window can never be resurrected by a later flush of state
    /// that still lists it. `windows::reclaim` calls it again from
    /// `WindowEvent::Destroyed`, once the window actually finishes closing,
    /// but by then `take_closing` has already consumed the marker, so that
    /// second call is normally a no-op; it remains as the fallback for a
    /// window the OS destroys directly, without a `CloseRequested` first.
    pub fn reclaim_window(&self, app: &AppHandle, label: &str) -> bool {
        if label == "main" || !self.take_closing(label) {
            return false;
        }
        self.mutate(app, |s| {
            let Some(i) = s.windows.iter().position(|w| w.label == label) else {
                return;
            };
            let gone = s.windows.remove(i);
            // The panel's terminals come home too. They belong to the window,
            // not to any of the clusters being folded in, so nothing else would
            // move them — and a terminal whose label names a window that is no
            // longer there is a live shell with no tab anywhere on screen.
            for t in s.terminals.iter_mut() {
                if t.window_label == label {
                    t.window_label = "main".to_string();
                }
            }
            if let Some(main) = s.windows.iter_mut().find(|w| w.label == "main") {
                if main.active_cluster_id.is_none() {
                    main.active_cluster_id = gone.clusters.first().map(|c| c.id.clone());
                }
                main.clusters.extend(gone.clusters);
            }
        });
        true
    }

    // --- clusters ----------------------------------------------------------

    pub fn add_cluster(&self, app: &AppHandle, label: &str, name: &str) -> Option<String> {
        let (cluster_id, pane_id) = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            counters.clusters += 1;
            counters.panes += 1;
            (
                format!("cluster-{}", counters.clusters),
                format!("pane-{}", counters.panes),
            )
        };

        let mut created = None;
        self.mutate(app, |s| {
            let Some(w) = s.windows.iter_mut().find(|w| w.label == label) else {
                return;
            };
            w.clusters.push(Cluster {
                id: cluster_id.clone(),
                name: name.to_string(),
                tree: PaneNode::leaf(pane_id.clone()),
                // Deliberately empty, and deliberately *not* inherited from the
                // cluster this one was added beside. A new cluster is a new
                // piece of work; if it were meant to be about the same project
                // it would have been a pane in the one already open. Home opens
                // in it (see `commands::add_cluster`) and offers the picker.
                project: None,
                worktree: None,
            });
            w.active_cluster_id = Some(cluster_id.clone());
            created = Some(cluster_id.clone());
        });
        created
    }

    pub fn set_active_cluster(&self, app: &AppHandle, label: &str, cluster_id: Option<String>) {
        self.mutate(app, |s| {
            let Some(w) = s.windows.iter_mut().find(|w| w.label == label) else {
                return;
            };
            // A cluster this window does not hold is not something it can show.
            // The guard is not hypothetical: a chip's drag ends with a
            // `pointerup` on the chip, so the browser fires a `click` on it too,
            // and that click asks to select a cluster that has just been dragged
            // into another window. Honouring it would leave the source window
            // pointing at a cluster that is not in it — no tree, no panel, an
            // empty frame — and nothing would ever correct it.
            if cluster_id
                .as_deref()
                .is_some_and(|id| !w.clusters.iter().any(|c| c.id == id))
            {
                return;
            }
            w.active_cluster_id = cluster_id;
        });
    }

    /// Point a cluster at a project, or at nothing.
    ///
    /// Through `mutate` like every other cluster change, which is what makes a
    /// project switch reach every window and reach `layout.json` — the same
    /// guarantee the tree gets, and the reason this is a `ShellState` method
    /// rather than something `project` writes into a store of its own. A
    /// project that only the window that opened it knew about would be the
    /// exact bug the per-cluster model exists to prevent, in miniature.
    ///
    /// Silent when `cluster_id` names nothing: a cluster can be closed while a
    /// picker is up, and the honest answer to "set the project of a cluster
    /// that is gone" is that there is nothing to set.
    pub fn set_cluster_project(&self, app: &AppHandle, cluster_id: &str, path: Option<String>) {
        self.mutate(app, |s| {
            for w in s.windows.iter_mut() {
                if let Some(c) = w.cluster_mut(cluster_id) {
                    c.project = path;
                    return;
                }
            }
        });
    }

    /// The project a cluster is pointed at, exactly as stored. `None` both for
    /// a cluster with no project and for an id that names no cluster — the
    /// caller wants somewhere to work, and neither answer gives it one.
    pub fn cluster_project(&self, cluster_id: &str) -> Option<String> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard
            .windows
            .iter()
            .flat_map(|w| w.clusters.iter())
            .find(|c| c.id == cluster_id)
            .and_then(|c| c.project.clone())
    }

    /// Which cluster holds `instance_id` — the whole of "which project is this
    /// app call about".
    ///
    /// The tree is the only thing that answers it, and deliberately: an
    /// instance is in whichever cluster's `tree` contains its id and nowhere
    /// else, so this is a search of the same structure `move_instance` moves
    /// tabs around in, using the same `PaneNode::tabs` walk `close_cluster`
    /// already uses to decide what a closing cluster took with it. No second
    /// field records the answer, so no second field can disagree with it.
    pub fn cluster_of_instance(&self, instance_id: &str) -> Option<String> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        cluster_of_instance_pure(&guard, instance_id)
    }

    /// The project of the cluster a window is *showing*.
    ///
    /// What a terminal opens in, and what the OS window title names. A terminal
    /// belongs to the window's panel rather than to any cluster (see the module
    /// doc), so "the project" for one is a question about the window, answered
    /// at the moment it is asked — a panel terminal outlives the cluster it was
    /// opened beside, and this deliberately does not follow it afterwards.
    pub fn active_cluster_project(&self, label: &str) -> Option<String> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        let w = guard.windows.iter().find(|w| w.label == label)?;
        let active = w.active_cluster_id.as_deref()?;
        w.clusters
            .iter()
            .find(|c| c.id == active)
            .and_then(|c| c.project.clone())
    }

    /// Every window, with the project of whatever cluster it is showing. What
    /// `project::retitle` walks — one read of the lock rather than one per
    /// window, and no `ShellSnapshot` clone for a pair of strings.
    pub fn window_projects(&self) -> Vec<(String, Option<String>)> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard
            .windows
            .iter()
            .map(|w| {
                let project = w
                    .active_cluster_id
                    .as_deref()
                    .and_then(|id| w.clusters.iter().find(|c| c.id == id))
                    .and_then(|c| c.project.clone());
                (w.label.clone(), project)
            })
            .collect()
    }

    /// The first cluster of the main window, for the one-time migration in
    /// `lib.rs` that moves the old global open project onto a cluster.
    pub fn first_cluster_id(&self) -> Option<String> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard
            .windows
            .iter()
            .find(|w| w.label == "main")
            .or_else(|| guard.windows.first())
            .and_then(|w| w.clusters.first())
            .map(|c| c.id.clone())
    }

    /// Whether any cluster anywhere is pointed at a project. The migration's
    /// guard — see `lib.rs`.
    pub fn any_cluster_has_a_project(&self) -> bool {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard
            .windows
            .iter()
            .flat_map(|w| w.clusters.iter())
            .any(|c| c.project.is_some())
    }

    pub fn rename_cluster(&self, app: &AppHandle, cluster_id: &str, name: &str) {
        self.mutate(app, |s| {
            for w in s.windows.iter_mut() {
                if let Some(c) = w.cluster_mut(cluster_id) {
                    c.name = name.to_string();
                    return;
                }
            }
        });
    }

    /// Close a cluster and everything in it. Returns the instance and terminal
    /// ids that went with it, so the caller can dispose of what sat behind them
    /// — a pty in particular, which this module deliberately knows nothing
    /// about and must not be left running with nothing on screen for it.
    ///
    /// "In it" means *in its tree*, terminals included. A terminal in the panel
    /// is the window's and outlives every cluster in it: killing those here
    /// would take out the shell you had watching another worktree because you
    /// closed a cluster it was never part of. Only a terminal that was dragged
    /// into this cluster's layout goes with it — it is on screen inside the
    /// thing being closed, exactly like an app instance is.
    ///
    /// **The last cluster in a window may be closed.** There is no guard here
    /// and its absence is deliberate: a window that answered "no, it is the only
    /// one" would be refusing the one thing the × means. What it is left with is
    /// an empty app area and a working terminal panel, which is a state someone
    /// can act from — `NoClustersState` says so and names the way out.
    ///
    /// `move_cluster_pure` reaches the same window state by the other route, and
    /// deliberately: it used to refuse to move the last cluster out, on the
    /// grounds that emptying the source was a side effect nobody asked for, and
    /// that refusal is gone. The two now agree, which is one fewer rule to hold
    /// and one fewer gesture the interface has to hide.
    pub fn close_cluster(&self, app: &AppHandle, cluster_id: &str) -> (Vec<String>, Vec<String>) {
        let mut instances = Vec::new();
        let mut terminals = Vec::new();

        self.mutate(app, |s| {
            let Some(w) = s
                .windows
                .iter_mut()
                .find(|w| w.clusters.iter().any(|c| c.id == cluster_id))
            else {
                return;
            };
            let Some(gone) = take_cluster(w, cluster_id) else {
                return;
            };
            let held: Vec<String> = gone.tree.tabs().iter().map(|t| t.to_string()).collect();

            (terminals, instances) = sort_held(held, &s.terminals);
            s.terminals.retain(|t| !terminals.contains(&t.id));
            s.instances.retain(|i| !instances.contains(&i.id));
        });

        (instances, terminals)
    }

    /// Move a whole cluster — its tree, its tabs and all — into another window.
    ///
    /// The window named by `to_label` is used if the state already knows it, and
    /// created if it does not; that second case is a *detach*, and the caller is
    /// then responsible for building the OS window to match. Doing the
    /// bookkeeping first and the window second is the ordering `detach_instance`
    /// already uses, and it is what makes a refusal here cost nothing: no window
    /// is ever built for a move that did not happen.
    ///
    /// Returns whether the cluster is in `to_label` afterwards. `false` means
    /// the move was refused and nothing changed at all — see `move_cluster_pure`
    /// for the two things it refuses and why.
    pub fn move_cluster(&self, app: &AppHandle, cluster_id: &str, to_label: &str) -> bool {
        let mut moved = false;
        self.mutate(app, |s| {
            moved = move_cluster_pure(s, cluster_id, to_label);
        });
        moved
    }

    /// Where a surface opened "here" goes: the active cluster, and a pane in it.
    ///
    /// `pane_id` is the caller's preference and is honoured only if that pane is
    /// actually in this cluster — a stale id from a layout that has since
    /// changed falls back to the first pane rather than to nowhere, which is the
    /// same forgiveness `open_instance` shows a `None`.
    ///
    /// `None` means the window has no cluster at all, which is the one case with
    /// no sensible answer: there is no tree, so there is no pane.
    ///
    /// Exists because a terminal opened into the layout needs both halves of the
    /// address before it has a session to move — `move_instance` names a cluster
    /// *and* a pane, and `commands::open_terminal_in_pane` has only a window
    /// label to start from.
    pub fn active_pane(&self, label: &str, pane_id: Option<&str>) -> Option<(String, String)> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        let w = guard.windows.iter().find(|w| w.label == label)?;
        let active = w.active_cluster_id.as_deref()?;
        let cluster = w.clusters.iter().find(|c| c.id == active)?;

        let pane = pane_id
            .filter(|id| cluster.tree.pane_of_id(id))
            .unwrap_or_else(|| cluster.tree.first_pane_id())
            .to_string();

        Some((cluster.id.clone(), pane))
    }

    // --- presets -----------------------------------------------------------
    //
    // Two halves of one feature, and both of them are deliberately thin: the
    // model, the merge and the placement rule are all in `crate::presets`, as
    // pure functions over plain data that are tested as such. What is here is
    // the part that cannot be — reading the active cluster under the lock, and
    // minting ids from `Counters`. `layout` and this module already split that
    // way; see `layout`'s header.

    /// The active cluster's arrangement, in the form a preset stores it.
    ///
    /// `None` when the window has no cluster: there is no arrangement to save,
    /// which is a different answer from "an empty one".
    ///
    /// The tab-to-slot resolution happens here rather than in `presets` because
    /// this is where it can be answered. A tab is an id and nothing else; what
    /// it *is* lives in the flat `instances` and `terminals` lists, which
    /// `presets` has deliberately never heard of.
    pub fn capture_preset(&self, label: &str) -> Option<presets::PresetNode> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        let w = guard.windows.iter().find(|w| w.label == label)?;
        let active = w.active_cluster_id.as_deref()?;
        let cluster = w.clusters.iter().find(|c| c.id == active)?;

        Some(presets::capture(&cluster.tree, &|id: &str| {
            slot_of_tab(&guard, id)
        }))
    }

    /// Rearrange the active cluster into `root`, and say what is still missing.
    ///
    /// Returns the cluster it acted on and the slots it had nothing to fill, or
    /// `None` when the window has no cluster to act on. **Nothing is closed** —
    /// see `presets::plan`, which is where that rule is written down and tested.
    ///
    /// The gaps come back rather than being filled here, and that is not an
    /// oversight: filling one means minting an instance *or spawning a pty*, and
    /// a pty lives in `PtySessions`, which this module knows nothing about and
    /// must not start knowing about — a `ShellState` that could spawn processes
    /// is a `ShellState` that cannot be tested against a bare snapshot.
    /// `commands::apply_preset` fills them through the same public doors
    /// everything else opens surfaces through.
    pub fn apply_preset(
        &self,
        app: &AppHandle,
        label: &str,
        root: &presets::PresetNode,
    ) -> Option<(String, Vec<presets::Gap>)> {
        // Minted before the lock, exactly as `split_with_instance` does it, and
        // exactly as many as the shape needs. Ids handed out for an apply that
        // then finds no cluster are simply skipped, which costs a gap in the
        // numbering and nothing else — a counter that went backwards on a
        // refusal would be the far worse trade.
        let mut ids = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            let panes = (0..root.pane_count())
                .map(|_| {
                    counters.panes += 1;
                    format!("pane-{}", counters.panes)
                })
                .collect();
            let splits = (0..root.split_count())
                .map(|_| {
                    counters.splits += 1;
                    format!("split-{}", counters.splits)
                })
                .collect();
            presets::Ids::new(panes, splits)
        };

        let mut applied = None;
        self.mutate(app, |s| {
            // Destructured so the tree can be read against the two flat lists
            // without one borrow of `s` shutting out the other — the same split
            // `reseat_active_terminals` takes, for the same reason.
            let ShellSnapshot {
                windows,
                instances,
                terminals,
                ..
            } = s;

            let Some(w) = windows.iter_mut().find(|w| w.label == label) else {
                return;
            };
            let Some(cluster) = w.active_cluster_mut() else {
                return;
            };

            let existing: Vec<presets::Existing> = cluster
                .tree
                .tabs()
                .iter()
                .map(|id| presets::Existing {
                    instance_id: (*id).to_string(),
                    fills: resolve_slot(instances, terminals, id),
                })
                .collect();

            let (tree, gaps) = presets::plan(root, &existing, &mut ids);
            cluster.tree = tree;
            applied = Some((cluster.id.clone(), gaps));
        });
        applied
    }

    // --- instances ---------------------------------------------------------

    /// Mint an instance and put it on screen.
    ///
    /// `pane_id` names which pane the open is *relative to*; `None` falls back
    /// to the active cluster's first pane. It used to mean "and put it in that
    /// pane", which is no longer what an open does — see `dir`.
    ///
    /// `dir` is the axis the frontend measured the target pane along, and
    /// passing one asks for the surface to get a **pane of its own** beside it
    /// rather than a tab inside it. `PaneNode::open_into` owns that rule, the
    /// two cases that refuse it, and the ceiling; nothing about it is decided
    /// here. `None` is the old behaviour, and is what the callers with no pane
    /// on screen to measure pass: seeding a window, seeding a cluster, and
    /// filling a preset's gap — a preset builds its own tree and must not have
    /// this splitting underneath it.
    pub fn open_instance(
        &self,
        app: &AppHandle,
        label: &str,
        app_id: &str,
        kind: SurfaceKind,
        title: &str,
        pane_id: Option<&str>,
        dir: Option<SplitDir>,
    ) -> Option<String> {
        // Both taken before `mutate` takes the state lock, which is the order
        // every other minting site here uses and is not merely convention:
        // `counters` is a second lock, and taking it *inside* the closure would
        // invert the order these two are acquired in everywhere else — the
        // classic way to write a deadlock that only shows up under two windows
        // opening at once.
        let instance_id = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            let ordinal = counters.instances.entry(app_id.to_string()).or_insert(0);
            *ordinal += 1;
            format!("{app_id}-{ordinal}")
        };
        // Only when a split is actually being asked for. `open_into` may still
        // decline it — an empty pane, or the ceiling — and the pair is then
        // simply unused, which costs a gap in the numbering and nothing else.
        // Minting unconditionally would burn two ids on every Home seed.
        let split_ids = dir.map(|_| {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            counters.splits += 1;
            counters.panes += 1;
            (
                format!("split-{}", counters.splits),
                format!("pane-{}", counters.panes),
            )
        });

        let mut opened = None;
        self.mutate(app, |s| {
            let Some(w) = s.windows.iter_mut().find(|w| w.label == label) else {
                return;
            };
            let Some(cluster) = w.active_cluster_mut() else {
                return;
            };

            let target = pane_id
                .map(str::to_string)
                .unwrap_or_else(|| cluster.tree.first_pane_id().to_string());

            let split = match (dir, &split_ids) {
                (Some(dir), Some((split_id, new_pane_id))) => {
                    Some((dir, split_id.as_str(), new_pane_id.as_str()))
                }
                _ => None,
            };

            if !cluster.tree.open_into(&target, &instance_id, None, split) {
                return;
            }

            s.instances.push(SurfaceInstance {
                id: instance_id.clone(),
                app_id: app_id.to_string(),
                kind,
                title: title.to_string(),
            });
            opened = Some(instance_id.clone());
        });
        opened
    }

    /// Take an instance off screen. Returns true if it was there.
    pub fn close_instance(&self, app: &AppHandle, instance_id: &str) -> bool {
        let mut found = false;
        self.mutate(app, |s| {
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    if c.tree.remove_tab(instance_id) {
                        found = true;
                    }
                }
            }
            if found {
                s.instances.retain(|i| i.id != instance_id);
            }
        });
        found
    }

    pub fn activate_instance(&self, app: &AppHandle, instance_id: &str) {
        self.mutate(app, |s| {
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    if c.tree.activate_tab(instance_id) {
                        // Showing a tab in a cluster nobody is looking at is
                        // not showing it. Bring its cluster forward too.
                        w.active_cluster_id = Some(c.id.clone());
                        return;
                    }
                }
            }
        });
    }

    pub fn set_instance_title(&self, app: &AppHandle, instance_id: &str, title: &str) {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return;
        }
        // Guarded like `set_terminal_title`, and for the same reason: a
        // frontend that reports its title on every render must not broadcast
        // the whole state to every window for no visible change.
        {
            let guard = self.inner.read().expect("shell state lock poisoned");
            match guard.instances.iter().find(|i| i.id == instance_id) {
                Some(i) if i.title == trimmed => return,
                None => return,
                _ => {}
            }
        }
        self.mutate(app, |s| {
            if let Some(i) = s.instances.iter_mut().find(|i| i.id == instance_id) {
                i.title = trimmed.to_string();
            }
        });
    }

    /// Move an instance to a pane — within its cluster, or into another
    /// window's. `index` is where in the target strip it lands.
    pub fn move_instance(
        &self,
        app: &AppHandle,
        instance_id: &str,
        to_cluster: &str,
        to_pane: &str,
        index: Option<usize>,
    ) -> bool {
        let mut moved = false;
        self.mutate(app, |s| {
            // Removed from wherever it was before it is inserted anywhere, so
            // a move within one pane cannot leave two copies behind. `layout`
            // makes the same guarantee for the same-pane case; doing it here
            // as well is what makes the cross-pane case safe.
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    if c.id != to_cluster {
                        c.tree.remove_tab(instance_id);
                    }
                }
            }

            for w in s.windows.iter_mut() {
                if let Some(c) = w.cluster_mut(to_cluster) {
                    moved = c.tree.insert_tab(to_pane, instance_id, index);
                    if moved {
                        w.active_cluster_id = Some(to_cluster.to_string());
                    }
                    return;
                }
            }
        });
        moved
    }

    /// Split a pane and put an instance in the new half — the drop-on-an-edge
    /// gesture. The instance is removed from wherever it was first, so this
    /// works both for a fresh surface and for a tab dragged out of a neighbour.
    ///
    /// **Nothing is touched unless `pane_id` is actually somewhere.** The removal
    /// used to run unconditionally, ahead of a search that could come up empty,
    /// which made a drop naming a pane that no longer exists *delete the tab that
    /// was dropped*: it left every tree, no split took it, and the broadcast went
    /// out with the surface belonging to nothing. That was reachable — the drop
    /// zone registry was handing out stale pane ids until recently (see
    /// `dropZones.ts`) — and a gesture whose failure mode is losing the thing you
    /// dragged has no business being ordered this way even when nothing is
    /// handing it bad input.
    ///
    /// Returns whether the split happened. The caller surfaces `false`; a drop
    /// that silently does nothing is the hardest kind of failure to report.
    pub fn split_with_instance(
        &self,
        app: &AppHandle,
        pane_id: &str,
        dir: SplitDir,
        instance_id: &str,
        before: bool,
    ) -> bool {
        let (split_id, new_pane_id) = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            counters.splits += 1;
            counters.panes += 1;
            (
                format!("split-{}", counters.splits),
                format!("pane-{}", counters.panes),
            )
        };

        let mut split = false;
        self.mutate(app, |s| {
            // Look before leaping. A pane nobody holds means the drop named
            // somewhere that is not on screen, and the right answer to that is to
            // change nothing at all — see the doc comment for what the other
            // order cost.
            let known = s
                .windows
                .iter()
                .flat_map(|w| w.clusters.iter())
                .any(|c| c.tree.holds_pane(pane_id));
            if !known {
                return;
            }

            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    c.tree.remove_tab(instance_id);
                }
            }
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    if c.tree
                        .split_pane(pane_id, dir, &split_id, &new_pane_id, instance_id, before)
                    {
                        w.active_cluster_id = Some(c.id.clone());
                        split = true;
                        return;
                    }
                }
            }
        });
        split
    }

    pub fn set_pane_sizes(&self, app: &AppHandle, split_id: &str, sizes: Vec<f32>) {
        self.mutate(app, |s| {
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    if c.tree.set_sizes(split_id, &sizes) {
                        return;
                    }
                }
            }
        });
    }

    /// Pull an instance out into a window of its own, taking a fresh cluster
    /// with it. Returns false if the instance is not on screen anywhere, which
    /// is the caller's signal not to build a window for it — doing the
    /// bookkeeping first and the window second means a failed lookup cannot
    /// leave an empty frame on screen.
    pub fn detach_instance(&self, app: &AppHandle, instance_id: &str, new_label: &str) -> bool {
        let (cluster_id, pane_id) = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            counters.clusters += 1;
            counters.panes += 1;
            (
                format!("cluster-{}", counters.clusters),
                format!("pane-{}", counters.panes),
            )
        };

        let mut detached = false;
        self.mutate(app, |s| {
            if !s.instances.iter().any(|i| i.id == instance_id)
                && !s.terminals.iter().any(|t| t.id == instance_id)
            {
                return;
            }

            let name = s
                .instances
                .iter()
                .find(|i| i.id == instance_id)
                .map(|i| i.title.clone())
                .or_else(|| {
                    s.terminals
                        .iter()
                        .find(|t| t.id == instance_id)
                        .map(|t| t.title.clone())
                })
                .unwrap_or_else(|| "Workspace".to_string());

            // The project the surface was already working in, read *before* the
            // tab is pulled out of the tree that answers this.
            //
            // Inherited here where `add_cluster` deliberately does not inherit,
            // and the two are not inconsistent: adding a cluster starts a new
            // piece of work, while detaching *moves an existing surface* that is
            // already rooted somewhere. A Files dragged onto a second monitor
            // that came back rooted at nothing would read as the drag having
            // broken it.
            let project = s
                .windows
                .iter()
                .flat_map(|w| w.clusters.iter())
                .find(|c| c.tree.tabs().iter().any(|t| *t == instance_id))
                .and_then(|c| c.project.clone());

            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    c.tree.remove_tab(instance_id);
                }
            }

            let mut tree = PaneNode::leaf(pane_id.clone());
            tree.insert_tab(&pane_id, instance_id, None);

            let cluster = Cluster {
                id: cluster_id.clone(),
                name,
                tree,
                project,
                worktree: None,
            };

            // A terminal dragged out has to bring its panel home with it. It is
            // drawn in the new window's tree, so it is not in a panel at all
            // right now — but the moment it is dragged back out of that tree it
            // lands in one, and it must be the panel of the window it is
            // actually on screen in.
            if let Some(t) = s.terminals.iter_mut().find(|t| t.id == instance_id) {
                t.window_label = new_label.to_string();
            }

            match s.windows.iter_mut().find(|w| w.label == new_label) {
                Some(w) => {
                    w.clusters.push(cluster);
                    w.active_cluster_id = Some(cluster_id.clone());
                }
                None => s.windows.push(WindowPlacement {
                    label: new_label.to_string(),
                    clusters: vec![cluster],
                    active_cluster_id: Some(cluster_id.clone()),
                    active_terminal: None,
                    geometry: None,
                }),
            }
            detached = true;
        });
        detached
    }

    // --- terminals ---------------------------------------------------------

    /// Claim the next session id and its ordinal, without creating anything.
    ///
    /// Split from `add_terminal` so a pty can be spawned *between* the two. The
    /// id is what names the pty, and a session must not appear in the shared
    /// state until there is a real shell behind it — otherwise a failed spawn
    /// leaves a tab that looks alive and silently eats every keystroke.
    pub fn claim_terminal_id(&self) -> (String, u32) {
        let mut counters = self.counters.write().expect("counter lock poisoned");
        counters.terminals += 1;
        (format!("term-{}", counters.terminals), counters.terminals)
    }

    /// Does this label name a window? Asked before a terminal is opened into
    /// one: a session whose label matches nothing is a shell running with no
    /// panel anywhere that would draw its tab.
    pub fn has_window(&self, label: &str) -> bool {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard.windows.iter().any(|w| w.label == label)
    }

    /// Publish a session whose shell is already running.
    pub fn add_terminal(&self, app: &AppHandle, id: &str, title: &str, label: &str) {
        self.mutate(app, |s| {
            s.terminals.push(TerminalSession {
                id: id.to_string(),
                title: title.to_string(),
                window_label: label.to_string(),
                agent_finished: false,
                group_id: None,
            });
            if let Some(w) = s.windows.iter_mut().find(|w| w.label == label) {
                w.active_terminal = Some(id.to_string());
            }
        });
    }

    /// Publish a session **straight into a cluster's tree**, never into a panel.
    ///
    /// The counterpart of [`add_terminal`](Self::add_terminal) for the Apps
    /// menu's Terminal row and for a preset's terminal slot, and it is one
    /// mutation rather than "add it, then move it" for a reason that is visible
    /// on screen. `add_terminal` selects what it just opened, because the panel's
    /// `+` should show you the terminal you asked for. Doing that and then moving
    /// the session into a pane broadcasts twice: the panel jumps to a terminal
    /// that is about to leave it, and `reseat_active_terminals` then repairs the
    /// selection to *some* panel terminal, which is not necessarily the one you
    /// were reading. Opening a terminal in a pane would change which terminal the
    /// panel is showing — a side effect nobody asked for, and a visible flicker
    /// on the way to it.
    ///
    /// So there is no intermediate state. The session is published with its id
    /// already in the tree, `reseat_active_terminals` sees the finished picture,
    /// finds the window's existing panel selection still valid, and leaves it
    /// exactly where it was.
    ///
    /// A `pane_id` that no longer names a pane leaves the session in the panel
    /// instead of nowhere. That is a real shell with a tab you can find, which is
    /// the failure worth having — the alternative is a live process with nothing
    /// on screen for it.
    ///
    /// `dir` asks for a pane of its own rather than a tab, on exactly the terms
    /// `open_instance` above does and through the same `PaneNode::open_into`.
    /// The Apps menu lists Terminal beside the apps, so a row in that menu that
    /// split and a row that stacked would be two behaviours in one list. A
    /// preset's terminal slot passes `None` with an `index`, because a preset
    /// has already decided the shape.
    #[allow(clippy::too_many_arguments)]
    pub fn add_terminal_in_pane(
        &self,
        app: &AppHandle,
        id: &str,
        title: &str,
        label: &str,
        cluster_id: &str,
        pane_id: &str,
        index: Option<usize>,
        dir: Option<SplitDir>,
    ) {
        // Before the lock, for the reason `open_instance` writes out in full.
        let split_ids = dir.map(|_| {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            counters.splits += 1;
            counters.panes += 1;
            (
                format!("split-{}", counters.splits),
                format!("pane-{}", counters.panes),
            )
        });

        self.mutate(app, |s| {
            s.terminals.push(TerminalSession {
                id: id.to_string(),
                title: title.to_string(),
                window_label: label.to_string(),
                agent_finished: false,
                group_id: None,
            });
            let split = match (dir, &split_ids) {
                (Some(dir), Some((split_id, new_pane_id))) => {
                    Some((dir, split_id.as_str(), new_pane_id.as_str()))
                }
                _ => None,
            };
            for w in s.windows.iter_mut() {
                if let Some(c) = w.cluster_mut(cluster_id) {
                    c.tree.open_into(pane_id, id, index, split);
                    return;
                }
            }
        });
    }

    pub fn close_terminal(&self, app: &AppHandle, id: &str) {
        self.mutate(app, |s| {
            close_terminal_pure(&mut s.terminals, id);
            // A terminal that had been dragged into the layout is a tab too.
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    c.tree.remove_tab(id);
                }
            }
            // Whichever panel was pointing at it is re-seated by `mutate`.
        });
    }

    /// Which window a session sits in, for the split command — it opens the
    /// new pty beside the one it is splitting from, and the caller has no other
    /// way to know where that is.
    pub fn window_of_terminal(&self, id: &str) -> Option<String> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard
            .terminals
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.window_label.clone())
    }

    /// Put `id` into `sibling_id`'s group, creating one if `sibling_id` doesn't
    /// already have one. `None` if `sibling_id` is no longer a live session —
    /// its tab could have closed while the new pty was spawning.
    pub fn group_with(&self, app: &AppHandle, sibling_id: &str, id: &str) -> Option<String> {
        let mut assigned = None;
        self.mutate(app, |s| {
            assigned = group_with_pure(&mut s.terminals, sibling_id, id);
        });
        assigned
    }

    /// Move a terminal into another window's panel.
    pub fn move_terminal(&self, app: &AppHandle, id: &str, to_label: &str) {
        self.mutate(app, |s| {
            // Leaving the tree is part of moving: a terminal dragged from a
            // pane back into a panel must stop being a tab, or it would draw in
            // both places at once.
            for w in s.windows.iter_mut() {
                for c in w.clusters.iter_mut() {
                    c.tree.remove_tab(id);
                }
            }
            if let Some(t) = s.terminals.iter_mut().find(|t| t.id == id) {
                t.window_label = to_label.to_string();
            }
            if let Some(w) = s.windows.iter_mut().find(|w| w.label == to_label) {
                w.active_terminal = Some(id.to_string());
            }
        });
    }

    /// Which terminal a window's panel is showing.
    pub fn set_active_terminal(&self, app: &AppHandle, label: &str, id: Option<String>) {
        self.mutate(app, |s| {
            if let Some(w) = s.windows.iter_mut().find(|w| w.label == label) {
                w.active_terminal = id;
            }
        });
    }

    pub fn set_engine(&self, app: &AppHandle, engine: EngineState) {
        self.mutate(app, |s| s.engine = engine);
    }

    /// A terminal's own program set its title (an OSC `0`/`2` escape sequence),
    /// and the emulator that saw it is reporting up.
    ///
    /// The OSC parsing happens in xterm.js, not here — it ships a tested parser
    /// that already copes with a title sequence split across two pty reads.
    /// What belongs here is ownership of the result: a terminal can be dragged
    /// into another window, so the title has to outlive whichever window first
    /// heard it.
    ///
    /// Two guards, both load-bearing: an empty title is dropped rather than
    /// stored, so a report racing a tab close can never blank the shell-name
    /// fallback `open_terminal` gave the tab; and a title identical to what is
    /// already stored is dropped too, so a shell that rewrites its title on
    /// every prompt doesn't broadcast to every window for no visible change.
    /// That second check is why this doesn't go through `mutate` — `mutate`'s
    /// contract is to broadcast unconditionally, and a no-op here must
    /// broadcast nothing.
    pub fn set_terminal_title(&self, app: &AppHandle, id: &str, title: &str) {
        let shortened = shorten_title(title);
        if shortened.is_empty() {
            return;
        }

        let updated = {
            let mut guard = self.inner.write().expect("shell state lock poisoned");
            let Some(t) = guard.terminals.iter_mut().find(|t| t.id == id) else {
                return;
            };
            if t.title == shortened {
                return;
            }
            t.title = shortened;
            guard.clone()
        };
        let _ = app.emit(SHELL_STATE_EVENT, &updated);
        crate::shell_store::persist(app, &updated);
    }
}

/// Which cluster holds `instance_id`. The whole of `ShellState::
/// cluster_of_instance` minus the lock, so it can be tested against a bare
/// `ShellSnapshot` — the same split `move_cluster_pure` has, for the same
/// reason.
///
/// Searches every window, not just the calling one. A surface's cluster is a
/// fact about the tree it is in, and an app frame asking a question has no idea
/// which OS window it ended up in — nor should it need one.
fn cluster_of_instance_pure(s: &ShellSnapshot, instance_id: &str) -> Option<String> {
    s.windows
        .iter()
        .flat_map(|w| w.clusters.iter())
        .find(|c| c.tree.tabs().iter().any(|t| *t == instance_id))
        .map(|c| c.id.clone())
}

/// What a tab id is, expressed as the slot a preset would use for it.
///
/// The one place that answer is derived, which is what keeps `capture_preset`
/// and `apply_preset` from disagreeing about what a tab is — a disagreement that
/// would show up as a preset saving a terminal and then refusing to recognise
/// the terminal it had just saved.
///
/// `None` for an id that resolves to neither list. That is not a state anything
/// should be able to produce (an instance is in whichever tree holds its id, and
/// the flat lists are what the ids resolve against), and it is deliberately not
/// papered over: `presets::Existing` treats it as filling nothing, so the tab
/// survives as a leftover instead of quietly satisfying a terminal slot.
///
/// A *tool* instance answers `App { app_id }` with a tool's id in it, which no
/// preset can ever contain — `PresetNode::normalized` strips slots naming
/// anything outside `apps::REGISTRY`. So a tool surface is never claimed and
/// always lands in the last pane, which is the right answer for a surface this
/// build cannot mount anyway.
fn resolve_slot(
    instances: &[SurfaceInstance],
    terminals: &[TerminalSession],
    id: &str,
) -> Option<presets::PresetSlot> {
    if let Some(instance) = instances.iter().find(|i| i.id == id) {
        return Some(presets::PresetSlot::App {
            app_id: instance.app_id.clone(),
        });
    }
    terminals
        .iter()
        .any(|t| t.id == id)
        .then_some(presets::PresetSlot::Terminal)
}

/// [`resolve_slot`] against a whole snapshot — what `capture_preset` hands to
/// `presets::capture`, which takes a resolver rather than the lists themselves.
fn slot_of_tab(snapshot: &ShellSnapshot, id: &str) -> Option<presets::PresetSlot> {
    resolve_slot(&snapshot.instances, &snapshot.terminals, id)
}

/// Split the tabs a closing cluster held into `(terminals, instances)`.
///
/// A tree holds both under one kind of id, and the caller disposes of them
/// differently — a terminal has a pty behind it that has to be killed. The
/// input is the cluster's *tree*, never the whole terminal list, which is what
/// keeps a panel terminal out of the answer: it was not on screen inside the
/// cluster being closed, so closing that cluster is not a reason to end it.
fn sort_held(held: Vec<String>, terminals: &[TerminalSession]) -> (Vec<String>, Vec<String>) {
    held.into_iter()
        .partition(|id| terminals.iter().any(|t| &t.id == id))
}

/// Lift a cluster out of a window, and let the window's selection fall to a
/// survivor if it named the one that left.
///
/// The neighbour rule — whatever slid into the vacated position, or the last one
/// — is the same one tabs use, and it is written once here because closing a
/// cluster and moving one to another window are the same event as far as the
/// window losing it is concerned.
fn take_cluster(w: &mut WindowPlacement, cluster_id: &str) -> Option<Cluster> {
    let i = w.clusters.iter().position(|c| c.id == cluster_id)?;
    let gone = w.clusters.remove(i);

    if w.active_cluster_id.as_deref() == Some(cluster_id) {
        w.active_cluster_id = w
            .clusters
            .get(i)
            .or_else(|| w.clusters.last())
            .map(|c| c.id.clone());
    }
    Some(gone)
}

/// Move a cluster into `to_label`'s window, creating that window's entry if it
/// does not have one. The whole of `ShellState::move_cluster`, minus the lock
/// and the broadcast, so that it can be tested against a bare `ShellSnapshot`.
///
/// One refusal, returning `false` with nothing changed: **a cluster nobody
/// holds**, which has already been closed or never existed.
///
/// **The last cluster in a window may be moved out**, and that is a change. It
/// used to be the second refusal, on the reasoning that emptying the source
/// window was a side effect of a gesture that had only named a destination. That
/// reasoning does not survive contact with the machine this feature exists for.
/// A window with no clusters is a legal state — `close_cluster` makes one,
/// `NoClustersState` draws it, and the terminal panel beside it is the window's
/// own and keeps working — so there was no invariant left to defend, only a
/// preference about what a gesture should imply. Against that preference: the
/// whole point of dragging a cluster onto another monitor is that the cluster
/// should be *there* and not *here*, and someone with one cluster open wants
/// that at least as much as someone with four. Refusing them meant the interface
/// had to hide the drag handle to avoid offering a gesture it would not honour,
/// so the feature simply vanished from the window where it was most obviously
/// wanted, with nothing on screen to say why. An empty source window is one +
/// away from useful; a gesture that is not offered is not discoverable at all.
///
/// Moving a cluster to the window it is already in is not a refusal either:
/// nothing happens and `true` is returned, because the cluster *is* where the
/// caller asked for it to be.
///
/// What travels with it: the tree, and therefore every tab in the tree. Terminals
/// among those tabs have their `window_label` rewritten, because that field says
/// which window's *panel* would draw them, and a terminal on screen in window B
/// claiming to belong to A's panel lands in the wrong window the moment it is
/// dragged out of the tree. Instances need no such fixup, and deliberately: they
/// are a flat global list keyed by id, and the tree is the only thing that says
/// where any of them are.
fn move_cluster_pure(s: &mut ShellSnapshot, cluster_id: &str, to_label: &str) -> bool {
    let Some(source) = s
        .windows
        .iter_mut()
        .find(|w| w.clusters.iter().any(|c| c.id == cluster_id))
    else {
        return false;
    };
    if source.label == to_label {
        return true;
    }
    // No count check. `take_cluster` already leaves a window that has just lost
    // its only cluster with `active_cluster_id: None`, which is the same state
    // `close_cluster` leaves and the state `NoClustersState` draws.
    let Some(cluster) = take_cluster(source, cluster_id) else {
        return false;
    };

    let held: Vec<String> = cluster.tree.tabs().iter().map(|t| t.to_string()).collect();
    for t in s.terminals.iter_mut() {
        if held.iter().any(|id| id == &t.id) {
            t.window_label = to_label.to_string();
        }
    }

    match s.windows.iter_mut().find(|w| w.label == to_label) {
        Some(w) => {
            w.active_cluster_id = Some(cluster.id.clone());
            w.clusters.push(cluster);
        }
        None => s.windows.push(WindowPlacement {
            label: to_label.to_string(),
            active_cluster_id: Some(cluster.id.clone()),
            clusters: vec![cluster],
            active_terminal: None,
            geometry: None,
        }),
    }
    true
}

/// Make every window's panel selection name something the panel is drawing.
///
/// Run after every mutation, from `mutate`. The rule it enforces is the one the
/// panel renders by: a window's `active_terminal` is one of *its* terminals, and
/// not one that has been dragged into a pane tree, because a terminal in a tree
/// is a surface in the pane area and the panel does not draw it at all.
///
/// A selection that survives the check is left exactly as it is — this only ever
/// repairs, so a deliberate `set_active_terminal` is never second-guessed. When
/// it does have to repair, it falls back to that window's first panel terminal
/// rather than to nothing, since a panel with sessions in it and none selected
/// shows an empty deck beside a list of tabs.
fn reseat_active_terminals(snapshot: &mut ShellSnapshot) {
    let ShellSnapshot {
        windows, terminals, ..
    } = snapshot;

    for w in windows.iter_mut() {
        // Owned rather than borrowed from the tree, so that nothing is still
        // holding `w` when the selection is written back to it.
        let in_a_tree: Vec<String> = w
            .clusters
            .iter()
            .flat_map(|c| c.tree.tabs())
            .map(str::to_string)
            .collect();
        let label = w.label.clone();
        let is_panel_terminal = |id: &str| {
            terminals
                .iter()
                .any(|t| t.id == id && t.window_label == label)
                && !in_a_tree.iter().any(|held| held == id)
        };

        if w.active_terminal.as_deref().is_some_and(&is_panel_terminal) {
            continue;
        }
        w.active_terminal = terminals
            .iter()
            .map(|t| t.id.as_str())
            .find(|id| is_panel_terminal(id))
            .map(str::to_string);
    }
}

/// Rebuild the id counters from a restored state.
///
/// Every counter is set past the highest id already in use rather than to the
/// count of things present, because a session that opened five Files and closed
/// four still has a live `files-5`, and a counter derived from "one Files
/// exists" would hand out `files-2` and then collide on the next four.
fn counters_for(snapshot: &ShellSnapshot) -> Counters {
    let mut counters = Counters::default();

    for instance in &snapshot.instances {
        if let Some(n) = trailing_ordinal(&instance.id) {
            let slot = counters.instances.entry(instance.app_id.clone()).or_insert(0);
            *slot = (*slot).max(n);
        }
    }
    for terminal in &snapshot.terminals {
        if let Some(n) = trailing_ordinal(&terminal.id) {
            counters.terminals = counters.terminals.max(n);
        }
    }
    for window in &snapshot.windows {
        if let Some(n) = trailing_ordinal(&window.label) {
            counters.windows = counters.windows.max(n);
        }
        for cluster in &window.clusters {
            if let Some(n) = trailing_ordinal(&cluster.id) {
                counters.clusters = counters.clusters.max(n);
            }
            walk_ids(&cluster.tree, &mut counters);
        }
    }

    counters
}

fn walk_ids(node: &PaneNode, counters: &mut Counters) {
    match node {
        PaneNode::Leaf { id, .. } => {
            if let Some(n) = trailing_ordinal(id) {
                counters.panes = counters.panes.max(n);
            }
        }
        PaneNode::Split { id, children, .. } => {
            if let Some(n) = trailing_ordinal(id) {
                counters.splits = counters.splits.max(n);
            }
            for child in children {
                walk_ids(child, counters);
            }
        }
    }
}

/// The number off the end of `files-12`, or `None` for an id that does not end
/// in one. Ids restored from a file this module did not write are not assumed
/// to follow the scheme.
fn trailing_ordinal(id: &str) -> Option<u32> {
    id.rsplit_once('-')?.1.parse().ok()
}

/// ConPTY and PowerShell commonly set a terminal's title to the full working
/// directory rather than a name — `C:\Users\bjsea\...\orchestrator` is a
/// useless tab label where `orchestrator` is a good one. So: when the whole
/// reported title parses as an absolute path, this keeps only its last
/// component; anything else — a program's own chosen name, like a coding
/// harness's session name — passes through untouched.
///
/// "Absolute" is judged loosely on purpose — a leading `/` (POSIX) or a drive
/// letter followed by `:\` or `:/` (Windows) — rather than a strict parse, and
/// both separator styles are recognised regardless of which OS this binary is
/// running on: a Windows shell's report is a Windows path even if this were
/// ever compiled for another platform, and `std::path::Path` would only honour
/// the separator of whatever platform it was built for.
fn shorten_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let bytes = trimmed.as_bytes();
    let is_windows_abs = bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    let is_posix_abs = trimmed.starts_with('/');

    if !is_windows_abs && !is_posix_abs {
        return trimmed.to_string();
    }

    trimmed
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

// --- grouping ----------------------------------------------------------------
//
// Split out of the `&AppHandle`-taking methods above so the logic can be unit
// tested against a bare `Vec<TerminalSession>` — nothing here talks to Tauri,
// and nothing here should have to.

/// Remove `id`, and tidy up the group it leaves behind.
///
/// A group of one is not a group — grouping exists so a split's panes have
/// something to sit beside, and a lone survivor has nothing to. Clearing its
/// `group_id` here is what makes "closing the last member removes the group"
/// true as a matter of state, not just a coincidence of nobody else sharing
/// the id.
fn close_terminal_pure(terminals: &mut Vec<TerminalSession>, id: &str) {
    let group = terminals
        .iter()
        .find(|t| t.id == id)
        .and_then(|t| t.group_id.clone());
    terminals.retain(|t| t.id != id);

    if let Some(gid) = group {
        let mut members = terminals
            .iter_mut()
            .filter(|t| t.group_id.as_deref() == Some(gid.as_str()));
        if let Some(only) = members.next() {
            if members.next().is_none() {
                only.group_id = None;
            }
        }
    }
}

/// Put `id` into `sibling_id`'s group, creating one if `sibling_id` doesn't
/// have one yet. Returns the group id assigned, or `None` if `sibling_id`
/// isn't a live session.
fn group_with_pure(
    terminals: &mut [TerminalSession],
    sibling_id: &str,
    id: &str,
) -> Option<String> {
    let existing = terminals
        .iter()
        .find(|t| t.id == sibling_id)?
        .group_id
        .clone();
    let gid = existing.unwrap_or_else(|| format!("group-{sibling_id}"));

    for t in terminals.iter_mut() {
        if t.id == sibling_id || t.id == id {
            t.group_id = Some(gid.clone());
        }
    }
    Some(gid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, group: Option<&str>) -> TerminalSession {
        in_window("main", id, group)
    }

    fn in_window(label: &str, id: &str, group: Option<&str>) -> TerminalSession {
        TerminalSession {
            id: id.to_string(),
            title: id.to_string(),
            window_label: label.to_string(),
            agent_finished: false,
            group_id: group.map(str::to_string),
        }
    }

    #[test]
    fn splitting_assigns_a_shared_group() {
        let mut terminals = vec![session("term-1", None), session("term-2", None)];
        let gid = group_with_pure(&mut terminals, "term-1", "term-2").expect("term-1 exists");

        assert_eq!(terminals[0].group_id.as_deref(), Some(gid.as_str()));
        assert_eq!(terminals[1].group_id.as_deref(), Some(gid.as_str()));
    }

    #[test]
    fn splitting_reuses_an_existing_group_rather_than_minting_a_second_one() {
        let mut terminals = vec![
            session("term-1", Some("group-term-1")),
            session("term-2", Some("group-term-1")),
            session("term-3", None),
        ];
        let gid = group_with_pure(&mut terminals, "term-1", "term-3").expect("term-1 exists");

        assert_eq!(gid, "group-term-1", "a third pane joins the group that's already there");
        assert_eq!(terminals[2].group_id.as_deref(), Some("group-term-1"));
    }

    #[test]
    fn splitting_from_an_unknown_session_assigns_nothing() {
        let mut terminals = vec![session("term-1", None)];
        assert_eq!(group_with_pure(&mut terminals, "term-missing", "term-1"), None);
        assert_eq!(terminals[0].group_id, None);
    }

    #[test]
    fn closing_one_member_leaves_the_other() {
        let mut terminals = vec![
            session("term-1", Some("group-term-1")),
            session("term-2", Some("group-term-1")),
        ];
        close_terminal_pure(&mut terminals, "term-2");

        assert_eq!(terminals.len(), 1);
        assert_eq!(terminals[0].id, "term-1");
        assert_eq!(terminals[0].group_id, None, "a group of one stops being a group");
    }

    #[test]
    fn closing_the_last_member_removes_the_group() {
        let mut terminals = vec![
            session("term-1", Some("group-term-1")),
            session("term-2", Some("group-term-1")),
        ];
        close_terminal_pure(&mut terminals, "term-1");
        close_terminal_pure(&mut terminals, "term-2");

        assert!(terminals.is_empty(), "no empty tab and no orphan group left behind");
    }

    #[test]
    fn closing_an_ungrouped_session_touches_no_one_else() {
        let mut terminals = vec![session("term-1", None), session("term-2", None)];
        close_terminal_pure(&mut terminals, "term-1");

        assert_eq!(terminals.len(), 1);
        assert_eq!(terminals[0].id, "term-2");
    }

    #[test]
    fn shorten_title_keeps_the_last_segment_of_an_absolute_path() {
        assert_eq!(
            shorten_title(r"C:\Users\bjsea\Documents\Viestra\code\helve\orchestrator"),
            "orchestrator",
            "a Windows path collapses to its final component"
        );
        assert_eq!(
            shorten_title("/home/braden/code/helve/orchestrator"),
            "orchestrator",
            "a POSIX path collapses to its final component"
        );
    }

    #[test]
    fn shorten_title_passes_a_plain_name_through_untouched() {
        assert_eq!(
            shorten_title("helve-shell-finishing-touches"),
            "helve-shell-finishing-touches",
            "a title that isn't a path form must not be mistaken for one"
        );
    }

    #[test]
    fn shorten_title_of_empty_string_is_empty() {
        assert_eq!(shorten_title(""), "", "an empty report has nothing to shorten");
    }

    // --- id counters, the part a restore gets wrong quietly -----------------

    fn snapshot_with(instances: &[(&str, &str)], panes: &[&str]) -> ShellSnapshot {
        let mut tree = PaneNode::leaf(panes[0]);
        for (i, pane) in panes.iter().enumerate().skip(1) {
            tree.split_pane(
                panes[0],
                SplitDir::Row,
                &format!("split-{i}"),
                pane,
                instances.get(i).map_or("x", |(id, _)| *id),
                false,
            );
        }
        ShellSnapshot {
            windows: vec![WindowPlacement {
                label: "main".to_string(),
                clusters: vec![Cluster {
                    id: "cluster-3".to_string(),
                    name: "w".to_string(),
                    tree,
                    project: None,
                    worktree: None,
                }],
                active_cluster_id: Some("cluster-3".to_string()),
                active_terminal: None,
                geometry: None,
            }],
            instances: instances
                .iter()
                .map(|(id, app_id)| SurfaceInstance {
                    id: (*id).to_string(),
                    app_id: (*app_id).to_string(),
                    kind: SurfaceKind::App,
                    title: (*id).to_string(),
                })
                .collect(),
            terminals: vec![session("term-7", None)],
            engine: EngineState::Idle,
        }
    }

    /// The bug this catches: a session that opened five Files and closed four
    /// leaves one live `files-5`. A counter derived from "one Files exists"
    /// hands out `files-2`, and four opens later two surfaces share an id —
    /// at which point every message for either reaches whichever the lookup
    /// happens to find first.
    #[test]
    fn restored_counters_resume_past_the_highest_id_not_the_count() {
        let snapshot = snapshot_with(&[("files-5", "files")], &["pane-9"]);
        let counters = counters_for(&snapshot);

        assert_eq!(counters.instances.get("files"), Some(&5));
        assert_eq!(counters.terminals, 7);
        assert_eq!(counters.panes, 9);
        assert_eq!(counters.clusters, 3);
    }

    #[test]
    fn restored_counters_are_per_app_not_shared() {
        let snapshot = snapshot_with(&[("files-4", "files"), ("home-1", "home")], &["pane-2"]);
        let counters = counters_for(&snapshot);

        assert_eq!(counters.instances.get("files"), Some(&4));
        assert_eq!(
            counters.instances.get("home"),
            Some(&1),
            "home must not inherit files' high-water mark"
        );
    }

    #[test]
    fn an_id_that_does_not_follow_the_scheme_is_ignored_rather_than_panicking() {
        assert_eq!(trailing_ordinal("files-3"), Some(3));
        assert_eq!(trailing_ordinal("files"), None);
        assert_eq!(trailing_ordinal("files-abc"), None);
        assert_eq!(trailing_ordinal(""), None);
    }

    #[test]
    fn a_seeded_window_has_somewhere_to_put_things() {
        let mut counters = Counters::default();
        let window = seed_window(&mut counters, "main");

        assert_eq!(window.clusters.len(), 1, "a window always has a cluster");
        assert!(
            window.active_cluster_id.is_some(),
            "and is always showing one of them"
        );
        assert!(
            !window.clusters[0].tree.first_pane_id().is_empty(),
            "and that cluster always has a pane to receive a surface"
        );
    }

    /// The whole state goes to disk and comes back at launch. A field that
    /// serializes and does not deserialize is a layout that silently resets on
    /// every restart, which is the one failure this feature exists to prevent.
    #[test]
    fn the_whole_snapshot_survives_a_json_round_trip() {
        let snapshot = snapshot_with(&[("files-1", "files"), ("files-2", "files")], &["pane-1", "pane-2"]);

        let json = serde_json::to_string(&snapshot).expect("a snapshot serializes");
        let back: ShellSnapshot = serde_json::from_str(&json).expect("and reads back");

        assert_eq!(back.instances.len(), snapshot.instances.len());
        assert_eq!(back.windows[0].clusters[0].tree, snapshot.windows[0].clusters[0].tree);
        assert_eq!(back.terminals[0].window_label, "main");
    }

    // --- the panel belongs to the window ------------------------------------

    fn window(label: &str, cluster: &str, tabs: &[&str]) -> WindowPlacement {
        let mut tree = PaneNode::leaf("pane-1");
        for tab in tabs {
            tree.insert_tab("pane-1", tab, None);
        }
        WindowPlacement {
            label: label.to_string(),
            clusters: vec![Cluster {
                id: cluster.to_string(),
                name: cluster.to_string(),
                tree,
                project: None,
                worktree: None,
            }],
            active_cluster_id: Some(cluster.to_string()),
            active_terminal: None,
            geometry: None,
        }
    }

    fn state(windows: Vec<WindowPlacement>, terminals: Vec<TerminalSession>) -> ShellSnapshot {
        ShellSnapshot {
            windows,
            instances: Vec::new(),
            terminals,
            engine: EngineState::Idle,
        }
    }

    /// The whole point of the change: a panel terminal is the window's, so
    /// switching clusters — or closing the one that happened to be open when it
    /// was opened — must not touch it.
    #[test]
    fn a_panel_terminal_is_not_in_any_cluster() {
        let mut s = state(
            vec![window("main", "cluster-1", &[])],
            vec![session("term-1", None)],
        );
        s.windows[0].clusters.push(Cluster {
            id: "cluster-2".to_string(),
            name: "cluster-2".to_string(),
            tree: PaneNode::leaf("pane-2"),
            project: None,
            worktree: None,
        });

        reseat_active_terminals(&mut s);
        assert_eq!(
            s.windows[0].active_terminal.as_deref(),
            Some("term-1"),
            "the panel shows it whichever cluster is open"
        );
    }

    /// A terminal dragged into the layout draws in the pane area, so the panel
    /// must stop pointing at it — otherwise the deck and a pane both claim it.
    #[test]
    fn a_terminal_in_a_tree_is_not_the_panel_selection() {
        let mut s = state(
            vec![window("main", "cluster-1", &["term-1"])],
            vec![session("term-1", None), session("term-2", None)],
        );
        s.windows[0].active_terminal = Some("term-1".to_string());

        reseat_active_terminals(&mut s);
        assert_eq!(
            s.windows[0].active_terminal.as_deref(),
            Some("term-2"),
            "the panel falls back to one it is actually drawing"
        );
    }

    /// What `add_terminal_in_pane` produces: a session that is in the tree from
    /// the moment it exists, and a panel selection nobody touched.
    ///
    /// The property is that opening a terminal *in a pane* does not change which
    /// terminal the **panel** is showing. Built here as a finished snapshot
    /// rather than by calling the method, which needs an `AppHandle` — what is
    /// worth pinning is that `reseat_active_terminals` sees nothing to repair,
    /// because that is the whole reason the method publishes in one step instead
    /// of adding to the panel and moving out of it a broadcast later.
    #[test]
    fn a_terminal_born_in_a_pane_leaves_the_panel_selection_alone() {
        let mut s = state(
            vec![window("main", "cluster-1", &["term-3"])],
            vec![
                session("term-1", None),
                session("term-2", None),
                session("term-3", None),
            ],
        );
        s.windows[0].active_terminal = Some("term-2".to_string());

        reseat_active_terminals(&mut s);

        assert_eq!(
            s.windows[0].active_terminal.as_deref(),
            Some("term-2"),
            "the panel is still showing what it was showing, not the new terminal \
             and not whichever panel terminal happens to be first"
        );
    }

    #[test]
    fn the_active_pane_falls_back_rather_than_addressing_nothing() {
        let shell = ShellState::default();
        shell.restore(state(vec![window("main", "cluster-1", &[])], Vec::new()));

        let first = Some(("cluster-1".to_string(), "pane-1".to_string()));
        assert_eq!(shell.active_pane("main", None), first, "no opinion means the first pane");
        assert_eq!(
            shell.active_pane("main", Some("pane-99")),
            first,
            "a pane id from a layout that has since changed is not addressed"
        );
        assert_eq!(
            shell.active_pane("main", Some("pane-1")),
            first,
            "a pane that is really there is honoured"
        );
        assert_eq!(shell.active_pane("nonesuch", None), None, "no window, no pane");
    }

    #[test]
    fn a_window_with_no_clusters_has_no_pane_to_open_into() {
        let shell = ShellState::default();
        let mut snapshot = state(vec![window("main", "cluster-1", &[])], Vec::new());
        snapshot.windows[0].clusters.clear();
        snapshot.windows[0].active_cluster_id = None;
        shell.restore(snapshot);

        assert_eq!(
            shell.active_pane("main", None),
            None,
            "there is no tree, so there is no pane — the menu disables the row for this"
        );
    }

    #[test]
    fn a_panel_never_selects_another_windows_terminal() {
        let mut s = state(
            vec![window("main", "cluster-1", &[]), window("win-1", "cluster-2", &[])],
            vec![in_window("win-1", "term-1", None)],
        );
        s.windows[0].active_terminal = Some("term-1".to_string());

        reseat_active_terminals(&mut s);
        assert_eq!(s.windows[0].active_terminal, None, "main has no terminals");
        assert_eq!(s.windows[1].active_terminal.as_deref(), Some("term-1"));
    }

    #[test]
    fn a_live_selection_is_left_exactly_where_it_is() {
        let mut s = state(
            vec![window("main", "cluster-1", &[])],
            vec![session("term-1", None), session("term-2", None)],
        );
        s.windows[0].active_terminal = Some("term-2".to_string());

        reseat_active_terminals(&mut s);
        assert_eq!(
            s.windows[0].active_terminal.as_deref(),
            Some("term-2"),
            "repair only; a deliberate selection is not second-guessed"
        );
    }

    /// The regression this guards: under the old model `close_cluster`
    /// collected every terminal whose `cluster_id` matched and the caller
    /// killed those ptys. A terminal is the window's now, so that same code
    /// would end the shell you had watching another worktree because you closed
    /// a cluster it was never part of.
    #[test]
    fn closing_a_cluster_disposes_of_what_was_in_its_tree_and_nothing_else() {
        let terminals = vec![
            session("term-1", None), // dragged into the tree
            session("term-2", None), // sitting in the panel
        ];
        let held = vec!["term-1".to_string(), "files-1".to_string()];

        let (gone, instances) = sort_held(held, &terminals);

        assert_eq!(gone, ["term-1"], "only the one that was on screen in it");
        assert!(
            !gone.contains(&"term-2".to_string()),
            "the panel's terminal survives the cluster it happened to be opened beside"
        );
        assert_eq!(instances, ["files-1"], "and the apps go as instances");
    }

    // --- a cluster moving between windows -----------------------------------
    //
    // `move_cluster_pure` is the whole of `detach_cluster`'s bookkeeping. Every
    // test below runs `reseat_active_terminals` after it, because `mutate` does
    // and the panel invariant is part of what the move has to leave intact.

    /// Two clusters in `main`, one of them holding `tabs` in its tree.
    fn two_clusters(tabs: &[&str]) -> ShellSnapshot {
        let mut placement = window("main", "cluster-1", &[]);
        let mut tree = PaneNode::leaf("pane-2");
        for tab in tabs {
            tree.insert_tab("pane-2", tab, None);
        }
        placement.clusters.push(Cluster {
            id: "cluster-2".to_string(),
            name: "auth".to_string(),
            tree,
            project: None,
            worktree: None,
        });
        state(vec![placement], Vec::new())
    }

    fn moved(s: &mut ShellSnapshot, cluster_id: &str, to_label: &str) -> bool {
        let ok = move_cluster_pure(s, cluster_id, to_label);
        reseat_active_terminals(s);
        ok
    }

    /// This was a refusal, and the refusal was the bug. A window holding one
    /// cluster is the commonest window there is, and it is exactly the one
    /// somebody wants to pull onto a second monitor — refusing it meant the
    /// gesture was unavailable in the case it was built for.
    #[test]
    fn detaching_the_only_cluster_in_a_window_empties_that_window() {
        let mut s = state(vec![window("main", "cluster-1", &["files-1"])], Vec::new());

        assert!(moved(&mut s, "cluster-1", "win-1"), "allowed");
        assert_eq!(s.windows.len(), 2, "and a window entry was made for it");
        assert_eq!(s.windows[1].label, "win-1");
        assert_eq!(s.windows[1].clusters.len(), 1, "the cluster arrived");
        assert!(
            s.windows[0].clusters.is_empty(),
            "and the window it left is empty, which NoClustersState draws"
        );
        assert_eq!(
            s.windows[0].active_cluster_id, None,
            "with nothing selected, rather than naming a cluster that has gone"
        );
    }

    #[test]
    fn a_detached_cluster_arrives_with_its_whole_tree() {
        let mut s = two_clusters(&["files-1", "files-2"]);
        let before = s.windows[0].clusters[1].tree.clone();

        assert!(moved(&mut s, "cluster-2", "win-1"));

        assert_eq!(s.windows.len(), 2, "a window entry was made for it");
        let new = &s.windows[1];
        assert_eq!(new.label, "win-1");
        assert_eq!(new.clusters.len(), 1);
        assert_eq!(new.clusters[0].tree, before, "the tree came across unchanged");
        assert_eq!(new.active_cluster_id.as_deref(), Some("cluster-2"));
        assert_eq!(
            s.windows[0].clusters.len(),
            1,
            "and it is no longer in the window it left"
        );
    }

    /// The failure this prevents: a terminal drawn as a tab in the new window
    /// while still claiming to belong to the old window's panel. Drag it out of
    /// the tree and `move_terminal` would put it back in a panel two monitors
    /// away from where it is on screen.
    #[test]
    fn terminals_in_a_detached_cluster_change_window() {
        let mut s = two_clusters(&["term-1", "files-1"]);
        s.terminals = vec![session("term-1", None), session("term-2", None)];

        assert!(moved(&mut s, "cluster-2", "win-1"));

        assert_eq!(s.terminals[0].window_label, "win-1", "it is on screen there now");
        assert_eq!(
            s.terminals[1].window_label, "main",
            "the panel's terminal is the window's and does not travel"
        );
        assert_eq!(
            s.windows[0].active_terminal.as_deref(),
            Some("term-2"),
            "main's panel is unmoved"
        );
        assert_eq!(
            s.windows[1].active_terminal, None,
            "and a terminal drawn in a tree is not the new window's panel selection"
        );
    }

    #[test]
    fn the_source_windows_active_cluster_falls_to_a_survivor() {
        let mut s = two_clusters(&[]);
        s.windows[0].active_cluster_id = Some("cluster-2".to_string());

        assert!(moved(&mut s, "cluster-2", "win-1"));
        assert_eq!(
            s.windows[0].active_cluster_id.as_deref(),
            Some("cluster-1"),
            "the window it left is still showing something"
        );
    }

    /// Released over another HELVE window. A cluster is appended to that
    /// window's list, so a label is the whole of the address — which is why this
    /// works where the same drop for a single tab does not.
    #[test]
    fn a_cluster_dropped_over_another_window_joins_it_rather_than_making_one() {
        let mut s = two_clusters(&["files-1"]);
        s.windows.push(window("win-1", "cluster-9", &[]));

        assert!(moved(&mut s, "cluster-2", "win-1"));

        assert_eq!(s.windows.len(), 2, "no third window");
        assert_eq!(s.windows[1].clusters.len(), 2, "it joined the ones already there");
        assert_eq!(s.windows[1].active_cluster_id.as_deref(), Some("cluster-2"));
    }

    #[test]
    fn moving_a_cluster_to_the_window_it_is_already_in_changes_nothing() {
        let mut s = two_clusters(&["files-1"]);

        assert!(moved(&mut s, "cluster-2", "main"), "it is where it was asked to be");
        assert_eq!(s.windows.len(), 1);
        assert_eq!(s.windows[0].clusters.len(), 2, "and it was not moved to the end");
        assert_eq!(s.windows[0].clusters[1].id, "cluster-2");
    }

    // --- a cluster owns its project -----------------------------------------

    /// The lookup every app call now depends on: an `invoke` arrives naming an
    /// instance, and the project it is answered against is whichever cluster's
    /// tree holds that instance. Getting this wrong roots a Files at the wrong
    /// project rather than failing, which is the reason it is tested at all.
    #[test]
    fn an_instance_resolves_to_the_cluster_whose_tree_holds_it() {
        let s = two_clusters(&["files-2"]);

        assert_eq!(
            cluster_of_instance_pure(&s, "files-2").as_deref(),
            Some("cluster-2"),
            "the second cluster's tree is the one holding it"
        );
        assert_eq!(
            cluster_of_instance_pure(&s, "files-99"), None,
            "an instance nobody holds resolves to no cluster rather than to the first one"
        );
    }

    /// Two clusters, two projects, at once. This is the whole feature stated as
    /// a property: nothing about setting one cluster's project can reach
    /// another's, because there is no shared field left for it to reach.
    #[test]
    fn two_clusters_hold_two_different_projects() {
        let mut s = two_clusters(&[]);
        s.windows[0].clusters[0].project = Some(r"C:\code\aurora".to_string());
        s.windows[0].clusters[1].project = Some(r"C:\code\borealis".to_string());

        assert_eq!(
            s.windows[0].clusters[0].project.as_deref(),
            Some(r"C:\code\aurora")
        );
        assert_eq!(
            s.windows[0].clusters[1].project.as_deref(),
            Some(r"C:\code\borealis")
        );
    }

    /// A cluster's project travels with it into another window, which is what
    /// makes "a project per monitor" the same act as "a cluster per monitor".
    #[test]
    fn a_detached_cluster_takes_its_project_with_it() {
        let mut s = two_clusters(&["files-1"]);
        s.windows[0].clusters[1].project = Some(r"C:\code\auth".to_string());

        assert!(moved(&mut s, "cluster-2", "win-1"));

        assert_eq!(
            s.windows[1].clusters[0].project.as_deref(),
            Some(r"C:\code\auth"),
            "the cluster is the project's owner, so moving one moves the other"
        );
    }

    /// Braden has a `layout.json` on disk right now, written before a cluster
    /// had a project. A missing key must read as "no project yet" — the
    /// migration in `lib.rs` then seeds it — and never as a parse failure,
    /// which would silently reset the whole saved session.
    #[test]
    fn a_cluster_stored_without_a_project_still_loads() {
        let json = r#"{
            "id": "cluster-1",
            "name": "orchestrator",
            "tree": { "kind": "leaf", "id": "pane-1", "tabs": [], "activeTab": null },
            "worktree": null
        }"#;

        let restored: Cluster = serde_json::from_str(json).expect("an older cluster still reads");
        assert_eq!(restored.project, None);
        assert_eq!(restored.id, "cluster-1");
    }

    /// The counterpart: a project written today comes back tomorrow. A field
    /// that serializes and does not deserialize would be a project that resets
    /// on every launch, which is the failure the whole per-cluster model exists
    /// to make impossible.
    #[test]
    fn a_clusters_project_survives_a_json_round_trip() {
        let mut s = two_clusters(&[]);
        s.windows[0].clusters[0].project = Some(r"C:\code\aurora".to_string());

        let json = serde_json::to_string(&s).expect("a snapshot serializes");
        let back: ShellSnapshot = serde_json::from_str(&json).expect("and reads back");

        assert_eq!(
            back.windows[0].clusters[0].project.as_deref(),
            Some(r"C:\code\aurora")
        );
        assert_eq!(back.windows[0].clusters[1].project, None);
    }

    /// What made the old refusal defensible was the fear that an emptied window
    /// would be a dead one. It is not: the panel is the *window's*, so the shells
    /// beside the empty app area are still there, still in this window, still
    /// selected. That is the whole reason closing the last cluster was allowed,
    /// and it is just as true when the last cluster leaves by being dragged.
    #[test]
    fn a_window_emptied_by_a_drag_keeps_its_panel_terminals() {
        let mut s = state(
            vec![window("main", "cluster-1", &["files-1"])],
            vec![session("term-1", None)],
        );
        s.windows[0].active_terminal = Some("term-1".to_string());

        assert!(moved(&mut s, "cluster-1", "win-1"));

        assert!(s.windows[0].clusters.is_empty(), "the cluster left");
        assert_eq!(
            s.terminals[0].window_label, "main",
            "the panel's shell did not go with it — it was never in the tree"
        );
        assert_eq!(
            s.windows[0].active_terminal.as_deref(),
            Some("term-1"),
            "and the panel is still showing it"
        );
    }

    /// A `layout.json` written before terminals left the clusters has a
    /// `clusterId` and no window label. Defaulting that to `""` would put every
    /// restored terminal in a window that does not exist — the tabs would be
    /// gone from every panel while `respawn_terminals` started their shells
    /// anyway, which looks exactly like the ptys having failed.
    #[test]
    fn a_terminal_stored_without_a_window_label_lands_in_the_main_window() {
        let json = r#"{
            "id": "term-1",
            "title": "pwsh",
            "clusterId": "cluster-1",
            "agentFinished": false,
            "groupId": null
        }"#;

        let restored: TerminalSession = serde_json::from_str(json).expect("an old tab still reads");
        assert_eq!(restored.window_label, "main");
        assert_eq!(restored.id, "term-1");
    }
}
