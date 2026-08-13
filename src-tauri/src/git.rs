//! Source control: what `git` says about a tool's checkout.
//!
//! This shells out to the system `git` binary rather than linking a library
//! (`git2`). That is a deliberate trade: the user's credential helper, SSH
//! agent, `.gitconfig`, hooks and aliases are all things `git` already knows
//! about and a linked library would have to be taught. The cost is that every
//! answer arrives as text that has to be parsed.
//!
//! Everything here is one-shot request→reply. There is no watcher and no
//! subscription — the panel re-asks after every mutation and when the shown
//! tool changes. Long-running, progress-reporting operations (push, pull,
//! clone) would want the pty machinery instead; none of them live here.
//!
//! Commands take a tool *id*, never a path. Resolving the id to a checkout
//! happens on this side, the same way `tool_frontend::resolve` does it, so the
//! frontend never gets to name a directory for the backend to run `git` in.

use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

/// Which of the six things happened to a path.
///
/// Serialized lowercase so it lands in TypeScript as the string union
/// `"modified" | "added" | ...` rather than as capitalized Rust variant names.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

/// One path, in one of the two lists.
///
/// `file`/`dir` are the split of `path` rather than something the frontend
/// derives, because the panel draws the directory as its own dimmer column and
/// splitting a path is not work worth doing twice.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    /// Repo-relative, forward slashes. The identity: what the other commands
    /// take back as an argument.
    pub path: String,
    pub file: String,
    pub dir: String,
    pub kind: GitChangeKind,
    pub staged: bool,
    /// Only ever set when `kind` is `Renamed`. Skipped entirely when absent so
    /// the field is genuinely optional on the TypeScript side rather than
    /// arriving as an explicit `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renamed_from: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<GitFileChange>,
    pub unstaged: Vec<GitFileChange>,
}

/// The two sides of a diff, as whole file contents.
///
/// Not a unified patch: the frontend hands these straight to Monaco's diff
/// editor, which computes its own hunks and wants the full text of each side.
#[derive(Debug, Clone, Serialize)]
pub struct GitDiff {
    pub original: String,
    pub modified: String,
}

/// The changed-file lists, the branch, and how far it has drifted from its
/// upstream.
///
/// `None` — not an error — when the tool has no checkout on disk or the
/// checkout is not a git repository. That is a normal state the panel renders
/// as its empty state, not a failure worth an error dialog.
#[tauri::command]
pub fn git_status(app: AppHandle, id: String) -> Result<Option<GitStatus>> {
    let Some(cwd) = repo(&app, &id)? else {
        return Ok(None);
    };

    let porcelain = run_git(&cwd, "status", &["status", "--porcelain=v1", "-z"])?;
    let (staged, unstaged) = parse_porcelain(&porcelain);

    // A repository with no commits yet has no resolvable HEAD, and one with no
    // upstream has nothing to count against. Both are ordinary states of a
    // fresh checkout, so neither failure is allowed to sink the whole status.
    let branch = run_git(&cwd, "rev-parse", &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|out| out.trim().to_string())
        .unwrap_or_default();

    let (ahead, behind) = run_git(
        &cwd,
        "rev-list",
        &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    )
    .ok()
    .and_then(|out| parse_ahead_behind(&out))
    .unwrap_or((0, 0));

    Ok(Some(GitStatus {
        branch,
        ahead,
        behind,
        staged,
        unstaged,
    }))
}

/// Both sides of one file's diff.
///
/// `staged` picks which pair of revisions to compare: the staged view is
/// HEAD against the index, the unstaged view is the index against the file on
/// disk. A side that does not exist — HEAD for a newly added file, the index
/// for an untracked one — is empty text, which is exactly how the diff editor
/// wants an addition expressed.
#[tauri::command]
pub fn git_diff(app: AppHandle, id: String, path: String, staged: bool) -> Result<GitDiff> {
    let cwd = require_repo(&app, &id, "diff")?;

    if staged {
        return Ok(GitDiff {
            original: show(&cwd, &format!("HEAD:{path}")).unwrap_or_default(),
            modified: show(&cwd, &format!(":{path}")).unwrap_or_default(),
        });
    }

    // The index is the left-hand side whenever the file is tracked at all; HEAD
    // is the fallback for the narrow case of a file git knows about but that
    // has no index entry, and empty text covers untracked files.
    let original = show(&cwd, &format!(":{path}"))
        .or_else(|| show(&cwd, &format!("HEAD:{path}")))
        .unwrap_or_default();

    Ok(GitDiff {
        original,
        // A deleted file reads as an error here, which is the same thing as an
        // empty right-hand side as far as the diff is concerned.
        modified: std::fs::read_to_string(cwd.join(&path)).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn git_stage(app: AppHandle, id: String, paths: Vec<String>) -> Result<()> {
    let cwd = require_repo(&app, &id, "add")?;
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run_git(&cwd, "add", &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(app: AppHandle, id: String, paths: Vec<String>) -> Result<()> {
    let cwd = require_repo(&app, &id, "restore")?;
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    run_git(&cwd, "restore", &args)?;
    Ok(())
}

/// Commit whatever is staged.
///
/// Nothing staged, an empty message, a failing hook: all of those come back
/// from `git` on stderr with a better explanation than this could invent, so
/// they surface as `AppError::Git` carrying git's own words.
#[tauri::command]
pub fn git_commit(app: AppHandle, id: String, message: String) -> Result<()> {
    let cwd = require_repo(&app, &id, "commit")?;
    run_git(&cwd, "commit", &["commit", "-m", &message])?;
    Ok(())
}

// --- resolution --------------------------------------------------------------

/// The checkout to run `git` in, or `None` if this tool has no repository.
///
/// Same lookup as `tool_frontend::resolve`: the id has to name a `[[tool]]` in
/// the current snapshot. An id that doesn't is a programming error on the
/// frontend's part rather than a state to render, hence `UnknownTool`.
fn repo(app: &AppHandle, id: &str) -> Result<Option<PathBuf>> {
    let snapshot = app
        .state::<AppState>()
        .get()
        .ok_or_else(|| AppError::UnknownTool(id.to_string()))?;

    let tool = snapshot
        .tools
        .iter()
        .find(|t| t.spec.id == id)
        .ok_or_else(|| AppError::UnknownTool(id.to_string()))?;

    Ok(tool.is_git_repo.then(|| tool.checkout_path.clone()))
}

/// `repo`, for the commands that have nothing sensible to do without one.
///
/// Only `git_status` can answer "there is no repository here" as a value; a
/// stage or a commit aimed at a non-repository is a call that should never have
/// been made, so it comes back as an error.
fn require_repo(app: &AppHandle, id: &str, op: &str) -> Result<PathBuf> {
    repo(app, id)?.ok_or_else(|| AppError::Git {
        op: op.to_string(),
        reason: format!("`{id}` has no git checkout"),
    })
}

// --- running git -------------------------------------------------------------

/// Run `git` in `cwd` and hand back its stdout.
///
/// `op` is the label that ends up in the error message — passed separately from
/// `args` because the arguments can contain a whole commit message, and an
/// error reading `git commit -m <the user's three paragraphs> failed` helps
/// nobody. Failing to spawn and exiting non-zero collapse to the same error:
/// from the caller's side both mean "git did not answer".
fn run_git(cwd: &Path, op: &str, args: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command.current_dir(cwd).args(args);

    // Without this, every one of these spawns flashes a console window on
    // Windows — and the panel re-runs `status` after every single mutation.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().map_err(|err| AppError::Git {
        op: op.to_string(),
        reason: err.to_string(),
    })?;

    if !output.status.success() {
        return Err(AppError::Git {
            op: op.to_string(),
            reason: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    // Lossy rather than strict: a path or a file's contents can be arbitrary
    // bytes, and a diff of a mostly-text file is worth showing with a few
    // replacement characters in it rather than refusing outright.
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// One blob out of the object database, or `None` if that revision has no such
/// path. The `None` is load-bearing — it is how `git_diff` recognises a side of
/// the comparison that simply doesn't exist.
fn show(cwd: &Path, spec: &str) -> Option<String> {
    run_git(cwd, "show", &["show", spec]).ok()
}

// --- parsing -----------------------------------------------------------------

/// `git rev-list --left-right --count HEAD...@{u}` prints two counts separated
/// by a tab: commits only on the left side (ahead) and only on the right
/// (behind).
fn parse_ahead_behind(out: &str) -> Option<(u32, u32)> {
    let mut counts = out.split_whitespace();
    let ahead = counts.next()?.parse().ok()?;
    let behind = counts.next()?.parse().ok()?;
    Some((ahead, behind))
}

/// Split `git status --porcelain=v1 -z` into the staged and unstaged lists.
///
/// Each entry is `XY<space>PATH\0`, where `X` is what the index says and `Y` is
/// what the working tree says. Renames and copies carry a second
/// NUL-terminated field with the *old* path, immediately after the new one —
/// with `-z` there is no literal `->` separator, which is the whole reason for
/// using `-z` over the human-readable form (that, and paths never being quoted
/// or escaped).
///
/// A path can be changed in the index *and* changed again on disk, in which
/// case both `X` and `Y` are set and the path is emitted into both lists. They
/// are two different diffs and the user has to be able to click either.
fn parse_porcelain(out: &str) -> (Vec<GitFileChange>, Vec<GitFileChange>) {
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    // A plain iterator rather than a `for` loop over the split: a rename entry
    // has to reach forward and consume the following field itself.
    let mut fields = out.split('\0').filter(|field| !field.is_empty());

    while let Some(entry) = fields.next() {
        let mut codes = entry.chars();
        let (Some(x), Some(y)) = (codes.next(), codes.next()) else {
            continue;
        };
        // Byte-indexed past `XY<space>`, which is safe because all three are
        // ASCII whatever the path turns out to be.
        let Some(path) = entry.get(3..) else { continue };

        let renamed_from = if is_rename(x) || is_rename(y) {
            fields.next().map(str::to_string)
        } else {
            None
        };

        // `??` is untracked, and untracked is a working-tree fact only — the
        // leading `?` is not a claim about the index, so it must not produce a
        // staged row.
        if x == '?' {
            unstaged.push(change(path, GitChangeKind::Untracked, false, None));
            continue;
        }

        if let Some(kind) = kind_for(x) {
            let from = rename_source(kind, &renamed_from);
            staged.push(change(path, kind, true, from));
        }
        if let Some(kind) = kind_for(y) {
            let from = rename_source(kind, &renamed_from);
            unstaged.push(change(path, kind, false, from));
        }
    }

    (staged, unstaged)
}

fn is_rename(code: char) -> bool {
    code == 'R' || code == 'C'
}

fn rename_source(kind: GitChangeKind, renamed_from: &Option<String>) -> Option<String> {
    matches!(kind, GitChangeKind::Renamed)
        .then(|| renamed_from.clone())
        .flatten()
}

/// One status letter to one kind. `' '` (unchanged on that side) and `'!'`
/// (ignored, which only appears with `--ignored`) map to nothing, which is how
/// the caller decides a side has no row to emit.
fn kind_for(code: char) -> Option<GitChangeKind> {
    match code {
        'M' | 'T' => Some(GitChangeKind::Modified),
        'A' => Some(GitChangeKind::Added),
        'D' => Some(GitChangeKind::Deleted),
        'R' | 'C' => Some(GitChangeKind::Renamed),
        '?' => Some(GitChangeKind::Untracked),
        'U' => Some(GitChangeKind::Conflicted),
        _ => None,
    }
}

fn change(
    path: &str,
    kind: GitChangeKind,
    staged: bool,
    renamed_from: Option<String>,
) -> GitFileChange {
    let (dir, file) = match path.rsplit_once('/') {
        Some((dir, file)) => (dir.to_string(), file.to_string()),
        None => (String::new(), path.to_string()),
    };

    GitFileChange {
        path: path.to_string(),
        file,
        dir,
        kind,
        staged,
        renamed_from,
    }
}
