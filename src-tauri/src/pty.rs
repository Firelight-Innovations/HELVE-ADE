//! Real terminals: a pseudo-terminal per session, and the seam every byte
//! crosses.
//!
//! A pseudo-terminal ("pty") is a pair of file handles that impersonate a
//! physical terminal. We hold the *master* end; the shell we spawn is given the
//! *slave* end and cannot tell the difference between it and a real console.
//! That is what makes full-screen TUIs work — the program asks the terminal how
//! big it is, whether it can move the cursor, whether it can use colour, and
//! gets real answers instead of the "this is a pipe" answers it would get from
//! `std::process::Command`.
//!
//! `portable-pty` is the abstraction over the three OS mechanisms for this
//! (ConPTY on Windows, `openpty` on macOS and Linux). We use it rather than
//! writing that ourselves for the obvious reason, and it is the same crate
//! WezTerm ships, so it is exercised heavily by something that is only a
//! terminal.
//!
//! # The interception seam
//!
//! Everything here funnels through [`tap_output`] and [`tap_input`], and nothing
//! else in the orchestrator may talk to a pty directly. That is the whole point
//! of this module's shape. A coding harness — Claude Code, Codex — is a program
//! that reads a terminal and writes a terminal, so owning both directions of its
//! byte stream is enough to wrap it: to notice what it did, to answer a prompt
//! on its behalf, to stop it. Those two functions are where that goes, and they
//! return `Cow` rather than `()` so a wrapper can *rewrite* a stream and not
//! merely watch it.
//!
//! Both are pass-through today. The seam exists before the feature does so the
//! feature never has to be threaded through the transport later.

use crate::error::{AppError, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// One session's output, as it arrives. Per-session rather than one global
/// event: a window listens only for the terminals it is showing, so a busy
/// build in one tab does not wake every other tab's listener.
pub fn data_event(id: &str) -> String {
    format!("pty:data:{id}")
}

/// The shell exited. The frontend closes the tab on this; nothing else does.
pub fn exit_event(id: &str) -> String {
    format!("pty:exit:{id}")
}

// --- the seam ---------------------------------------------------------------

/// Every byte the shell produces, before any window sees it.
///
/// Returning `Cow` means the common case costs nothing — `Cow::Borrowed` hands
/// the original string straight through with no copy — while still leaving room
/// for a future wrapper to substitute an owned, rewritten string. That is the
/// Rust idiom for "usually unchanged, occasionally replaced": one type that is
/// either a borrow of what you were given or something you made, chosen at
/// runtime, with no allocation unless you actually allocate.
fn tap_output<'a>(_id: &str, chunk: &'a str) -> Cow<'a, str> {
    Cow::Borrowed(chunk)
}

/// Every keystroke, before the shell sees it. The other half of the wrapper —
/// this is where synthetic input gets injected.
fn tap_input<'a>(_id: &str, data: &'a str) -> Cow<'a, str> {
    Cow::Borrowed(data)
}

// --- sessions ---------------------------------------------------------------

struct Session {
    /// Held for its whole life, for two reasons: dropping the master closes the
    /// pty and kills the shell, and it is what `resize` talks to.
    master: Box<dyn MasterPty + Send>,
    /// Taken once at spawn. `take_writer` can only be called once, so the
    /// handle has to be kept rather than re-derived per keystroke.
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Every live pty, keyed by the session id `ShellState` handed out.
///
/// `Mutex` rather than the `RwLock` used elsewhere in this crate: there is no
/// read-mostly access pattern here. Every operation — write a keystroke, resize,
/// kill — mutates, so a reader/writer split would buy nothing and only add a
/// second way to deadlock.
#[derive(Default)]
pub struct PtySessions {
    inner: Mutex<HashMap<String, Session>>,
}

impl PtySessions {
    /// Spawn a shell, wire its output to `pty:data:<id>`, and remember it.
    ///
    /// Returns the shell's short name — `pwsh`, `bash` — which is what the tab
    /// gets called. Naming the tab after whatever actually spawned means the
    /// label can never claim to be a shell you are not talking to.
    pub fn open(&self, app: &AppHandle, id: &str, cwd: &Path, cols: u16, rows: u16) -> Result<String> {
        let pty = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty {
                id: id.to_string(),
                reason: e.to_string(),
            })?;

        let mut last_err = String::from("no shell candidate was tried");
        let mut spawned = None;
        for (name, mut cmd) in shell_candidates() {
            cmd.cwd(cwd);
            // Programs decide what they may draw from `TERM`. Without it, most
            // TUIs fall back to a dumb-terminal path and render as a wall of
            // plain text — which would look like our emulator was broken.
            cmd.env("TERM", "xterm-256color");
            match pty.slave.spawn_command(cmd) {
                Ok(child) => {
                    spawned = Some((name, child));
                    break;
                }
                Err(e) => last_err = e.to_string(),
            }
        }

        let (name, child) = spawned.ok_or_else(|| AppError::Pty {
            id: id.to_string(),
            reason: format!("no usable shell found: {last_err}"),
        })?;

        // The slave end must be dropped now that the child holds its own copy.
        // Keeping it alive here would mean the pty always has a writer open, so
        // the read loop below would never see end-of-file and the tab would sit
        // there looking alive long after the shell exited.
        drop(pty.slave);

        let reader = pty.master.try_clone_reader().map_err(|e| AppError::Pty {
            id: id.to_string(),
            reason: e.to_string(),
        })?;
        let writer = pty.master.take_writer().map_err(|e| AppError::Pty {
            id: id.to_string(),
            reason: e.to_string(),
        })?;

        pump(app.clone(), id.to_string(), reader);

        self.inner.lock().expect("pty map poisoned").insert(
            id.to_string(),
            Session {
                master: pty.master,
                writer,
                child,
            },
        );

        Ok(name)
    }

    /// A keystroke, or anything else the emulator wants the shell to receive.
    pub fn write(&self, id: &str, data: &str) {
        let data = tap_input(id, data);
        let mut map = self.inner.lock().expect("pty map poisoned");
        if let Some(s) = map.get_mut(id) {
            // Deliberately ignored. A write failing means the shell is already
            // gone, and the read loop's end-of-file is what tells the frontend
            // that — reporting it twice, from two threads, would race.
            let _ = s.writer.write_all(data.as_bytes());
            let _ = s.writer.flush();
        }
    }

    /// Tell the pty its viewport changed. Load-bearing for TUIs: a program
    /// draws to the size the pty reports, so a pty that disagrees with the
    /// emulator produces a corrupt frame rather than a scaled one.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) {
        let map = self.inner.lock().expect("pty map poisoned");
        if let Some(s) = map.get(id) {
            let _ = s.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    /// Kill the shell and forget the session. Idempotent — closing a tab whose
    /// shell already exited is not an error.
    pub fn close(&self, id: &str) {
        let mut map = self.inner.lock().expect("pty map poisoned");
        if let Some(mut s) = map.remove(id) {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }

    /// The shell's own process id, for the busy check.
    fn pid(&self, id: &str) -> Option<u32> {
        let mut map = self.inner.lock().expect("pty map poisoned");
        map.get_mut(id).and_then(|s| s.child.process_id())
    }
}

/// Read the pty until it ends, and emit what comes out.
///
/// One OS thread per session rather than async: this is a blocking `read` on a
/// file handle, which is exactly the thing an async runtime cannot do without a
/// dedicated thread underneath it anyway. `move` transfers ownership of the
/// handle and the id into the thread, because the thread outlives this function
/// and so cannot borrow from it.
fn pump(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // Bytes from the end of the last read that were a *partial* UTF-8
        // character. A read can land mid-character — the pty deals in bytes and
        // knows nothing about encoding — and decoding that in isolation would
        // either fail or, worse, silently produce a replacement character in the
        // middle of otherwise fine output. So the incomplete tail waits here for
        // the rest of itself to arrive.
        let mut pending: Vec<u8> = Vec::new();

        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            pending.extend_from_slice(&buf[..n]);

            // `from_utf8` on failure tells us how much of the input *was* valid,
            // which is precisely the split point we need.
            let (text, rest) = match std::str::from_utf8(&pending) {
                Ok(s) => (s.to_string(), Vec::new()),
                Err(e) => {
                    let good = e.valid_up_to();
                    // Valid by construction: `valid_up_to` is the length of a
                    // verified-valid prefix. Spelled with the checked call
                    // anyway — an `unsafe` block would buy nothing measurable
                    // here, since this runs once per read rather than per byte.
                    let s = std::str::from_utf8(&pending[..good])
                        .expect("prefix validated by valid_up_to")
                        .to_string();
                    (s, pending[good..].to_vec())
                }
            };
            pending = rest;

            if !text.is_empty() {
                let out = tap_output(&id, &text);
                let _ = app.emit(&data_event(&id), out.as_ref());
            }
        }

        let _ = app.emit(&exit_event(&id), ());
    });
}

// --- which shell ------------------------------------------------------------

/// The shells to try, best first.
///
/// `HELVE_SHELL` wins when it is set, which is how this machine switches to Git
/// Bash (`C:\Program Files\Git\bin\bash.exe`) without a rebuild. Otherwise
/// Windows gets PowerShell — cross-platform PowerShell first, then the one that
/// ships with the OS — and everything else gets the login shell, falling back to
/// bash.
///
/// Returned as a list and tried in order because "is this program installed"
/// cannot be answered honestly without trying to run it: a `PATH` lookup can
/// succeed against a stub, and a file existing says nothing about whether this
/// user may execute it.
fn shell_candidates() -> Vec<(String, CommandBuilder)> {
    // The name a tab shows: the executable's stem, without its extension or the
    // directory it was found in. `C:\Program Files\Git\bin\bash.exe` becomes
    // `bash`.
    fn candidate(program: &str) -> (String, CommandBuilder) {
        let name = Path::new(program)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| program.to_string());
        (name, CommandBuilder::new(program))
    }

    if let Ok(explicit) = std::env::var("HELVE_SHELL") {
        if !explicit.trim().is_empty() {
            return vec![candidate(explicit.trim())];
        }
    }

    #[cfg(windows)]
    {
        vec![
            candidate("pwsh.exe"),
            candidate("powershell.exe"),
            candidate("cmd.exe"),
        ]
    }

    #[cfg(not(windows))]
    {
        let mut out = Vec::new();
        if let Ok(sh) = std::env::var("SHELL") {
            if !sh.trim().is_empty() {
                out.push(candidate(sh.trim()));
            }
        }
        out.push(candidate("/bin/bash"));
        out.push(candidate("/bin/sh"));
        out
    }
}

// --- the busy check ----------------------------------------------------------

/// What a session is running, if it is running anything.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Busy {
    pub process: String,
}

/// Does this session's shell have a child of its own?
///
/// This is the whole "are you sure" test, and it is asked exactly once — at the
/// moment someone clicks a tab's close button. Nothing polls, nothing watches,
/// and no session carries a running/idle flag that could go stale. A shell
/// sitting at a prompt has no children and closes silently; a shell running
/// `npm test`, or a coding harness, has one and gets a dialog naming it.
///
/// Deliberately a *direct child* test rather than a whole-descendant walk. A
/// shell's immediate child is the foreground job, which is what the dialog wants
/// to name; a deep walk would also catch a daemon something left behind, and
/// would prompt about a terminal that is, to the person looking at it, idle.
pub fn busy(sessions: &PtySessions, id: &str) -> Option<Busy> {
    let shell_pid = sessions.pid(id)?;

    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    sys.processes()
        .values()
        .find(|p| p.parent().is_some_and(|parent| parent.as_u32() == shell_pid))
        .map(|p| Busy {
            process: p.name().to_string_lossy().to_string(),
        })
}
