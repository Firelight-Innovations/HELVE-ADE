//! What every HELVE window has to agree on.
//!
//! The shell runs in more than one window: the main one, plus a real OS window
//! for each tool that has been dragged out of the switcher bar. Most of what a
//! window knows is its own business — how wide its panel is, which popover is
//! open — but three things cannot be, because two windows disagreeing about
//! them would be a visible bug:
//!
//!   * **Placement.** Which tools are docked in which window. When a tool is
//!     dragged out, its tab has to leave the bar it came from. Only one owner
//!     can decide that, and it isn't either window.
//!   * **Terminal sessions.** A terminal can be dragged from any window's panel
//!     into any other's. The session outlives whichever window is showing it.
//!   * **Engine status.** One engine, many viewers.
//!
//! So those live here, in the backend, and each window is a projection of them:
//! it subscribes to `shell:state` and renders whatever its placement entry
//! says it holds. Nothing is copied between windows, which means nothing can
//! drift out of sync.

use serde::{Deserialize, Serialize};
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
/// When the engine grows something to say, it gets added here and the status
/// bar learns to read it; nothing else in the shell has to change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineState {
    Idle,
    Building,
    Running,
    Failed,
    None,
}

/// Which tools a given window is holding.
///
/// The main window holds every docked tool and shows a switcher bar. A detached
/// window holds exactly one and shows none — there is nothing to switch
/// between. That is the only structural difference between them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    /// The Tauri window label. `main`, or `tool-<id>` for a detached tool.
    pub label: String,
    /// Docked tool ids in bar order. Reordering a tab reorders this.
    pub tool_ids: Vec<String>,
    pub active_tool_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub title: String,
    /// Which window's panel is currently showing it.
    pub window_label: String,
    /// The dot on a terminal tab: *this agent finished*. Not tool health.
    pub agent_finished: bool,
}

/// The whole shared state, as one serializable object.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshot {
    pub windows: Vec<WindowPlacement>,
    pub terminals: Vec<TerminalSession>,
    pub engine: EngineState,
}

/// The live state behind a lock.
///
/// `RwLock` for the same reason `AppState` uses one: this is read on every
/// window's subscription and written only when someone drags something.
pub struct ShellState {
    inner: RwLock<ShellSnapshot>,
    /// Monotonic counter for terminal ids. Wrapped in the same lock discipline
    /// as everything else rather than an atomic, because a new terminal always
    /// mutates the session list at the same time — one lock, one consistent
    /// state, no window that can observe an id without its session.
    next_terminal: RwLock<u32>,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            inner: RwLock::new(ShellSnapshot {
                // The main window exists before anything is discovered, and
                // starts holding nothing. Which tools dock into it is decided
                // by the frontend once the stack snapshot arrives, not here —
                // the backend has no opinion about which tool you want open.
                windows: vec![WindowPlacement {
                    label: "main".to_string(),
                    tool_ids: Vec::new(),
                    active_tool_id: None,
                }],
                // No terminals until one has a shell behind it. This used to
                // start with a hardcoded "bash" to match the handoff's default
                // screen, which was honest while the panel was drawing canned
                // lines and became a lie the moment tabs got real ptys — a tab
                // here with no process behind it is a tab that swallows
                // keystrokes. `lib.rs` opens the launch terminal properly, at
                // setup, through the same path everything else uses.
                terminals: Vec::new(),
                engine: EngineState::Idle,
            }),
            next_terminal: RwLock::new(1),
        }
    }
}

impl ShellState {
    pub fn snapshot(&self) -> ShellSnapshot {
        self.inner.read().expect("shell state lock poisoned").clone()
    }

    /// Run a mutation, then tell every window.
    ///
    /// Every public mutator goes through this, which is what guarantees no
    /// change can land without a broadcast — the bug where one window updates
    /// and the others don't is not expressible.
    ///
    /// The write lock is dropped before the emit: `emit` reaches into Tauri's
    /// event machinery, and holding a lock across a call that might itself want
    /// to read this state is how a deadlock gets written.
    fn mutate<F: FnOnce(&mut ShellSnapshot)>(&self, app: &AppHandle, f: F) {
        let updated = {
            let mut guard = self.inner.write().expect("shell state lock poisoned");
            f(&mut guard);
            guard.clone()
        };
        let _ = app.emit(SHELL_STATE_EVENT, &updated);
    }

    /// Set which tools a window holds. Called once the stack resolves, and
    /// again whenever tabs are reordered.
    pub fn set_docked(&self, app: &AppHandle, label: &str, tool_ids: Vec<String>) {
        self.mutate(app, |s| {
            if let Some(w) = s.windows.iter_mut().find(|w| w.label == label) {
                // Keep the active tool only if it's still here. Dropping it
                // otherwise is what makes focus fall to the neighbour when a
                // tab is dragged away.
                if !w
                    .active_tool_id
                    .as_ref()
                    .is_some_and(|id| tool_ids.contains(id))
                {
                    w.active_tool_id = tool_ids.first().cloned();
                }
                w.tool_ids = tool_ids;
            }
        });
    }

    pub fn set_active_tool(&self, app: &AppHandle, label: &str, tool_id: Option<String>) {
        self.mutate(app, |s| {
            if let Some(w) = s.windows.iter_mut().find(|w| w.label == label) {
                w.active_tool_id = tool_id;
            }
        });
    }

    /// Move a tool out of its window into a new one.
    ///
    /// Returns `false` if the tool isn't docked anywhere, which is the caller's
    /// signal not to create a window for it. Doing the bookkeeping first and
    /// the window second means a failed lookup can't leave an empty window on
    /// screen.
    pub fn detach_tool(&self, app: &AppHandle, tool_id: &str, new_label: &str) -> bool {
        let mut found = false;
        self.mutate(app, |s| {
            for w in s.windows.iter_mut() {
                if let Some(i) = w.tool_ids.iter().position(|t| t == tool_id) {
                    w.tool_ids.remove(i);
                    if w.active_tool_id.as_deref() == Some(tool_id) {
                        // Focus falls to the neighbour: the tab that slid into
                        // the vacated position, or the last one if it was last.
                        w.active_tool_id = w.tool_ids.get(i).or_else(|| w.tool_ids.last()).cloned();
                    }
                    found = true;
                    break;
                }
            }
            if found {
                s.windows.push(WindowPlacement {
                    label: new_label.to_string(),
                    tool_ids: vec![tool_id.to_string()],
                    active_tool_id: Some(tool_id.to_string()),
                });
            }
        });
        found
    }

    /// Fold a detached window's tools back into the main window. Called when
    /// that window closes, so a tool can never be stranded in a window that is
    /// no longer on screen.
    pub fn reclaim_window(&self, app: &AppHandle, label: &str) {
        self.mutate(app, |s| {
            let Some(i) = s.windows.iter().position(|w| w.label == label) else {
                return;
            };
            let gone = s.windows.remove(i);
            for t in s.terminals.iter_mut().filter(|t| t.window_label == label) {
                t.window_label = "main".to_string();
            }
            if let Some(main) = s.windows.iter_mut().find(|w| w.label == "main") {
                main.tool_ids.extend(gone.tool_ids);
            }
        });
    }

    /// Claim the next session id and its ordinal, without creating anything.
    ///
    /// Split from `add_terminal` so a pty can be spawned *between* the two. The
    /// id is what names the pty, and a session must not appear in the shared
    /// state until there is a real shell behind it — otherwise a failed spawn
    /// leaves a tab that looks alive and silently eats every keystroke.
    pub fn claim_terminal_id(&self) -> (String, u32) {
        let mut n = self.next_terminal.write().expect("terminal counter poisoned");
        let ordinal = *n;
        *n += 1;
        (format!("term-{ordinal}"), ordinal)
    }

    /// Publish a session whose shell is already running.
    pub fn add_terminal(&self, app: &AppHandle, id: &str, title: &str, label: &str) {
        self.mutate(app, |s| {
            s.terminals.push(TerminalSession {
                id: id.to_string(),
                title: title.to_string(),
                window_label: label.to_string(),
                agent_finished: false,
            });
        });
    }

    pub fn close_terminal(&self, app: &AppHandle, id: &str) {
        self.mutate(app, |s| s.terminals.retain(|t| t.id != id));
    }

    /// Move a terminal into another window's panel — the second drag
    /// interaction. Terminals move between any two HELVE windows, so this takes
    /// any label and doesn't care which window it came from.
    pub fn move_terminal(&self, app: &AppHandle, id: &str, to_label: &str) {
        self.mutate(app, |s| {
            if let Some(t) = s.terminals.iter_mut().find(|t| t.id == id) {
                t.window_label = to_label.to_string();
            }
        });
    }

    pub fn set_engine(&self, app: &AppHandle, engine: EngineState) {
        self.mutate(app, |s| s.engine = engine);
    }
}
