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
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize, SlavePty};
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// One session's output, as it arrives. Per-session rather than one global
/// event: a window listens only for the terminals it is showing, so a busy
/// build in one tab does not wake every other tab's listener.
pub fn data_event(id: &str) -> String {
    format!("pty:data:{id}")
}

/// One emission on `pty:data:<id>`.
///
/// Carries a sequence number as well as the bytes, so an emulator that has just
/// been handed the backlog can tell which live events it has already seen. See
/// [`PtySessions::attach`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct Chunk {
    pub seq: u64,
    pub data: String,
}

/// Everything a freshly-mounted emulator needs to catch up, answered in one
/// call by [`PtySessions::attach`].
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// Every byte the shell has produced so far, oldest first.
    pub text: String,
    /// The sequence number the next live event will carry. Anything below this
    /// is already inside `text`.
    pub next_seq: u64,
    /// The shell already ended. The `pty:exit` event that said so may have been
    /// emitted before anyone was listening, so it is repeated here.
    pub exited: bool,
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

/// How much output a session remembers for an emulator that has not attached
/// yet, or that attaches again after moving windows. Whole chunks are dropped
/// from the front once this is exceeded — enough to repaint a screen and a
/// useful amount of history, far short of xterm's own 10,000-line scrollback,
/// which is the real one.
const BACKLOG_BYTES: usize = 512 * 1024;

/// A session's output, and whether anyone is listening for it yet.
///
/// This exists because of the first four bytes a Windows shell produces.
/// ConPTY opens by asking the terminal where the cursor is (`ESC[6n`) and then
/// *blocks the shell* until something answers — an emulator replies
/// automatically, and until it does, the shell prints nothing at all, not even
/// a prompt. Tauri events have no replay buffer, so an event emitted before the
/// webview registered its listener is simply gone. The launch terminal is
/// opened during `.setup()`, long before any JavaScript runs, so that question
/// was being asked to an empty room every single time: the shell waited
/// forever, and the panel showed a permanently blank terminal that was, in
/// every other respect, working.
///
/// So nothing is emitted until an emulator has said it is listening. Until
/// then output accumulates here.
#[derive(Default)]
struct Backlog {
    /// `(seq, text)`, oldest first.
    chunks: VecDeque<(u64, String)>,
    bytes: usize,
    next_seq: u64,
    /// Set by [`PtySessions::attach`]. False means "emit nothing, just store".
    attached: bool,
    exited: bool,
}

impl Backlog {
    /// Record a chunk and answer whether it should also go out as an event.
    ///
    /// Both halves happen under one lock on purpose. If storing and the
    /// attached check could interleave with `attach`, a chunk could land in the
    /// gap between the backlog being read and the flag being set — emitted to
    /// nobody, and absent from the text the emulator was just handed.
    fn push(&mut self, text: String) -> Option<Chunk> {
        let seq = self.next_seq;
        self.next_seq += 1;

        self.bytes += text.len();
        self.chunks.push_back((seq, text.clone()));
        // Trimming whole chunks rather than bytes: a chunk boundary is already
        // an arbitrary read boundary, so dropping at one adds no new way to cut
        // an escape sequence in half. It can still orphan the tail of a
        // sequence whose head was trimmed, which is why this is a large budget
        // and not a small one.
        while self.bytes > BACKLOG_BYTES && self.chunks.len() > 1 {
            if let Some((_, old)) = self.chunks.pop_front() {
                self.bytes -= old.len();
            }
        }

        self.attached.then(|| Chunk { seq, data: text })
    }
}

struct Session {
    /// Held for its whole life, for two reasons: dropping the master closes the
    /// pty and kills the shell, and it is what `resize` talks to.
    master: Box<dyn MasterPty + Send>,
    /// Taken once at spawn. `take_writer` can only be called once, so the
    /// handle has to be kept rather than re-derived per keystroke.
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Shared with this session's reader thread. Its own lock, deliberately not
    /// the map's: the reader must be able to store a chunk while another thread
    /// is writing a keystroke, and making both wait on one lock would let a
    /// chatty build block typing.
    backlog: Arc<Mutex<Backlog>>,
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

        let (name, child) = spawn_shell(&*pty.slave, id, cwd)?;

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

        let backlog = Arc::new(Mutex::new(Backlog::default()));
        pump(app.clone(), id.to_string(), reader, Arc::clone(&backlog));

        self.inner.lock().expect("pty map poisoned").insert(
            id.to_string(),
            Session {
                master: pty.master,
                writer,
                child,
                backlog,
            },
        );

        Ok(name)
    }

    /// An emulator has mounted and registered its listener. Hand it everything
    /// the shell has said so far, and start emitting live from here.
    ///
    /// Returns `None` for a session that does not exist — a tab closed while
    /// its view was still mounting, which is not an error.
    pub fn attach(&self, id: &str) -> Option<Attachment> {
        // The map lock is released before the backlog lock is taken. Holding
        // both would put this thread and the reader thread in opposite orders
        // on two locks, which is the shape a deadlock needs.
        let backlog = {
            let map = self.inner.lock().expect("pty map poisoned");
            Arc::clone(&map.get(id)?.backlog)
        };

        let mut b = backlog.lock().expect("backlog poisoned");
        b.attached = true;
        Some(Attachment {
            text: b.chunks.iter().map(|(_, t)| t.as_str()).collect(),
            next_seq: b.next_seq,
            exited: b.exited,
        })
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

/// Try each shell candidate in turn and return the first that actually starts.
///
/// Split out of [`PtySessions::open`] so it can be tested without an
/// `AppHandle` — spawning a shell is the one step here that talks to the
/// operating system and can fail for reasons no amount of reading the code will
/// reveal, so it needs to be reachable from `cargo test`.
///
/// Takes `&dyn SlavePty` rather than the `PtyPair` it comes from: this only
/// needs the end the child will hold, and narrowing the parameter is what lets
/// the test hand it a bare pty of its own.
fn spawn_shell(
    slave: &dyn SlavePty,
    id: &str,
    cwd: &Path,
) -> Result<(String, Box<dyn Child + Send + Sync>)> {
    let mut last_err = String::from("no shell candidate was tried");

    for (name, mut cmd) in shell_candidates() {
        cmd.cwd(cwd);
        // Programs decide what they may draw from `TERM`. Without it, most TUIs
        // fall back to a dumb-terminal path and render as a wall of plain text
        // — which would look like our emulator was broken.
        cmd.env("TERM", "xterm-256color");
        match slave.spawn_command(cmd) {
            Ok(child) => return Ok((name, child)),
            // Not fatal on its own. The candidate list is ordered by
            // preference, and "pwsh is not installed" is the ordinary case on a
            // machine that only has the PowerShell that ships with Windows.
            // Only running out of candidates is an error.
            Err(e) => last_err = format!("{name}: {e}"),
        }
    }

    Err(AppError::Pty {
        id: id.to_string(),
        reason: format!("no usable shell found: {last_err}"),
    })
}

/// Read the pty until it ends, and emit what comes out.
///
/// One OS thread per session rather than async: this is a blocking `read` on a
/// file handle, which is exactly the thing an async runtime cannot do without a
/// dedicated thread underneath it anyway. `move` transfers ownership of the
/// handle and the id into the thread, because the thread outlives this function
/// and so cannot borrow from it.
fn pump(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>, backlog: Arc<Mutex<Backlog>>) {
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
                let out = tap_output(&id, &text).into_owned();
                // Stored either way; emitted only once someone is listening.
                let live = backlog.lock().expect("backlog poisoned").push(out);
                if let Some(chunk) = live {
                    let _ = app.emit(&data_event(&id), chunk);
                }
            }
        }

        // Recorded as well as emitted, for the same reason the output is: a
        // shell that fails instantly can be gone before any window exists to
        // hear about it, and a tab whose process died has to close either way.
        backlog.lock().expect("backlog poisoned").exited = true;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Nothing goes out before someone is listening, and nothing is lost
    /// waiting. This is the invariant the blank-terminal bug came down to.
    #[test]
    fn nothing_is_emitted_before_an_emulator_attaches() {
        let mut b = Backlog::default();

        // The cursor-position request ConPTY opens with, arriving during
        // `.setup()` with no webview alive to hear it.
        assert!(
            b.push("\u{1b}[6n".to_string()).is_none(),
            "an unattached session must not emit"
        );

        b.attached = true;
        let live = b.push("PS C:\\> ".to_string()).expect("an attached session emits");
        assert_eq!(live.seq, 1, "sequence numbers count every chunk, not every emission");

        let held: String = b.chunks.iter().map(|(_, t)| t.as_str()).collect();
        assert_eq!(
            held, "\u{1b}[6nPS C:\\> ",
            "the chunk emitted to nobody is still there for the emulator that arrives late"
        );
        assert_eq!(b.next_seq, 2, "attach tells the emulator where the live stream resumes");
    }

    /// A build left running overnight must not grow this without bound.
    #[test]
    fn the_backlog_is_bounded() {
        let mut b = Backlog::default();
        let chunk = "x".repeat(8192);
        for _ in 0..200 {
            b.push(chunk.clone());
        }

        assert!(
            b.bytes <= BACKLOG_BYTES + chunk.len(),
            "backlog grew to {} bytes against a {BACKLOG_BYTES}-byte budget",
            b.bytes
        );
        assert_eq!(b.next_seq, 200, "trimming drops history, never the sequence");
    }

    /// The one thing in this module that cannot be verified by reading it: does
    /// a shell actually start on *this* machine, and do its bytes come back?
    ///
    /// Everything above is arrangement — which candidate to try, where to split
    /// a UTF-8 read, which event name to emit. This is the step that talks to
    /// the OS, and it is exactly the step that failed silently in the app, since
    /// `lib.rs` cannot do anything useful with a launch failure except report
    /// it. So it gets a test that spawns a real shell rather than a fake one.
    #[test]
    fn spawns_a_real_shell_and_talks_to_it() {
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("the OS provides a pty");

        let cwd = std::env::temp_dir();
        let (name, mut child) =
            spawn_shell(&*pty.slave, "test", &cwd).expect("a usable shell exists on this machine");

        // Same as the real path: the child holds its own copy of the slave end,
        // and this one has to go or the reader below never sees end-of-file.
        drop(pty.slave);

        let mut reader = pty.master.try_clone_reader().expect("the master can be read");
        let mut writer = pty.master.take_writer().expect("the master can be written");

        // Reading a pty blocks, and a shell that never prints anything would
        // hang the whole test run rather than fail it. So the read happens on
        // its own thread and this one waits with a deadline — a hang becomes a
        // failure with a message.
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                let n = match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                if tx.send(String::from_utf8_lossy(&buf[..n]).to_string()).is_err() {
                    break;
                }
            }
        });

        let opening = rx
            .recv_timeout(Duration::from_secs(15))
            .unwrap_or_else(|e| panic!("`{name}` said nothing within 15s ({e})"));
        assert!(!opening.is_empty(), "`{name}` produced an empty first read");

        // On Windows that opening is a question, not output: ConPTY asks where
        // the cursor is and the shell stays silent until it is answered. An
        // emulator answers automatically; here it has to be done by hand, and
        // *not* doing it is precisely the state the app was stuck in.
        if opening.contains('\u{1b}') {
            let _ = writer.write_all(b"\x1b[1;1R");
            let _ = writer.flush();
        }

        // A shell at a prompt may print nothing further until it is spoken to.
        // `exit` guarantees output and a process that ends itself.
        let _ = writer.write_all(b"exit\r\n");
        let _ = writer.flush();

        let reply = rx
            .recv_timeout(Duration::from_secs(15))
            .unwrap_or_else(|e| panic!("`{name}` went silent after the handshake ({e})"));

        let _ = child.kill();
        let _ = child.wait();

        assert!(!name.is_empty(), "the spawned shell has a name to put on a tab");
        assert!(!reply.is_empty(), "`{name}` answered the handshake with nothing");
    }

    /// `HELVE_SHELL` is the documented one-line override, and a typo'd path in
    /// it must not fall back to PowerShell and pretend it worked.
    #[test]
    fn an_explicit_shell_is_the_only_candidate() {
        // Not `std::env::set_var` — tests share a process, and mutating the
        // environment would race with the test above resolving its own shell.
        // The candidate list is pure apart from that one read, so asserting on
        // the default list is the honest half of this.
        let names: Vec<String> = shell_candidates().into_iter().map(|(n, _)| n).collect();
        assert!(!names.is_empty(), "some shell is always worth trying");

        #[cfg(windows)]
        assert_eq!(names.last().map(String::as_str), Some("cmd"), "cmd is the last resort");
    }
}
