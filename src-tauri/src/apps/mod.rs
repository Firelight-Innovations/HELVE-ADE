//! First-party apps — the surfaces this repo ships itself.
//!
//! To the shell an app and a tool are the same thing: a tab in the switcher bar
//! and an iframe in the tool window, speaking transport B of
//! `docs/tool-protocol.md`. What differs is where the two halves come from, and
//! that difference is the whole reason apps are their own concept.
//!
//! A **tool** is another repository. Its frontend is served out of its own
//! checkout, and its Rust core is a child process the shell spawns and talks to
//! over the standard streams — two processes, two transports, joined by a broker
//! that is not built yet.
//!
//! An **app** ships inside the orchestrator. Its frontend is an extra entry
//! point in this repo's own Vite config, so it is served by the same asset host
//! the shell is, and its Rust half is a module right here — reached over
//! transport B, dispatched by [`call`] below, with no child process and no
//! broker in between.
//!
//! That last part is a deliberate choice, not a shortcut. Home and Files exist
//! to show what the orchestrator already knows: the stack snapshot, the open
//! project, the filesystem. Putting a pipe between the shell and a process that
//! would only have to ask the shell for all of it again is shipping an IPC
//! boundary in order to talk to ourselves. A tool needs that boundary because it
//! is someone else's code on its own release cycle; an app is this code.
//!
//! What the two do share is the *frontend* contract. An app's UI imports
//! `@helve/bridge` and calls `invoke("home/stack")` exactly as a tool's UI calls
//! `invoke("echo")`, and neither one knows which kind of host answered. So an
//! app can become a tool later — or a tool be absorbed into the shell — without
//! its interface code changing.

mod files;
mod home;

use helve_rpc::{RpcError, METHOD_NOT_FOUND};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

/// One app, as the switcher bar needs to see it.
///
/// `url` is included rather than left for the frontend to construct, for the
/// same reason `tool_frontend` hands back a resolved URL: the shell mounts what
/// it is given and never builds an iframe address by hand. Today every app's
/// URL follows one pattern, but that is a fact about how this repo happens to
/// build them, not a promise to the shell.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub url: String,
}

/// An app's Rust half: the function every `invoke` from its frontend lands in.
///
/// `helve/hello` never reaches one of these. The shell answers the handshake
/// itself in `ToolWindow.tsx` — it is the side that knows the session, and an
/// app that had to reimplement the reply could get it wrong.
type Dispatch = fn(&AppHandle, &str, Option<Value>) -> Result<Value, RpcError>;

struct Registered {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    call: Dispatch,
}

/// Every app this build ships, in the order they appear in the switcher bar.
///
/// Compiled in rather than declared in `helve.toml`, because that manifest
/// answers a different question. It pins *other repositories* at versions this
/// orchestrator expects, and every state it can report — needs update, not
/// installed — is about a checkout that might not be there. An app is in the
/// binary. There is no version to disagree with and no way for it to be missing,
/// so a manifest entry for one would be a row that can only ever say "fine".
const REGISTRY: &[Registered] = &[
    Registered {
        id: "home",
        name: "Home",
        description: "Where a session starts — open a project, or pick up a recent one.",
        call: home::call,
    },
    Registered {
        id: "files",
        name: "Files",
        description: "Browse the open project, and read or edit what is in it.",
        call: files::call,
    },
];

/// Every app, for the switcher bar.
pub fn list() -> Vec<AppInfo> {
    REGISTRY
        .iter()
        .map(|a| AppInfo {
            id: a.id,
            name: a.name,
            description: a.description,
            url: entry_url(a.id),
        })
        .collect()
}

/// Whether an id names an app rather than a tool. `tool_frontend::resolve`
/// asks this first, so the two id spaces resolve through one door.
pub fn is_app(id: &str) -> bool {
    REGISTRY.iter().any(|a| a.id == id)
}

/// Where an app's frontend is served from.
///
/// Root-relative on purpose, so it resolves against whatever origin the shell
/// itself is on — a Vite dev server in development, Tauri's asset host in a
/// release build — and this never has to know which of those it is. That works
/// because an app's `index.html` is an entry point of the shell's own Vite
/// build (see `vite.config.ts`), so it lands at the same path in `dist/` that it
/// occupies in the source tree.
///
/// The consequence worth naming: an app frame is *same-origin* with the shell,
/// where a tool frame deliberately is not. The protocol's identity rule does not
/// depend on that — `ToolWindow` resolves which surface sent a message from
/// `event.source` against its own map of mounted iframes, never from the
/// message body or its origin — but a tool is untrusted code and an app is not,
/// and only the first of those earns the cost of a separate origin.
pub fn entry_url(id: &str) -> String {
    format!("/apps/{id}/ui/index.html")
}

/// Route one `invoke` from an app's frontend to that app's Rust half.
pub fn call(app: &AppHandle, id: &str, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
    let Some(registered) = REGISTRY.iter().find(|a| a.id == id) else {
        return Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no app with id `{id}`"),
        ));
    };
    (registered.call)(app, method, params)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ids reach the frontend as URL path segments and as the key the shell
    /// routes messages by, so a duplicate would mean two surfaces answering to
    /// one name — with `find` silently picking the first.
    #[test]
    fn app_ids_are_unique() {
        let mut ids: Vec<&str> = REGISTRY.iter().map(|a| a.id).collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(total, ids.len(), "duplicate app id in the registry");
    }

    /// The same rule `helve-tool.toml` holds tools to (`^[a-z][a-z0-9-]*$`),
    /// applied here for the same reason: an id ends up in a URL.
    #[test]
    fn app_ids_are_url_safe() {
        for app in REGISTRY {
            let mut chars = app.id.chars();
            assert!(
                matches!(chars.next(), Some(c) if c.is_ascii_lowercase()),
                "app id {:?} must start with a lowercase letter",
                app.id
            );
            assert!(
                chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "app id {:?} must match ^[a-z][a-z0-9-]*$",
                app.id
            );
        }
    }

    #[test]
    fn an_unknown_app_id_is_method_not_found_rather_than_a_panic() {
        assert!(!is_app("nonesuch"));
    }
}
