//! Where a tool's frontend is served from, and how.
//!
//! A tool mounts into the tool window as an iframe on its own origin — see
//! `docs/tool-protocol.md` §3. That leaves one question the shell has to answer
//! before it can render anything: what URL goes in the `src`.
//!
//! There are two answers, and which one applies is not a preference:
//!   * **In development**, the tool's own Vite server, declared as `frontend.dev-url` in
//!     `helve-tool.toml`. Pointing at it means the tool's hot reload works *inside the real
//!     shell*, which is the whole reason a tool author would run the orchestrator at all.
//!   * **In a release build**, the tool's built `frontend.dist` directory, served over the custom
//!     `helve-tool://` scheme registered below. There is no dev server in a shipped app, and
//!     loading a built bundle off `file://` would put every tool on the same opaque origin — the
//!     exact thing the protocol's origin checks depend on not happening.
//!
//! Everything else — a checkout that isn't there, a manifest that doesn't
//! parse — resolves to `Unavailable` with a reason. The shell renders that as a
//! state rather than as an iframe pointing at nothing.

use crate::error::Result;
use crate::state::AppState;
use helve_tool_manifest::ToolManifest;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The scheme detached and docked tool frames are served on in release builds.
/// Tauri rewrites this per-platform (`helve-tool://…` on macOS and Linux,
/// `http://helve-tool.localhost/…` on Windows); the frontend never constructs
/// one of these by hand, it only ever uses what this module hands back.
pub const SCHEME: &str = "helve-tool";

/// What the tool window should do about a given tool.
///
/// Serialized with an internal `state` tag so it lands in TypeScript as a
/// discriminated union, the same shape as `ToolStatus` — narrow on `state` and
/// the extra fields come with it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum ToolFrontend {
    /// Point the iframe here. The tool's own dev server, or its bundle.
    Mountable { url: String },
    /// Nothing to mount, and why. The shell shows this, it does not retry.
    Unavailable { reason: String },
}

/// Resolve one tool's frontend.
pub fn resolve(app: &AppHandle, id: &str) -> Result<ToolFrontend> {
    // A first-party app resolves before the stack is consulted, and cannot fail.
    // It ships in this binary rather than in a checkout, so none of the states
    // below can apply to one: there is nothing to clone, nothing to build, and
    // no manifest of its own to be malformed. See `apps::entry_url`.
    if crate::apps::is_app(id) {
        return Ok(ToolFrontend::Mountable {
            url: crate::apps::entry_url(id),
        });
    }

    let state = app.state::<AppState>();
    let Some(snapshot) = state.get() else {
        return Ok(ToolFrontend::Unavailable {
            reason: "the stack has not been scanned yet".to_string(),
        });
    };

    let Some(tool) = snapshot.tools.iter().find(|t| t.spec.id == id) else {
        return Ok(ToolFrontend::Unavailable {
            reason: format!("no tool with id `{id}` in helve.toml"),
        });
    };

    if !tool.checkout_path.is_dir() {
        // The same condition the switcher renders as "not installed". Worded
        // for a person, not for a log.
        return Ok(ToolFrontend::Unavailable {
            reason: "not installed".to_string(),
        });
    }

    let manifest = match ToolManifest::load(&tool.checkout_path) {
        Ok(m) => m,
        Err(err) => {
            return Ok(ToolFrontend::Unavailable {
                reason: format!("helve-tool.toml: {err}"),
            })
        }
    };

    // `cfg!(debug_assertions)` rather than a runtime flag: a release build must
    // not be able to point a tool frame at localhost, no matter what a manifest
    // in a checkout says.
    if cfg!(debug_assertions) {
        if let Some(url) = manifest.frontend.dev_url.as_ref() {
            return Ok(ToolFrontend::Mountable { url: url.clone() });
        }
    }

    let dist = manifest.resolve_dist(&tool.checkout_path);
    if !dist.join("index.html").is_file() {
        return Ok(ToolFrontend::Unavailable {
            reason: "the tool's frontend has not been built".to_string(),
        });
    }

    Ok(ToolFrontend::Mountable {
        url: format!("{SCHEME}://localhost/{id}/index.html"),
    })
}

/// Serve a file out of a tool's built `dist` directory.
///
/// Registered on the builder in `lib.rs`. The path arrives as
/// `/<tool-id>/<rest>`; the tool id is looked up in the current stack snapshot,
/// so a request can only ever reach a directory some `[[tool]]` in helve.toml
/// actually points at.
pub fn serve(app: &AppHandle, path: &str) -> (u16, &'static str, Vec<u8>) {
    let trimmed = path.trim_start_matches('/');
    let Some((id, rest)) = trimmed.split_once('/') else {
        return (400, "text/plain", b"malformed tool asset path".to_vec());
    };

    let Some(snapshot) = app.state::<AppState>().get() else {
        return (503, "text/plain", b"stack not scanned".to_vec());
    };
    let Some(tool) = snapshot.tools.iter().find(|t| t.spec.id == id) else {
        return (404, "text/plain", b"unknown tool".to_vec());
    };
    let Ok(manifest) = ToolManifest::load(&tool.checkout_path) else {
        return (404, "text/plain", b"unreadable tool manifest".to_vec());
    };

    let dist = manifest.resolve_dist(&tool.checkout_path);
    let Some(file) = safe_join(&dist, rest) else {
        // A `..` segment, an absolute path, or a symlink pointing out of the
        // checkout. Refusing rather than clamping: a request that tried to
        // leave the directory is not a request worth guessing the intent of.
        return (
            403,
            "text/plain",
            b"outside the tool's dist directory".to_vec(),
        );
    };

    match std::fs::read(&file) {
        Ok(bytes) => (200, mime_for(&file), bytes),
        Err(_) => (404, "text/plain", b"not found".to_vec()),
    }
}

/// Join `rest` onto `root` and prove the result is still inside it.
///
/// Canonicalising both sides is what makes this safe against `..` *and* against
/// symlinks — a purely textual check would pass a link inside `dist` that
/// points at the user's home directory.
fn safe_join(root: &Path, rest: &str) -> Option<PathBuf> {
    let candidate = root.join(rest);
    let root = root.canonicalize().ok()?;
    let candidate = candidate.canonicalize().ok()?;
    candidate.starts_with(&root).then_some(candidate)
}

/// Enough of a MIME table for a built web frontend. Anything unrecognised is
/// served as bytes rather than guessed at — a wrong `Content-Type` on a script
/// fails in a much more confusing way than a missing one.
fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html",
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}
