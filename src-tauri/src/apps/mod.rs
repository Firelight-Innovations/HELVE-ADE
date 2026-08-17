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
mod trash;

use crate::project;
use crate::shell_state::ShellState;
use helve_rpc::{RpcError, INTERNAL_ERROR, METHOD_NOT_FOUND};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

/// Where a call is happening: which cluster asked, and what that cluster is
/// working on.
///
/// The thing an app's Rust half could not previously know. `app_call` used to
/// carry an *app* id and nothing else, so Files could ask "what is the open
/// project" and get one answer for the whole process — which is exactly the
/// question that stops having a single answer the moment a project belongs to a
/// cluster. Two Files in two clusters must root at two different folders, and
/// nothing in a message body could tell them apart.
///
/// A struct rather than a bare `Option<PathBuf>` because it is going to grow:
/// `Cluster::worktree` is carried in the layout already and joins this as
/// `worktree: Option<WorktreeRef>` when Braden's git work lands. Adding a field
/// then touches this declaration and [`resolve`](Self::resolve) and nothing
/// else — where widening a positional parameter would touch every `Dispatch` in
/// the registry and every call site inside them.
///
/// Both fields are `Option`, and both `None` is an ordinary state rather than a
/// failure: a call can arrive with no instance id (the shell's own menu
/// actions), from an instance whose tab has just closed, or from a cluster
/// nobody has pointed at a project yet. Each app decides what it can still do —
/// Files falls back to the stack root, Home draws the pick-a-project state.
#[derive(Debug, Clone, Default)]
pub struct CallContext {
    /// The cluster the calling surface is in. What Home *writes* a project to.
    pub cluster_id: Option<String>,
    /// That cluster's project, already checked against the disk. What Files
    /// *reads* a root from.
    pub project: Option<PathBuf>,
}

impl CallContext {
    /// Work out where a call is coming from.
    ///
    /// `instance_id` is resolved against the pane trees — an instance is in
    /// whichever cluster's tree holds its id, and no second field records that,
    /// so there is exactly one answer. It is the trustworthy input: the shell
    /// resolves it from `event.source` against its own map of mounted iframes
    /// (`ToolWindow.tsx`), never from anything a frame asserts about itself.
    ///
    /// `cluster_id` is the fallback, and it is for the shell's own calls — File
    /// > Open…, which is a title-bar menu item rather than a frame's request.
    /// The shell knows which cluster its window is showing and has no instance
    /// to name. It loses to a resolved instance deliberately: where both are
    /// present, the one derived from the frame is the one that cannot be stale.
    pub fn resolve(app: &AppHandle, instance_id: Option<&str>, cluster_id: Option<&str>) -> Self {
        let resolved = instance_id
            .and_then(|id| app.state::<ShellState>().cluster_of_instance(id))
            .or_else(|| cluster_id.map(str::to_owned));

        let project = resolved
            .as_deref()
            .and_then(|id| project::cluster_path(app, id));

        Self {
            cluster_id: resolved,
            project,
        }
    }

    /// The cluster to write a project into, or the refusal to hand back.
    ///
    /// Home's four opening methods all need one, and none of them has anything
    /// sensible to do without it: "open this folder" with no cluster to open it
    /// in is not a smaller version of the action, it is a different one. The
    /// message names the state rather than the code path, because the only way
    /// to reach it is a surface whose cluster closed underneath it.
    pub fn require_cluster(&self) -> Result<&str, RpcError> {
        self.cluster_id.as_deref().ok_or_else(|| {
            RpcError::new(
                helve_rpc::INTERNAL_ERROR,
                "there is no cluster to open a project in — this surface is not in one any more",
            )
        })
    }
}

/// An app's Rust half: the function every `invoke` from its frontend lands in.
///
/// `helve/hello` never reaches one of these. The shell answers the handshake
/// itself in `ToolWindow.tsx` — it is the side that knows the session, and an
/// app that had to reimplement the reply could get it wrong.
type Dispatch = fn(&AppHandle, &CallContext, &str, Option<Value>) -> Result<Value, RpcError>;

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
        name: "File Explorer",
        description: "Browse the open project — its folders, and what is in them.",
        call: files::call,
    },
    Registered {
        id: "viewer",
        name: "File Viewer",
        description: "Read and edit open files, in tabs.",
        // **The same dispatch as `files` above, deliberately.**
        //
        // The two are separate *apps* — separate frontends, separate entry
        // points, separate surfaces you can put in two panes — but there is only
        // one filesystem, and `files::call` is the half that talks to it.
        // Giving the Viewer a Rust module of its own would mean a second
        // `files/read`, a second `files/write` and a second copy of the
        // `baseMtime` guard that keeps two writers from clobbering each other:
        // three chances for the pair to disagree, bought in exchange for the
        // appearance of symmetry.
        //
        // What this does *not* share is any state. `files::call` holds none —
        // every method takes its root from the [`CallContext`] the caller
        // resolved, which is a fact about where the *frame* is placed rather
        // than about which app is in it. So a Viewer and an Explorer in one
        // cluster resolve the same project, and the same worktree, while a pair
        // in the next cluster resolve theirs; see
        // `two_apps_in_one_cluster_resolve_the_same_context` below, which is
        // there to keep that true.
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
///
/// **[`TERMINAL_ID`] answers `false` here, and that is deliberate.** A terminal
/// is offered in the same menu as an app now (see [`openables`]) but it is not
/// one, and this function is what four separate things ask before deciding what
/// an id *is*: whether to mount a frontend, whether to look for a tool checkout,
/// whether a preset slot is valid, and which `SurfaceKind` to mint. Widening it
/// would send a terminal down every one of those paths, and each of them ends at
/// a frontend URL that does not exist.
pub fn is_app(id: &str) -> bool {
    REGISTRY.iter().any(|a| a.id == id)
}

// --- what you can open ------------------------------------------------------

/// The type name a terminal surface carries where an app surface carries its app
/// id — in `SurfaceInstance::app_id`'s position, and in an [`Openable`].
///
/// A name rather than a registry entry. It is here, beside `REGISTRY`, because
/// it has to be *excluded* from things far from here (`is_app`, `roster`, the
/// `call` dispatch) and a constant those can be checked against is better than
/// three copies of a string literal.
pub const TERMINAL_ID: &str = "terminal";

/// What kind of thing an [`Openable`] is, which is the same as saying *how the
/// shell opens it*.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenableKind {
    /// Mint an instance and mount its frontend. `id` names a `REGISTRY` entry.
    App,
    /// Spawn a pty and put it in a pane. `id` is [`TERMINAL_ID`], which names no
    /// registry entry and never will.
    Terminal,
}

/// One row in the Apps menu.
///
/// **Note what is not on it: a `url`.** That is the whole reason this is not
/// [`AppInfo`]. A terminal has no frontend — no Vite entry point, no iframe, no
/// origin — it is an xterm canvas the shell draws itself, bound to a pty by id.
/// Giving it an empty or invented URL would put a blank iframe behind every
/// terminal and break the thing that actually renders it, because
/// `state/toolFrontend.ts` resolves a mountable URL straight off the app list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Openable {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub kind: OpenableKind,
}

/// Everything the Apps menu can open: every app, then a terminal.
///
/// ## Why this is a second list and not a wider `REGISTRY`
///
/// `REGISTRY`'s definition of an app is precise and load-bearing — a frontend
/// that is an entry point of this repo's own Vite build, and a Rust half in this
/// module reached over transport B. A terminal has neither. It has no frontend
/// to serve, no `Dispatch` to route an `invoke` to, and a `SurfaceKind` of its
/// own. An entry in `REGISTRY` with an absent URL and an absent dispatch would
/// not be an app with two holes in it; it would be a different kind of thing
/// wearing an app's struct, and every consumer of `REGISTRY` would need a new
/// branch to say so.
///
/// Three of those consumers make the cost concrete, and all three are silent
/// failures rather than compile errors:
///
///   * [`roster`] is what boot blocks on until each app reports a painted
///     frame. A terminal has no frame to report, so a terminal in the roster is
///     a splash screen that waits out its full timeout on **every launch**.
///   * [`is_app`] gates `tool_frontend::resolve`, and a `true` there sends
///     something looking for a frontend down a path that has none.
///   * [`call`] would find a row with no dispatch to call.
///
/// So the union happens here, in one function, and nowhere else. It is in this
/// file rather than in the frontend because the menu's list has always come from
/// Rust — an app added to `REGISTRY` appears in both menu surfaces without a
/// second edit in a file whose author would have no reason to look — and that
/// property is worth keeping even for the one row that will never be in
/// `REGISTRY`.
///
/// The terminal comes last, after the apps, because the apps are the things this
/// build is *about* and the ordering should not shuffle when one is added.
pub fn openables() -> Vec<Openable> {
    REGISTRY
        .iter()
        .map(|a| Openable {
            id: a.id,
            name: a.name,
            description: a.description,
            kind: OpenableKind::App,
        })
        .chain(std::iter::once(Openable {
            id: TERMINAL_ID,
            name: "Terminal",
            // Says *where it lands*, because that is the one thing that is not
            // obvious: the panel already has a "+" that makes a terminal, and
            // this makes a different one. See `commands::open_terminal_in_pane`.
            description: "A shell in a pane of this cluster, rather than in the panel.",
            kind: OpenableKind::Terminal,
        }))
        .collect()
}

/// What a new instance of `id` is called, before its own frontend renames the
/// tab. Falls back to the id, which is what a surface with no registry entry
/// would have shown anyway and is better than an untitled tab.
pub fn display_name(id: &str) -> String {
    REGISTRY
        .iter()
        .find(|a| a.id == id)
        .map(|a| a.name.to_string())
        .unwrap_or_else(|| id.to_string())
}

/// Every app's id and display name, for boot.
///
/// `list` would answer this too, but it builds a URL per app that nobody there
/// wants — and boot asks twice (once for the step count, once for the set it is
/// still waiting on), so it gets the two fields it actually reads. The name is
/// in it because the splash says "Starting Home and Files" rather than naming
/// the ids only a developer knows.
pub fn roster() -> Vec<(&'static str, &'static str)> {
    REGISTRY.iter().map(|a| (a.id, a.name)).collect()
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
///
/// `id` still names the *app*, because that is what decides which code answers:
/// `apps::REGISTRY` has one entry for Files however many Files are open, and
/// none of them holds per-instance state. What the instance decides is not
/// which handler runs but *where* it runs — see [`CallContext`], which the
/// caller has already resolved.
pub fn call(
    app: &AppHandle,
    context: &CallContext,
    id: &str,
    method: &str,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    // Answered by the host, before the app is looked up at all. See
    // `docs/settings.md` §7 for why this is central rather than per-app.
    if method == SETTINGS_METHOD {
        return serde_json::to_value(app.state::<crate::settings::Registry>().snapshot())
            .map_err(|e| RpcError::new(INTERNAL_ERROR, format!("could not read settings: {e}")));
    }

    let Some(registered) = REGISTRY.iter().find(|a| a.id == id) else {
        return Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no app with id `{id}`"),
        ));
    };
    (registered.call)(app, context, method, params)
}

/// What any app frontend calls to read the settings, over the ordinary bridge.
///
/// A method rather than a Tauri command because an app has no door to Tauri, and
/// because a tool in its own process will want the same call later.
pub const SETTINGS_METHOD: &str = "settings/all";

/// Every settings section an app declares — `docs/settings.md` §6. Deliberately
/// not a field on [`Registered`], so that a *tool* can register through this
/// same list without ever being in `REGISTRY`.
pub fn settings_groups() -> &'static [&'static crate::settings::Group] {
    APP_SETTINGS
}

static APP_SETTINGS: &[&crate::settings::Group] = &[&files::SETTINGS];

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

    // --- the Explorer and the Viewer are answered by one filesystem ----------

    /// The two file apps dispatch to the *same* function, and that is what
    /// makes their `CallContext` provably identical rather than merely
    /// probably identical.
    ///
    /// [`CallContext::resolve`] takes the instance id the shell resolved from
    /// `event.source` and asks which cluster's pane tree holds it. Nothing on
    /// that path — not `resolve`, not `cluster_of_instance`, not
    /// `project::cluster_path` — is handed an app id at all, so a `viewer`
    /// frame in a cluster resolves the same project, and the same worktree, as
    /// a `files` frame beside it. This test cannot reach into that path (it
    /// needs an `AppHandle`), but it guards the one thing that would make the
    /// argument stop holding: the day someone gives the Viewer a dispatch of
    /// its own is the day it could start resolving a root differently, and this
    /// fails then rather than silently.
    ///
    /// Why it matters concretely: `files/git-status`, `files/git-hunks` and
    /// `files/git-head` decorate against whatever checkout the context names.
    /// A Viewer that resolved a different one would draw a dirty-diff gutter
    /// against the wrong worktree — no error, no failed call, just wrong hunks,
    /// which is the shape of bug that outlives everyone who could recognise it.
    #[test]
    fn two_apps_in_one_cluster_resolve_the_same_context() {
        let dispatch = |id: &str| {
            REGISTRY
                .iter()
                .find(|a| a.id == id)
                .unwrap_or_else(|| panic!("no `{id}` in the registry"))
                .call
        };

        assert_eq!(
            dispatch("files") as usize,
            dispatch("viewer") as usize,
            "the Explorer and the Viewer must be answered by one implementation — \
             two would be two chances to resolve a different root for the same cluster"
        );
    }

    /// Both file apps are real registry rows, and the Viewer is not a terminal
    /// in disguise: it has a frontend to mount and a dispatch to call, so every
    /// consumer of `REGISTRY` treats it as an app without a special case.
    #[test]
    fn the_viewer_is_an_app_like_any_other() {
        assert!(is_app("viewer"));
        assert!(is_app("files"));
        assert!(
            openables()
                .iter()
                .any(|o| o.id == "viewer" && o.kind == OpenableKind::App),
            "the Apps menu offers it"
        );
        assert!(
            roster().iter().any(|(id, _)| *id == "viewer"),
            "boot knows it can paint — `boot::expected` narrows the roster to what is \
             actually open, so this costs a launch nothing when no Viewer is docked"
        );
    }

    // --- the terminal is offered like an app and is not one ------------------

    #[test]
    fn everything_in_the_registry_is_offered_plus_a_terminal() {
        let offered: Vec<&str> = openables().iter().map(|o| o.id).collect();
        for app in REGISTRY {
            assert!(offered.contains(&app.id), "{} is not offered", app.id);
        }
        assert_eq!(
            offered.last(),
            Some(&TERMINAL_ID),
            "the terminal comes last, after the apps"
        );
        assert_eq!(offered.len(), REGISTRY.len() + 1);
    }

    /// The boot roster is what the splash blocks on until each app reports a
    /// painted frame. A terminal has no frame to report, so a terminal in here
    /// is a launch that waits out the full timeout every single time.
    #[test]
    fn the_terminal_is_not_in_the_boot_roster() {
        assert!(
            !roster().iter().any(|(id, _)| *id == TERMINAL_ID),
            "boot would wait for a paint that can never come"
        );
    }

    /// `is_app` gates `tool_frontend::resolve`, the `SurfaceKind` an instance is
    /// minted with, and whether a preset slot is valid. A `true` here would send
    /// a terminal looking for a frontend URL it does not have.
    #[test]
    fn the_terminal_is_not_an_app_however_it_is_offered() {
        assert!(!is_app(TERMINAL_ID));
    }

    /// A terminal has no Rust half. Reaching the dispatcher with its id has to
    /// be an ordinary method-not-found, not a panic and not the wrong row.
    #[test]
    fn calling_the_terminal_id_is_method_not_found() {
        let registered = REGISTRY.iter().find(|a| a.id == TERMINAL_ID);
        assert!(
            registered.is_none(),
            "`call` finds no row, so it answers METHOD_NOT_FOUND like any unknown id"
        );
    }
}
