//! The Files app's Rust half — listing a directory and reading a text file.
//!
//! Both methods take an absolute path and, when none is given, fall back to the
//! root of the checkout the running manifest was found in. That fallback is the
//! only place this module has an opinion about *where* the user is; everything
//! else is the frontend's to decide and pass in.
//!
//! There is deliberately no sandbox here. A tool is third-party code and its
//! manifest paths are validated as a security boundary (see
//! `helve-tool-manifest`), but an app is this repository's own code running in
//! the orchestrator's own process, next to a module that spawns real shells with
//! the user's full privileges. A path check here would look like a boundary
//! while defending nothing, which is worse than not having one. If the Files app
//! ever renders paths a *tool* chose, the check belongs at that seam, and it
//! needs to be written knowing that is what it is for.

use crate::state::AppState;
use helve_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// How much of a file `files/read` will hand back.
///
/// A viewer that has to stay responsive cannot be handed a 400 MB log, and the
/// answer to one that big is not a slower read — it is a different feature
/// (paging, or a stream). Until that exists, this reads the first chunk and says
/// so, which is honest in a way that a spinner over a hung IPC call is not.
const MAX_READ_BYTES: u64 = 256 * 1024;

pub fn call(app: &AppHandle, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
    match method {
        "files/list" => list(app, params.as_ref()),
        "files/read" => read(app, params.as_ref()),

        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
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

        let kind = match metadata.as_ref().map(|m| m.file_type()) {
            Some(t) if t.is_dir() => "dir",
            Some(t) if t.is_file() => "file",
            Some(_) => "other",
            // `metadata` follows symlinks, so this is the broken-link case:
            // the entry exists, its target does not.
            None => "other",
        };

        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.display().to_string(),
            kind,
            size: metadata.filter(|m| m.is_file()).map(|m| m.len()),
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
    }))
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
