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
    /// Sessions sharing a group id render as one tab, laid out side by side
    /// in the deck. `None` for an ordinary, unsplit session.
    ///
    /// Lives here rather than in view-local React state because a terminal
    /// can be dragged into another window — a group held together by one
    /// window's state would come apart the moment a member of it moved.
    pub group_id: Option<String>,
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
                // starts holding nothing — which tools dock into it is decided
                // by the frontend once the stack snapshot arrives.
                //
                // The *active* tool is the one exception, and it is one the
                // backend is entitled to have an opinion about. Every other id
                // names something that might not be on this machine, so naming
                // one here would be guessing; `home` is compiled into this
                // binary (see `apps::REGISTRY`) and cannot be absent. And HELVE
                // opening on Home is a decision about the product rather than
                // an accident of whichever tab happened to seed first, so it is
                // stated where it can't drift — `set_docked` preserves an active
                // id that is still in the list, so the seeding pass leaves it
                // alone.
                windows: vec![WindowPlacement {
                    label: "main".to_string(),
                    tool_ids: Vec::new(),
                    active_tool_id: Some("home".to_string()),
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
                group_id: None,
            });
        });
    }

    pub fn close_terminal(&self, app: &AppHandle, id: &str) {
        self.mutate(app, |s| close_terminal_pure(&mut s.terminals, id));
    }

    /// Which window's panel a session is showing in, for the split command —
    /// it opens the new pty in the same window as the one it's splitting
    /// from, and the caller (a Tauri command) has no other way to know that.
    pub fn window_label_of(&self, id: &str) -> Option<String> {
        let guard = self.inner.read().expect("shell state lock poisoned");
        guard
            .terminals
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.window_label.clone())
    }

    /// Put `id` into `sibling_id`'s group, creating one if `sibling_id`
    /// doesn't already have one. Returns the group id, or `None` if
    /// `sibling_id` is no longer a live session — its tab could have closed
    /// while the new pty was spawning.
    pub fn group_with(&self, app: &AppHandle, sibling_id: &str, id: &str) -> Option<String> {
        let mut assigned = None;
        self.mutate(app, |s| {
            assigned = group_with_pure(&mut s.terminals, sibling_id, id);
        });
        assigned
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

    /// A terminal's own program set its title (an OSC `0`/`2` escape
    /// sequence), and the emulator that saw it is reporting up.
    ///
    /// The OSC parsing happens in xterm.js, not here — see `XTermView`'s
    /// `onTitleChange` wiring. xterm ships a tested parser that already
    /// copes with a title sequence split across two pty reads, and
    /// rewriting that correctly in Rust would only be redoing work already
    /// done. What *does* belong here is ownership of the result: a terminal
    /// can be dragged into another window's panel (see the module doc), so
    /// the title has to outlive whichever window first heard it, the same
    /// reason `title` lives on `TerminalSession` at all.
    ///
    /// Two guards, both load-bearing: an empty title is dropped rather than
    /// stored, so a report racing a tab close (or a program that hasn't set
    /// one yet) can never blank the shell-name fallback `open_terminal`
    /// gave the tab; and a title identical to what is already stored is
    /// dropped too, so a shell that rewrites its title on every prompt
    /// doesn't broadcast `shell:state` to every window for no visible
    /// change. That second check is why this doesn't go through `mutate` —
    /// `mutate`'s contract is to broadcast unconditionally, and a no-op
    /// here must broadcast nothing.
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
    }
}

/// ConPTY and PowerShell commonly set a terminal's title to the full working
/// directory rather than a name — `C:\Users\bjsea\...\orchestrator` is a
/// useless tab label where `orchestrator` is a good one. So: when the whole
/// reported title parses as an absolute path, this keeps only its last
/// component; anything else — a program's own chosen name, like a coding
/// harness's session name — passes through untouched.
///
/// One function, called from the one place a title is stored, so the two
/// separator styles a report might use can't quietly drift apart between
/// call sites. "Absolute" is judged loosely on purpose — a leading `/`
/// (POSIX) or a drive letter followed by `:\` or `:/` (Windows) — rather
/// than a strict parse, and both separator styles are recognised regardless
/// of which OS this binary is running on: a Windows shell's report is a
/// Windows path even if this were ever compiled for another platform, and
/// `std::path::Path` would only honour the separator of whatever platform
/// it was built for.
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
fn group_with_pure(terminals: &mut Vec<TerminalSession>, sibling_id: &str, id: &str) -> Option<String> {
    let existing = terminals.iter().find(|t| t.id == sibling_id)?.group_id.clone();
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
        TerminalSession {
            id: id.to_string(),
            title: id.to_string(),
            window_label: "main".to_string(),
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
        // A lone survivor is no longer "grouped" — see close_terminal_pure.
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
        assert_eq!(terminals[0].group_id, None);
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
}
