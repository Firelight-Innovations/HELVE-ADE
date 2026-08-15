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
//! A **window** holds one or more **clusters** and shows one of them. A cluster
//! is one thing being worked on: a pane tree of app surfaces, the terminals
//! sitting in the panel beside them, and — once Braden's git work lands — the
//! worktree they all operate on. Switching cluster tabs swaps the whole layout
//! beneath the switcher bar.
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

/// One tab in the switcher bar: a layout, its terminals, and its worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cluster {
    pub id: String,
    pub name: String,
    /// The pane tree. Holds instance ids; see `layout`.
    pub tree: PaneNode,
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
    /// Labels of windows whose close is a deliberate user action rather than
    /// the application shutting down.
    ///
    /// This exists because `WindowEvent::Destroyed` cannot tell the two apart,
    /// and the difference decides whether `reclaim` should run. At quit,
    /// `Destroyed` fires for *every* window — so a `reclaim` that trusted it
    /// would fold every detached window into `main` on the way out, and,
    /// because every mutation is persisted, would write that collapsed layout
    /// to disk as the thing to restore. You would close HELVE with three
    /// windows and open it with one, every time, and the tree serialization
    /// would look broken when it was working perfectly.
    ///
    /// So intent is stated rather than inferred: the title bar's close button
    /// goes through `close_window`, which marks the label here first. Anything
    /// that did not announce itself is a shutdown, and a shutdown reclaims
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
    /// cluster has no layout, no panel and no way to make either; there would be
    /// nothing on screen and nothing to click.
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
        // mutation persists it, and so does `close_window`.
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
    /// Returns `false` — and changes nothing — when the close was not announced
    /// through `close_window`, which means the application is shutting down.
    /// See the `closing` field.
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

    // --- instances ---------------------------------------------------------

    /// Mint an instance and put it on screen.
    ///
    /// `pane_id` names where; `None` means the active cluster's first pane,
    /// which is what the Apps menu wants — the caller asking for a new Files
    /// has no opinion about which pane receives it.
    pub fn open_instance(
        &self,
        app: &AppHandle,
        label: &str,
        app_id: &str,
        kind: SurfaceKind,
        title: &str,
        pane_id: Option<&str>,
    ) -> Option<String> {
        let instance_id = {
            let mut counters = self.counters.write().expect("counter lock poisoned");
            let ordinal = counters.instances.entry(app_id.to_string()).or_insert(0);
            *ordinal += 1;
            format!("{app_id}-{ordinal}")
        };

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

            if !cluster.tree.insert_tab(&target, &instance_id, None) {
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
/// Two refusals, both returning `false` with nothing changed:
///
/// - **A cluster nobody holds.** It has already been closed, or never existed.
/// - **The last cluster in its window.** A window must always have at least one:
///   with none it has no tree, no panel and no way to make either, so it would
///   sit on screen as a frame with nothing in it and nothing to click. This is
///   the same invariant that hides the close × on a lone chip. The refusal is a
///   refusal on purpose rather than a move that quietly seeds a replacement —
///   that would turn "move this cluster" into "move it and make another", which
///   is not what the gesture said.
///
/// Moving a cluster to the window it is already in is neither of those: nothing
/// happens and `true` is returned, because the cluster *is* where the caller
/// asked for it to be.
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
    if source.clusters.len() <= 1 {
        return false;
    }
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
            worktree: None,
        });
        state(vec![placement], Vec::new())
    }

    fn moved(s: &mut ShellSnapshot, cluster_id: &str, to_label: &str) -> bool {
        let ok = move_cluster_pure(s, cluster_id, to_label);
        reseat_active_terminals(s);
        ok
    }

    /// The invariant that makes this a refusal rather than a move: a window with
    /// no cluster has no tree, no panel, and no way to make either.
    #[test]
    fn detaching_the_only_cluster_in_a_window_is_refused() {
        let mut s = state(vec![window("main", "cluster-1", &["files-1"])], Vec::new());

        assert!(!moved(&mut s, "cluster-1", "win-1"), "refused");
        assert_eq!(s.windows.len(), 1, "and no window was made for it");
        assert_eq!(s.windows[0].clusters.len(), 1, "it is still where it was");
        assert_eq!(s.windows[0].active_cluster_id.as_deref(), Some("cluster-1"));
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
