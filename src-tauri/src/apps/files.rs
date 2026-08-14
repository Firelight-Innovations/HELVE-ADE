//! The Files app's Rust half — listing a directory, reading a file, and writing
//! one back.
//!
//! Every method that names a file takes an absolute path. `files/list` and
//! `files/read` accept none and fall back to the root of the checkout the
//! running manifest was found in, which `files/root` reports directly; that
//! fallback is the only place this module has an opinion about *where* the user
//! is, and everything else is the frontend's to decide and pass in. The methods
//! that change something — write, reveal, open — refuse a missing path instead
//! of defaulting, because none of them has a harmless thing to do to the root.
//!
//! Nothing here decides what a file *is*. There is no MIME sniffing and no
//! content type — `kind` is the filesystem's own dir/file/other and stops there.
//! Which viewer opens a `.png` is the frontend registry's business, and keeping
//! that knowledge on one side means adding a format is a one-file change rather
//! than a change here, a change there, and a protocol between them that has to
//! agree.
//!
//! There is deliberately no sandbox here. A tool is third-party code and its
//! manifest paths are validated as a security boundary (see
//! `helve-tool-manifest`), but an app is this repository's own code running in
//! the orchestrator's own process, next to a module that spawns real shells with
//! the user's full privileges. A path check here would look like a boundary
//! while defending nothing, which is worse than not having one. `files/write`
//! does not change that argument: the terminal next door can already overwrite
//! anything this can, and a check that stopped the file editor while letting a
//! shell through would be a fence with no field behind it. If the Files app ever
//! renders paths a *tool* chose, the check belongs at that seam, and it needs to
//! be written knowing that is what it is for.

use crate::state::AppState;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use helve_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// How much of a file `files/read` will hand back.
///
/// A viewer that has to stay responsive cannot be handed a 400 MB log, and the
/// answer to one that big is not a slower read — it is a different feature
/// (paging, or a stream). Until that exists, this reads the first chunk and says
/// so, which is honest in a way that a spinner over a hung IPC call is not.
const MAX_READ_BYTES: u64 = 256 * 1024;

/// How much of a file `files/read-bytes` will hand back — and, unlike
/// [`MAX_READ_BYTES`], a limit it *refuses* at rather than truncates to.
///
/// Half a PNG is not a smaller PNG. Everything that calls this passes the bytes
/// to a decoder, and a decoder handed a prefix either fails somewhere far from
/// the cause or, worse, renders the half it got as though that were the file.
/// Truncation is only honest when the caller can see the seam, which is true of
/// text in an editor and of nothing else here.
///
/// The name is spelled out in full rather than shortened to `MAX_BYTES_READ`,
/// which would differ from the constant above only in word order — the two caps
/// mean different things and must not be a glance apart.
const MAX_READ_BYTES_BINARY: u64 = 32 * 1024 * 1024;

pub fn call(app: &AppHandle, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
    match method {
        "files/root" => root(app),
        "files/list" => list(app, params.as_ref()),
        "files/stat" => Ok(stat_at(&required_path(params.as_ref())?)),
        "files/read" => read(app, params.as_ref()),
        "files/read-bytes" => {
            read_bytes_within(&required_path(params.as_ref())?, MAX_READ_BYTES_BINARY)
        }
        "files/write" => write(params.as_ref()),
        "files/reveal" => reveal(app, params.as_ref()),
        "files/open-external" => open_external(app, params.as_ref()),

        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
}

/// Where the tree roots, for the explorer's header.
///
/// Separate from `files/list` even though the frontend could take `path` from a
/// listing, because the two answer different questions: this one is "where does
/// this app start", asked once, and the listing is "what is in here", asked on
/// every expand. A frontend that had to list the root to learn its name would be
/// reading a directory in order to read a string.
fn root(app: &AppHandle) -> Result<Value, RpcError> {
    let path = default_root(app)?;
    Ok(json!({
        "path": path.display().to_string(),
        "name": base_name(&path),
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    path: String,
    /// `"dir"`, `"file"`, or `"other"` — a pipe, a socket, a device node. The
    /// frontend needs a closed set to switch an icon on, not the whole of
    /// `std::fs::FileType`.
    kind: &'static str,
    /// `null` for anything that isn't a file. A directory's "size" would have
    /// to be either its entry count or its recursive weight, and neither is
    /// what a caller reading this field expects.
    size: Option<u64>,
    /// Milliseconds since the Unix epoch, `null` when it cannot be read. Here
    /// rather than only on `files/stat` because the frontend compares a listing
    /// against the one before it to notice what changed, and a listing without
    /// times can only compare names.
    mtime: Option<u64>,
}

/// One directory's immediate children.
fn list(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    let dir = resolve_path(app, params)?;

    let reader = std::fs::read_dir(&dir).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not read {}: {e}", dir.display()),
        )
    })?;

    let mut entries: Vec<Entry> = Vec::new();
    for entry in reader {
        // One unreadable entry is not a failed listing. A directory with a
        // permission-denied child should still show every sibling, so this
        // skips what it cannot stat rather than aborting the whole call.
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let metadata = entry.metadata().ok();

        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.display().to_string(),
            kind: kind_of(metadata.as_ref()),
            mtime: metadata.as_ref().and_then(mtime_of),
            size: metadata.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
        });
    }

    // Directories first, then by name without regard to case. Sorted here
    // rather than in the frontend because every caller wants the same order,
    // and one that didn't sort would show the filesystem's own — which on
    // Windows is not the same order twice.
    entries.sort_by(|a, b| {
        let folders_first = (a.kind != "dir").cmp(&(b.kind != "dir"));
        folders_first.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(json!({
        "path": dir.display().to_string(),
        // `null` at a drive root or `/`, which is what stops the frontend
        // offering an "up" that goes nowhere.
        "parent": dir.parent().map(|p| p.display().to_string()),
        "entries": entries,
    }))
}

/// One text file's contents, up to [`MAX_READ_BYTES`].
fn read(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    let path = resolve_path(app, params)?;

    let metadata = std::fs::metadata(&path).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not stat {}: {e}", path.display()),
        )
    })?;
    if metadata.is_dir() {
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!("{} is a directory, not a file", path.display()),
        ));
    }

    let truncated = metadata.len() > MAX_READ_BYTES;
    let bytes = if truncated {
        use std::io::Read;
        let file = std::fs::File::open(&path).map_err(|e| {
            RpcError::new(
                INTERNAL_ERROR,
                format!("could not open {}: {e}", path.display()),
            )
        })?;
        let mut buffer = Vec::with_capacity(MAX_READ_BYTES as usize);
        file.take(MAX_READ_BYTES)
            .read_to_end(&mut buffer)
            .map_err(|e| {
                RpcError::new(
                    INTERNAL_ERROR,
                    format!("could not read {}: {e}", path.display()),
                )
            })?;
        buffer
    } else {
        std::fs::read(&path).map_err(|e| {
            RpcError::new(
                INTERNAL_ERROR,
                format!("could not read {}: {e}", path.display()),
            )
        })?
    };

    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_string(),

        // `error_len() == None` means "the input ended mid-character", which
        // for a truncated read is this function's own doing rather than a
        // property of the file — the cut landed inside a multi-byte character.
        // Dropping that partial tail is correct; treating the file as binary
        // because of it would be a bug that only shows up on files whose
        // 256 KiB mark happens to fall inside a non-ASCII character.
        Err(e) if truncated && e.error_len().is_none() => {
            String::from_utf8_lossy(&bytes[..e.valid_up_to()]).into_owned()
        }

        Err(_) => {
            return Err(RpcError::new(
                INVALID_PARAMS,
                format!("{} is not a UTF-8 text file", path.display()),
            ))
        }
    };

    Ok(json!({
        "path": path.display().to_string(),
        "text": text,
        "truncated": truncated,
        // The cap travels with the answer so the frontend can say how much it
        // got without knowing the number. It used to write "first 256 KiB" in
        // its own source, which is one constant spelled twice in two languages
        // — and the copy that would go stale is the one a person reads.
        "limit": MAX_READ_BYTES,
        "mtime": mtime_of(&metadata),
    }))
}

// --- the filesystem, without an `AppHandle` -----------------------------------
//
// Everything from here to `resolve_path` takes a `&Path` and knows nothing about
// Tauri. The split is for the tests at the bottom of this file: constructing an
// `AppHandle` means standing up a mock runtime, and the decisions worth testing
// — the stale-write check, the binary cap, what a drive root is called — have
// nothing to do with one. What is left above is parameter resolution, which is
// thin enough to read.

/// One entry as it is *right now*, including the fact that it isn't.
///
/// A missing path is `exists: false` rather than an error, and that is
/// load-bearing: the frontend polls this to notice files changing underneath it,
/// and a poll that got an error could not tell "someone deleted this" from "the
/// call failed", which are opposite instructions about what to do with the tab.
fn stat_at(path: &Path) -> Value {
    // Follows symlinks, so a broken link reads as absent. That matches `list`,
    // which cannot stat one either, and the honest thing to say about a link
    // whose target is gone is that there is nothing to open.
    let metadata = std::fs::metadata(path).ok();

    json!({
        "path": path.display().to_string(),
        "name": base_name(path),
        "kind": kind_of(metadata.as_ref()),
        "size": metadata.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
        "mtime": metadata.as_ref().and_then(mtime_of),
        "exists": metadata.is_some(),
    })
}

/// One file's bytes, base64'd, or an error when it is over `cap`.
///
/// Base64 is forced by the transport. An app's `Dispatch` returns a
/// `serde_json::Value`, which has no byte variant, so the only way a PNG reaches
/// the iframe is as a string — a third larger on the wire, and copied whole
/// twice. That is a fine price for the icons and screenshots this opens today
/// and an absurd one the first time someone double-clicks a 300 MB video.
///
/// The real answer then is not a bigger cap. It is Tauri's asset protocol —
/// `tauri.conf.json` has no `assetProtocol` key at all right now, so turning it
/// on is a deliberate act with a scope to argue about — or a custom URI scheme
/// the webview streams from. Either way the frontend receives a *URL* and the
/// bytes never enter a JSON document, and this function is the seam where that
/// change lands.
///
/// `cap` is a parameter rather than [`MAX_READ_BYTES_BINARY`] read directly, so
/// a test can prove the refusal without writing 32 MiB to a disk.
fn read_bytes_within(path: &Path, cap: u64) -> Result<Value, RpcError> {
    let metadata = std::fs::metadata(path).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not stat {}: {e}", path.display()),
        )
    })?;
    if metadata.is_dir() {
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!("{} is a directory, not a file", path.display()),
        ));
    }
    if metadata.len() > cap {
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!(
                "{} is {} bytes, over the {cap}-byte limit for a binary read",
                path.display(),
                metadata.len()
            ),
        ));
    }

    let bytes = std::fs::read(path).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not read {}: {e}", path.display()),
        )
    })?;

    Ok(json!({
        "path": path.display().to_string(),
        "base64": BASE64.encode(&bytes),
        // The decoded length, from the bytes actually read rather than from the
        // metadata above — the file could have grown between the two calls, and
        // a caller sizing a buffer wants the number that matches the payload.
        "size": bytes.len(),
        "mtime": mtime_of(&metadata),
    }))
}

/// Overwrite `path` with `text`, refusing if it moved under the caller.
///
/// `base_mtime` is the mtime the client last read. `None` means it never got one
/// and writes unconditionally: a filesystem that cannot report modification
/// times would otherwise make the editor unusable rather than safer, and "you
/// may not save here" is a worse outcome than the race it would be avoiding.
///
/// A path that does not exist yet is written, not refused. There is no
/// create-file UI today, but a `write` that could only ever overwrite would be a
/// surprise the first time there is one.
fn write_at(path: &Path, text: &str, base_mtime: Option<u64>) -> Result<Value, RpcError> {
    let current = mtime_at(path);
    // A file *deleted* since the read also counts as changed. The client asked
    // to replace a specific version and that version is not there; quietly
    // recreating it is a different act from the one it asked for, and the
    // frontend can offer "save as new" once it knows.
    if base_mtime.is_some() && base_mtime != current {
        return Err(RpcError::with_data(
            INVALID_PARAMS,
            format!("{} changed on disk since it was read", path.display()),
            json!({ "kind": "stale", "mtime": current }),
        ));
    }

    let temp = temp_sibling(path)?;
    std::fs::write(&temp, text).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not write {}: {e}", temp.display()),
        )
    })?;
    std::fs::rename(&temp, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not replace {}: {e}", path.display()),
        )
    })?;

    Ok(json!({
        "path": path.display().to_string(),
        "mtime": mtime_at(path),
    }))
}

/// A scratch path beside `path`, for the write-then-rename above.
///
/// Same reasoning as `project/store.rs`: truncating the real file and writing
/// into it has a window where a crash leaves half a document, and `rename` over
/// an existing file is atomic on NTFS and POSIX alike. The one difference is
/// that this cannot use `with_extension` the way that module does — it knows it
/// is writing `projects.json`, while this would turn `main.rs` into `main.tmp`.
///
/// Beside the target rather than in the temp directory, because `rename` is only
/// atomic within one filesystem, and an editor open on a network share would
/// otherwise get a cross-device copy that can fail halfway.
fn temp_sibling(path: &Path) -> Result<PathBuf, RpcError> {
    let Some(name) = path.file_name() else {
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!(
                "{} is a root, not a file that can be written",
                path.display()
            ),
        ));
    };

    let mut name = name.to_os_string();
    name.push(".helve-tmp");
    Ok(path.with_file_name(name))
}

/// `"dir"`, `"file"`, or `"other"`, from metadata that may not have been read.
///
/// `None` is the broken-symlink and permission-denied case — `std::fs::metadata`
/// follows links, so an entry whose target is gone gives nothing to switch on.
fn kind_of(metadata: Option<&std::fs::Metadata>) -> &'static str {
    match metadata.map(|m| m.file_type()) {
        Some(t) if t.is_dir() => "dir",
        Some(t) if t.is_file() => "file",
        _ => "other",
    }
}

/// Milliseconds since the Unix epoch, the way `project/mod.rs` does it.
///
/// Written out again rather than imported: that one is private, takes a `&Path`
/// where most callers here already hold the metadata, and widening another
/// module's surface for a single caller costs more than six lines do.
fn mtime_of(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// The same, for a path that may not exist — the conflict check's question.
fn mtime_at(path: &Path) -> Option<u64> {
    mtime_of(&std::fs::metadata(path).ok()?)
}

/// A path's last component, or the whole path when it has none.
///
/// A drive root like `C:\` has no `file_name()`, and calling the folder the app
/// opened in "" would be worse than calling it `C:\`. `project/mod.rs` makes the
/// same decision for the same reason; the frontend's `baseName` is the third
/// copy, and it is there because an app may not import from the shell.
fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.display().to_string())
}

// --- the rest of the methods --------------------------------------------------

/// Write a file, conflict-checked. See [`write_at`] for what `baseMtime` means.
fn write(params: Option<&Value>) -> Result<Value, RpcError> {
    let path = required_path(params)?;

    let text = match params.and_then(|p| p.get("text")) {
        Some(Value::String(text)) => text,
        Some(other) => {
            return Err(RpcError::new(
                INVALID_PARAMS,
                format!("text must be a string, got {other}"),
            ))
        }
        None => {
            return Err(RpcError::new(
                INVALID_PARAMS,
                "text is required — there is no method for emptying a file by omission",
            ))
        }
    };

    let base_mtime = match params.and_then(|p| p.get("baseMtime")) {
        // Absent and explicitly null are the same claim: "I have no time to
        // compare against". They arrive differently only because JSON does.
        None | Some(Value::Null) => None,
        Some(Value::Number(n)) => Some(n.as_u64().ok_or_else(|| {
            RpcError::new(
                INVALID_PARAMS,
                format!("baseMtime must be a whole number of milliseconds, got {n}"),
            )
        })?),
        Some(other) => {
            return Err(RpcError::new(
                INVALID_PARAMS,
                format!("baseMtime must be a number or null, got {other}"),
            ))
        }
    };

    write_at(&path, text, base_mtime)
}

/// Select the item in the OS file manager.
///
/// Called through the plugin's Rust API rather than by letting the frontend
/// invoke `opener:` directly, which is why `capabilities/default.json` needs no
/// entry for it: that file gates IPC arriving from a webview, and this call
/// starts here. The app frame is same-origin with the shell, so a capability
/// granted for the Files app would be one granted to the shell's whole origin.
fn reveal(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    let path = required_path(params)?;
    app.opener().reveal_item_in_dir(&path).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not reveal {}: {e}", path.display()),
        )
    })?;
    Ok(Value::Null)
}

/// Hand the file to whatever the OS opens it with.
fn open_external(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    let path = required_path(params)?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| {
            RpcError::new(
                INTERNAL_ERROR,
                format!("could not open {}: {e}", path.display()),
            )
        })?;
    Ok(Value::Null)
}

/// The `path` param, for the methods that have no honest default.
///
/// [`resolve_path`] falls back to the checkout root when `path` is missing, which
/// is right for browsing and wrong for everything else: a `files/write` that fell
/// back would try to overwrite the project directory, and a `files/reveal` would
/// pop open a window nobody asked for. Both should say the caller made a mistake.
fn required_path(params: Option<&Value>) -> Result<PathBuf, RpcError> {
    match params.and_then(|p| p.get("path")) {
        Some(Value::String(raw)) => Ok(PathBuf::from(raw)),
        Some(other) => Err(RpcError::new(
            INVALID_PARAMS,
            format!("path must be a string, got {other}"),
        )),
        None => Err(RpcError::new(INVALID_PARAMS, "path is required")),
    }
}

/// The `path` param, or the checkout root when it is absent.
fn resolve_path(app: &AppHandle, params: Option<&Value>) -> Result<PathBuf, RpcError> {
    match params.and_then(|p| p.get("path")) {
        Some(Value::String(raw)) => Ok(PathBuf::from(raw)),
        // Absent or explicitly null both mean "wherever you'd start me".
        None | Some(Value::Null) => default_root(app),
        Some(other) => Err(RpcError::new(
            INVALID_PARAMS,
            format!("path must be a string, got {other}"),
        )),
    }
}

/// Where Files opens when nobody has said otherwise: the open project, or the
/// directory holding the running manifest when nothing is open.
///
/// The project wins because Files exists to browse the thing being worked on,
/// and once there is a project that is what it is. The manifest directory is the
/// honest fallback rather than a placeholder — with no project open, the stack
/// checkout is the only tree the orchestrator knows anything about.
///
/// Not the process's working directory in either case, which is `src-tauri/`
/// under `tauri dev` and the install directory in a release build — neither is
/// anywhere the user would recognise.
fn default_root(app: &AppHandle) -> Result<PathBuf, RpcError> {
    if let Some(project) = crate::project::open_path(app) {
        return Ok(project);
    }

    let snapshot = app.state::<AppState>().get().ok_or_else(|| {
        RpcError::new(
            INTERNAL_ERROR,
            "no project is open and the stack has not been scanned yet, so there is no default directory",
        )
    })?;

    snapshot
        .manifest_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            RpcError::new(
                INTERNAL_ERROR,
                "the manifest path has no parent directory to open",
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A temp directory that cleans itself up, following `project/marker.rs` —
    /// these tests are about what a real filesystem does, and a fake one would
    /// only be testing the fake.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let dir = std::env::temp_dir().join(format!("helve-files-{tag}-{stamp}"));
            std::fs::create_dir_all(&dir).expect("temp dir");
            Self(dir)
        }

        fn file(&self, name: &str, contents: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, contents).expect("write fixture");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_stale_base_mtime_refuses_the_write_and_says_what_the_file_is_now() {
        let dir = TempDir::new("stale");
        let path = dir.file("notes.txt", "original");
        let actual = mtime_at(&path).expect("a fresh file has an mtime");

        // A deliberately wrong time rather than a real race: sleeping until the
        // clock ticks would make this test slow on a filesystem with coarse
        // timestamps and flaky on one without.
        let err = write_at(&path, "clobbered", Some(actual + 60_000))
            .expect_err("a write against a time the file never had must refuse");

        assert_eq!(err.code, INVALID_PARAMS);
        let data = err.data.expect("the refusal carries a data payload");
        assert_eq!(data["kind"], "stale");
        assert_eq!(
            data["mtime"].as_u64(),
            Some(actual),
            "the payload reports the time the caller lost to, so it can re-read"
        );

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "original",
            "a refused write leaves the file alone"
        );
    }

    #[test]
    fn a_matching_base_mtime_writes() {
        let dir = TempDir::new("match");
        let path = dir.file("notes.txt", "original");
        let base = mtime_at(&path);

        let result = write_at(&path, "edited", base).expect("write");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited");
        assert_eq!(result["path"], path.display().to_string());
        assert!(
            result["mtime"].is_number(),
            "the answer carries the next write's baseMtime"
        );
    }

    /// The promise in [`write_at`]'s doc: no readable mtime must not mean no
    /// saving.
    #[test]
    fn a_null_base_mtime_writes_anyway() {
        let dir = TempDir::new("nobase");
        let path = dir.file("notes.txt", "original");

        write_at(&path, "edited", None).expect("a write with no base time must succeed");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited");
    }

    #[test]
    fn writing_a_path_that_does_not_exist_yet_creates_it() {
        let dir = TempDir::new("create");
        let path = dir.0.join("new.txt");

        write_at(&path, "hello", None).expect("create");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    /// The temp file is a sibling and it does not survive the write — a stray
    /// `main.rs.helve-tmp` in a source tree would end up in someone's commit.
    #[test]
    fn the_write_leaves_no_temp_file_behind() {
        let dir = TempDir::new("tmp");
        let path = dir.file("main.rs", "fn main() {}");

        write_at(&path, "fn main() { todo!() }", None).expect("write");

        let left: Vec<String> = std::fs::read_dir(&dir.0)
            .unwrap()
            .filter_map(|e| Some(e.ok()?.file_name().to_string_lossy().into_owned()))
            .collect();
        assert_eq!(left, vec!["main.rs".to_string()]);
    }

    #[test]
    fn a_binary_read_over_the_cap_errors_rather_than_truncating() {
        let dir = TempDir::new("cap");
        let path = dir.file("big.bin", "0123456789");

        let err = read_bytes_within(&path, 4).expect_err("over the cap must not return a prefix");

        assert_eq!(err.code, INVALID_PARAMS);
        assert!(
            err.message.contains("limit"),
            "the message must name the cap, not just fail: {}",
            err.message
        );
    }

    #[test]
    fn a_binary_read_under_the_cap_round_trips() {
        let dir = TempDir::new("bytes");
        let path = dir.file("small.bin", "hello");

        let value = read_bytes_within(&path, MAX_READ_BYTES_BINARY).expect("read");

        assert_eq!(value["base64"], BASE64.encode("hello"));
        assert_eq!(value["size"], 5);
    }

    #[test]
    fn stat_reports_a_missing_path_as_absent_rather_than_failing() {
        let dir = TempDir::new("gone");
        let path = dir.0.join("deleted.txt");

        let value = stat_at(&path);

        assert_eq!(value["exists"], false);
        assert_eq!(value["size"], Value::Null);
        assert_eq!(value["mtime"], Value::Null);
        assert_eq!(value["name"], "deleted.txt", "a gone file still has a name");
    }

    #[test]
    fn stat_reports_a_directory_with_no_size() {
        let dir = TempDir::new("dir");

        let value = stat_at(&dir.0);

        assert_eq!(value["exists"], true);
        assert_eq!(value["kind"], "dir");
        assert_eq!(value["size"], Value::Null, "a directory has no one size");
    }

    #[test]
    fn base_name_takes_the_last_component() {
        assert_eq!(base_name(Path::new(r"C:\code\MyGame")), "MyGame");
        assert_eq!(base_name(Path::new("/home/braden/notes.txt")), "notes.txt");
    }

    /// `files/root` reports this as the header of the whole tree. A drive root
    /// has no file name at all, and an explorer headed "" would be worse than
    /// one headed `C:\`.
    #[test]
    fn base_name_of_a_drive_root_falls_back_to_the_path() {
        assert_eq!(base_name(Path::new(r"C:\")), r"C:\");
        assert!(!base_name(Path::new("/")).is_empty());
    }

    #[test]
    fn a_path_param_is_required_where_there_is_no_default() {
        let err = required_path(Some(&json!({}))).expect_err("no path");
        assert_eq!(err.code, INVALID_PARAMS);

        // Null is a mistake here even though `resolve_path` accepts it: nothing
        // sensible happens when a write is told to fall back to the root.
        let err = required_path(Some(&json!({ "path": null }))).expect_err("null path");
        assert_eq!(err.code, INVALID_PARAMS);
    }
}
