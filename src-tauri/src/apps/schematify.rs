//! Schematify's Rust half — the design layer of OpenKaava. A module here,
//! registered like Home and Files, per `docs/design/SCHEMATIFY-PRD.md` §1.3.
//!
//! A thin JSON-RPC layer over `schematify-core`: this file resolves a
//! project root from [`CallContext`], turns request `params` into typed
//! arguments, calls the crate, and shapes the answer back into JSON. One
//! dispatch function rather than one `#[tauri::command]` per operation,
//! matching `home.rs` and `files.rs` (`docs/audits/schematify-baseline.md` §11).
//!
//! PRD §14.5 lists ten operations; this file wires seven, plus
//! `schematify/state` from wave 1a. `transition`, `ingest-run` and `search`
//! stay unwired — see `docs/overnight-jobs/overnight-2/handoffs/wiring.md`.
//! Wave 10c adds the product layer's 5 writes: one screen, one flow, the
//! brief, and 2 decision-log operations. `write-decision` and
//! `supersede-decision` are separate methods on purpose — that split **is**
//! the PRD §5.9 enforcement: neither can edit an existing decision's content
//! in place or delete a decision file.
//!
//! Decision SCH-API-003 puts an `actor` on every operation; [`actor_param`]
//! refuses a call that omits it rather than defaulting it.

use std::fs;
use std::path::Path;

use crate::apps::CallContext;
use kaava_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND};
use schematify_core::{
    lint, load_project, CoreError, Decision, DecisionStatus, Edge, Flow, Node, ProjectBrief,
    Screen, Store, Uuid,
};
use serde_json::{json, Value};
use tauri::AppHandle;

/// What `schematify/state` reports.
///
/// `project` mirrors what [`CallContext`] resolved rather than anything
/// Schematify has read for itself — there is no `.kaava/` graph read yet, so
/// the one honest thing to say is *where* it would look once there is. `ready`
/// is the field the frontend keys its empty state off; it is `false` in every
/// build until a real Schematic surface lands behind it, at which point it
/// earns a second value rather than being deleted.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    project: Option<String>,
    ready: bool,
}

fn state(context: &CallContext) -> Result<Value, RpcError> {
    let state = State {
        project: context
            .project
            .as_ref()
            .map(|path| path.display().to_string()),
        ready: false,
    };

    serde_json::to_value(&state)
        .map_err(|e| RpcError::new(INTERNAL_ERROR, format!("could not answer: {e}")))
}

/// The method match, kept separate from [`call`] so it can be tested without an
/// `AppHandle`. Schematify reads nothing off the handle for any method below —
/// every one of them goes through [`CallContext`] and the filesystem — so
/// threading a live handle through a test would only be there to satisfy the
/// type and not because anything used it.
fn dispatch(context: &CallContext, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
    match method {
        "schematify/state" => state(context),
        "schematify/open-project" => open_project(context, params.as_ref()),
        "schematify/load-graph" => load_graph(context, params.as_ref()),
        "schematify/write-node" => write_node(context, params.as_ref()),
        "schematify/write-edge" => write_edge(context, params.as_ref()),
        "schematify/write-layout" => write_layout(context, params.as_ref()),
        "schematify/read-layout" => read_layout(context, params.as_ref()),
        "schematify/lint" => lint_graph(context, params.as_ref()),
        "schematify/reconcile-status" => reconcile_status(context, params.as_ref()),
        "schematify/write-screen" => write_screen(context, params.as_ref()),
        "schematify/write-flow" => write_flow(context, params.as_ref()),
        "schematify/write-brief" => write_brief(context, params.as_ref()),
        "schematify/write-decision" => write_decision(context, params.as_ref()),
        "schematify/supersede-decision" => supersede_decision(context, params.as_ref()),
        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
}

/// Route one `invoke` from the Schematify app. See [`dispatch`] for the actual
/// matching.
pub fn call(
    _app: &AppHandle,
    context: &CallContext,
    method: &str,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    dispatch(context, method, params)
}

// --- Shared parameter and context helpers -------------------------------

/// The project root this call's cluster is pointed at, or the refusal to hand
/// back. Every method below except `schematify/state` needs a real directory
/// to read or write against, and a defaulted root would silently point one
/// cluster's write at another's project.
fn require_project(context: &CallContext) -> Result<&Path, RpcError> {
    context.project.as_deref().ok_or_else(|| {
        RpcError::new(
            INTERNAL_ERROR,
            "no project is open in this cluster — open one in Home first",
        )
    })
}

/// The `actor` every one of these operations carries, per decision
/// SCH-API-003. Refused rather than defaulted: wave 10 enforces a human-only
/// gate at this boundary, and a defaulted actor would make that gate
/// meaningless. Unused past validation today — no method here yet reaches a
/// lifecycle transition — but every call still has to say who it is.
fn actor_param(params: Option<&Value>) -> Result<&'static str, RpcError> {
    match params.and_then(|p| p.get("actor")).and_then(Value::as_str) {
        Some("human") => Ok("human"),
        Some("agent") => Ok("agent"),
        Some(other) => Err(RpcError::new(
            INVALID_PARAMS,
            format!("actor must be \"human\" or \"agent\", got {other:?}"),
        )),
        None => Err(RpcError::new(INVALID_PARAMS, "actor is required")),
    }
}

/// A required string parameter, by field name.
fn string_param(params: Option<&Value>, field: &str) -> Result<String, RpcError> {
    match params.and_then(|p| p.get(field)).and_then(Value::as_str) {
        Some(text) if !text.is_empty() => Ok(text.to_owned()),
        Some(_) => Err(RpcError::new(
            INVALID_PARAMS,
            format!("{field} must be a non-empty string"),
        )),
        None => Err(RpcError::new(
            INVALID_PARAMS,
            format!("{field} is required"),
        )),
    }
}

/// A required object-shaped parameter, by field name, deserialized into `T`.
fn typed_param<T: serde::de::DeserializeOwned>(
    params: Option<&Value>,
    field: &str,
) -> Result<T, RpcError> {
    let raw = params
        .and_then(|p| p.get(field))
        .ok_or_else(|| RpcError::new(INVALID_PARAMS, format!("{field} is required")))?;
    serde_json::from_value(raw.clone())
        .map_err(|e| RpcError::new(INVALID_PARAMS, format!("{field} is malformed: {e}")))
}

/// Every [`CoreError`] this file can hit is a filesystem or parse failure the
/// caller can only react to by reading the message, so all of them become
/// `-32603` here — the same rule `home.rs`'s own `rpc` helper states.
fn core_rpc(error: CoreError) -> RpcError {
    RpcError::new(INTERNAL_ERROR, error.to_string())
}

// --- Methods --------------------------------------------------------------

/// `schematify/open-project`. Opens a project root and validates `.kaava/`
/// under it, per PRD §14.5. "Opens" is `CallContext` resolving the cluster's
/// project, already done before this function runs — what this method adds is
/// telling the caller whether that project actually holds a `.kaava/` tree,
/// so a frontend can offer to create one rather than fail load-graph with a
/// confusing error.
fn open_project(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let store = Store::open(root);
    let kaava_dir = store.kaava_dir();

    Ok(json!({
        "path": root.display().to_string(),
        "kaavaDir": kaava_dir.display().to_string(),
        "exists": kaava_dir.is_dir(),
    }))
}

/// `schematify/load-graph`. Walks `.kaava/` and returns every semantic file it
/// found, alongside the validation report PRD §6.4 asks for. `Graph` itself
/// does not implement `Serialize` — it is an in-memory index, not a wire type
/// — so this shapes the answer by hand from its accessors rather than
/// serializing it directly, and the same is true of `Report`'s own contents
/// (`Quarantine`, `IdCollision`, and friends carry no `Serialize` either,
/// deliberately: `crates/schematify-core` is a library, not a wire protocol).
fn load_graph(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;

    let outcome = load_project(root).map_err(core_rpc)?;
    let graph = outcome.graph;
    let report = outcome.report;

    let nodes: Vec<&Node> = graph.nodes().collect();
    let edges: Vec<&Edge> = graph.edges().collect();

    let quarantined: Vec<Value> = report
        .quarantined
        .iter()
        .map(|q| {
            json!({
                "subject": q.subject,
                "field": q.field,
                "reference": q.reference,
                "reason": q.reason.as_str(),
                "file": q.file.display().to_string(),
            })
        })
        .collect();
    let unreadable: Vec<Value> = report
        .unreadable
        .iter()
        .map(|p| {
            json!({
                "file": p.file.display().to_string(),
                "error": p.error.to_string(),
            })
        })
        .collect();
    let slug_collisions: Vec<String> = report
        .slug_collisions
        .iter()
        .map(std::string::ToString::to_string)
        .collect();
    let id_collisions: Vec<Value> = report
        .id_collisions
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "kept": c.kept.display().to_string(),
                "discarded": c.discarded.display().to_string(),
            })
        })
        .collect();
    let misnamed: Vec<Value> = report
        .misnamed
        .iter()
        .map(|m| {
            json!({
                "id": m.id,
                "file": m.file.display().to_string(),
            })
        })
        .collect();

    Ok(json!({
        "graph": {
            "nodes": nodes,
            "edges": edges,
            "screens": graph.screens().collect::<Vec<_>>(),
            "flows": graph.flows().collect::<Vec<_>>(),
            "decisions": graph.decisions().collect::<Vec<_>>(),
            "rules": graph.rules().collect::<Vec<_>>(),
            "libraries": graph.libraries(),
            "brief": graph.brief(),
        },
        "report": {
            "clean": report.is_clean(),
            "quarantined": quarantined,
            "unreadable": unreadable,
            "slugCollisions": slug_collisions,
            "idCollisions": id_collisions,
            "misnamed": misnamed,
            "durationMs": report.duration_ms,
        },
    }))
}

/// `schematify/write-node`. Writes exactly one node file, per PRD §6.1's
/// one-node-per-file rule. `params.node` is the whole node — envelope and
/// kind-specific fields flattened together, the same shape `Node` reads off
/// disk — so the frontend constructs it once rather than this handler
/// re-deriving fields it cannot know (a title, a slug, an `authored_by`).
fn write_node(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let node: Node = typed_param(params, "node")?;

    let store = Store::open(root);
    let path = store.node_path(node.id());
    store.write_node(&node).map_err(core_rpc)?;

    Ok(json!({ "id": node.id(), "path": path.display().to_string() }))
}

/// `schematify/write-edge`. Writes one edge file — unless it is a `contains`
/// edge, which `Store::write_edge` refuses to write at all, because
/// containment lives on the child node's `parent` field per PRD §4.1 and a
/// second copy in `edges/` would be a second truth. `stored: false` in the
/// response is how the frontend tells the two cases apart.
fn write_edge(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let edge: Edge = typed_param(params, "edge")?;

    let store = Store::open(root);
    let stored = store.write_edge(&edge).map_err(core_rpc)?;
    let path = stored.then(|| store.edge_path(edge.id).display().to_string());

    Ok(json!({ "id": edge.id, "stored": stored, "path": path }))
}

/// `schematify/write-layout`. Writes `layout/<slug>.json` and nothing else —
/// the enforcement point for PRD §6.2: a node drag must never dirty a
/// semantic file.
///
/// This does **not** go through `schematify_core::Layout`/`Placement`. That
/// pair models positions alone (PRD §5.10's minimal reading), while
/// `apps/schematify/ui/src/graph/layout.ts`'s `LayoutFile` — what wave 3's
/// engine actually reads and writes — also carries a `version`, a combined
/// `viewport`, and whole `LayoutAnnotation` records (title, author, body) for
/// groups and comments that `Placement` has nowhere to put. Re-shaping the
/// frontend's file to fit the narrower crate type would lose the annotation
/// tier on every write; re-widening the crate type is a wave 3/crate
/// decision, not this wave's to make silently. So this handler writes
/// whatever JSON object the frontend sends, verbatim, through the same atomic
/// writer `Store` itself uses, at the same path `Store::layout_path` computes
/// — honest about the mismatch rather than papering over it. See the wiring
/// handoff for the record of this decision.
fn write_layout(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let slug = string_param(params, "slug")?;
    let layout = params
        .and_then(|p| p.get("layout"))
        .filter(|v| v.is_object())
        .ok_or_else(|| RpcError::new(INVALID_PARAMS, "layout must be an object"))?;

    let store = Store::open(root);
    let path = store.layout_path(&slug);
    schematify_core::write_json_atomic(&path, layout)
        .map_err(|e| RpcError::new(INTERNAL_ERROR, e.to_string()))?;

    Ok(json!({ "path": path.display().to_string() }))
}

/// `schematify/read-layout`. The read half of the pair above: `null` when the
/// Schematic has no layout file yet (the first-run state PRD §12.20 draws,
/// not an error), otherwise the raw JSON object last written by
/// `schematify/write-layout`.
///
/// Not one of PRD §14.5's ten named operations — the table lists a writer for
/// every layer but no reader for the cosmetic one, which would leave
/// `openSchematic` (`apps/schematify/ui/src/engine/index.ts`) with a write-only
/// seam. `docs/overnight-jobs/overnight-2/00-AGENT-CONTEXT.md` says to pick the
/// simplest reading where a source is silent and continue; a Schematic that
/// can save a layout but never load one back is not a smaller version of PRD
/// §12.3, it is a different, broken one.
fn read_layout(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let slug = string_param(params, "slug")?;

    let store = Store::open(root);
    read_json_object_or_null(&store.layout_path(&slug))
}

/// A JSON object read verbatim from `path`, or `Value::Null` when the file
/// does not exist — the first-run state every caller of this helper treats
/// as ordinary rather than an error. Shared by `read_layout` and
/// `reconcile_status`: both read a file this crate defines the *location*
/// of but not, for this app's purposes, a typed shape to deserialize into
/// (see `write_layout`'s doc comment for why, and the wiring handoff for
/// `reconcile.json` specifically — its true on-disk shape is
/// `schematify-reconcile`'s own `NodeReconcileFile`, not
/// `schematify_core::ReconcileResult`, so reading it as anything but raw
/// JSON would be guessing which of two live shapes is the real one).
fn read_json_object_or_null(path: &std::path::Path) -> Result<Value, RpcError> {
    if !path.is_file() {
        return Ok(Value::Null);
    }

    let text = fs::read_to_string(path).map_err(|source| {
        core_rpc(CoreError::Io {
            path: path.to_path_buf(),
            source,
        })
    })?;
    let value: Value = serde_json::from_str(&text).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("{} does not hold valid JSON: {e}", path.display()),
        )
    })?;

    if !value.is_object() {
        return Err(RpcError::new(
            INTERNAL_ERROR,
            format!("{} does not hold a JSON object", path.display()),
        ));
    }

    Ok(value)
}

/// `schematify/lint`. Loads the project and runs `schematify_core::lint`
/// over the graph it built, returning the whole `LintReport` — findings,
/// sorted errors-then-warnings, and the 4 input counts a test (or a status
/// bar) can check the run actually walked something. `Finding` and its
/// `Location` are fully `Serialize`, unlike `Graph`/`Report` in
/// `load_graph`, so this needs no hand-shaping.
fn lint_graph(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let outcome = load_project(root).map_err(core_rpc)?;
    let report = lint(&outcome.graph);

    serde_json::to_value(&report).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("could not shape the lint report: {e}"),
        )
    })
}

/// `schematify/reconcile-status`. Reads `runs/<node-uuid>/reconcile.json`
/// verbatim (see `read_json_object_or_null`), or `null` when the node has
/// never been reconciled. `node` is required and must parse as a UUID —
/// `schematify-reconcile` names the directory by the node's identifier, not
/// its slug, so a caller supplies the same `node.id` `load-graph` returned.
fn reconcile_status(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let node = string_param(params, "node")?;
    let node_id = Uuid::parse_str(&node)
        .map_err(|e| RpcError::new(INVALID_PARAMS, format!("node must be a UUID: {e}")))?;

    let store = Store::open(root);
    let path = store
        .kaava_dir()
        .join("runs")
        .join(node_id.to_string())
        .join("reconcile.json");
    read_json_object_or_null(&path)
}

// --- The product layer: screens, flows, the brief, and the decision log ---

/// `schematify/write-screen`. Writes one screen file (PRD §5.7). A screen
/// carries no append-only rule — PRD §12.17 draws a per-screen editor with
/// no such restriction, unlike the decision log — so this upserts by id,
/// the same shape as `write_node`.
fn write_screen(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let screen: Screen = typed_param(params, "screen")?;

    let store = Store::open(root);
    let path = store.screen_path(screen.id);
    store.write_screen(&screen).map_err(core_rpc)?;

    Ok(json!({ "id": screen.id, "path": path.display().to_string() }))
}

/// `schematify/write-flow`. Writes one flow file (PRD §5.8). Freely
/// editable, the same reasoning as `write_screen`.
fn write_flow(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let flow: Flow = typed_param(params, "flow")?;

    let store = Store::open(root);
    let path = store.flow_path(flow.id);
    store.write_flow(&flow).map_err(core_rpc)?;

    Ok(json!({ "id": flow.id, "path": path.display().to_string() }))
}

/// `schematify/write-brief`. Writes `brief.json` (PRD §5.12) — the one
/// semantic file addressed by no UUID, so a caller supplies no id and this
/// method always writes the same path.
fn write_brief(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let brief: ProjectBrief = typed_param(params, "brief")?;

    let store = Store::open(root);
    let path = store.brief_path();
    store.write_brief(&brief).map_err(core_rpc)?;

    Ok(json!({ "path": path.display().to_string() }))
}

/// `schematify/write-decision`. Creates exactly one new, standing decision
/// row — never a second write to an existing one. PRD §5.9: "Schematify
/// shall never edit a decision row in place." A disabled edit control (PRD
/// §12.18) proves nothing about a JSON-RPC caller, so the refusal lives
/// here: a payload naming an id that already has a file is refused outright,
/// and so is a payload that arrives already claiming a supersession — the
/// only door to `SUPERSEDED` is `schematify/supersede_decision` below, which
/// is also the only method allowed to touch a second, existing file.
fn write_decision(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let decision: Decision = typed_param(params, "decision")?;

    if decision.status != DecisionStatus::Active
        || decision.supersedes.is_some()
        || decision.superseded_by.is_some()
    {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "a new decision must be active and name no supersession — use schematify/supersede-decision to replace one",
        ));
    }

    let store = Store::open(root);
    let path = store.decision_path(decision.id);
    if path.is_file() {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "a decision row already exists at this id and cannot be edited in place",
        ));
    }

    store.write_decision(&decision).map_err(core_rpc)?;
    Ok(json!({ "id": decision.id, "path": path.display().to_string() }))
}

/// `schematify/supersede-decision`. The one path PRD §5.9's "a change adds a
/// new row and marks the prior row `SUPERSEDED`" reaches. Writes a brand new
/// decision (the same pre-conditions as `write_decision`, plus the server —
/// never the caller — deciding its `supersedes`/`superseded_by`), then
/// rewrites the prior row from the copy already on disk, changing only
/// `status` and `superseded_by`. A caller cannot smuggle a changed title,
/// context, decision, consequences or date onto the prior row through this
/// method: every other field on it comes back off the file that was already
/// there, never off the request body.
///
/// The successor is written before the prior row is updated. A failure
/// between the two leaves two `ACTIVE` rows rather than a `SUPERSEDED` row
/// whose `superseded_by` names a file that was never written — the second
/// shape is `Decision::is_superseded_without_successor`, a condition the
/// linter already reports (PRD §5.9's rule L07); the first is not, and is
/// also the state a retried call heals on its own.
fn supersede_decision(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let prior_id = string_param(params, "priorId")?;
    let prior_id = Uuid::parse_str(&prior_id)
        .map_err(|e| RpcError::new(INVALID_PARAMS, format!("priorId must be a UUID: {e}")))?;
    let mut successor: Decision = typed_param(params, "decision")?;

    let store = Store::open(root);
    let prior_path = store.decision_path(prior_id);
    let prior_text = fs::read_to_string(&prior_path).map_err(|_| {
        RpcError::new(
            INVALID_PARAMS,
            format!("no decision row exists at {prior_id} to supersede"),
        )
    })?;
    let mut prior: Decision = serde_json::from_str(&prior_text).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!(
                "{} does not hold a valid decision: {e}",
                prior_path.display()
            ),
        )
    })?;
    if prior.status != DecisionStatus::Active {
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!("decision {prior_id} is already superseded and cannot be superseded again"),
        ));
    }

    // The server decides the successor's own supersession fields, never the
    // caller — a payload naming a different `supersedes`, or one already
    // claiming `superseded_by`, is overwritten rather than trusted, since
    // trusting it would let a client point a new row at the wrong prior
    // decision or fabricate a chain that never happened.
    successor.status = DecisionStatus::Active;
    successor.supersedes = Some(prior_id);
    successor.superseded_by = None;
    if successor.id == prior_id {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "a successor decision needs its own id, distinct from the row it supersedes",
        ));
    }
    let successor_path = store.decision_path(successor.id);
    if successor_path.is_file() {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "a decision row already exists at this id and cannot be edited in place",
        ));
    }

    // Only these 2 fields move on the prior row. Everything else — title,
    // context, decision, consequences, date, supersedes — is the value
    // already on disk, read above, never the caller's payload.
    prior.status = DecisionStatus::Superseded;
    prior.superseded_by = Some(successor.id);

    store.write_decision(&successor).map_err(core_rpc)?;
    store.write_decision(&prior).map_err(core_rpc)?;

    Ok(json!({
        "id": successor.id,
        "path": successor_path.display().to_string(),
        "priorId": prior_id,
        "priorPath": prior_path.display().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A temp directory that cleans itself up, following `apps/files.rs` and
    /// `project/marker.rs` — these tests are about what a real filesystem
    /// does (atomic writes, directory creation), and a fake one would only be
    /// testing the fake.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let dir = std::env::temp_dir().join(format!("kaava-schematify-{tag}-{stamp}"));
            fs::create_dir_all(&dir).expect("temp dir");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn context_at(root: &Path) -> CallContext {
        CallContext {
            cluster_id: Some("cluster-1".to_string()),
            project: Some(root.to_path_buf()),
        }
    }

    #[test]
    fn state_reports_the_resolved_project_and_is_honestly_not_ready() {
        let context = CallContext {
            cluster_id: Some("cluster-1".to_string()),
            project: Some(PathBuf::from("/repo")),
        };

        let value =
            dispatch(&context, "schematify/state", None).expect("schematify/state does not fail");
        assert_eq!(value["ready"], false);
        assert_eq!(value["project"], "/repo");
    }

    #[test]
    fn state_reports_no_project_as_null_rather_than_guessing() {
        let context = CallContext::default();
        let value = dispatch(&context, "schematify/state", None)
            .expect("schematify/state does not fail with no project");
        assert!(value["project"].is_null());
    }

    #[test]
    fn an_unknown_method_is_method_not_found() {
        let context = CallContext::default();
        let err =
            dispatch(&context, "schematify/nonesuch", None).expect_err("unknown method is refused");
        assert_eq!(err.code, METHOD_NOT_FOUND);
    }

    #[test]
    fn every_method_below_state_refuses_a_missing_actor() {
        let context = CallContext::default();
        for method in [
            "schematify/open-project",
            "schematify/load-graph",
            "schematify/write-node",
            "schematify/write-edge",
            "schematify/write-layout",
            "schematify/read-layout",
            "schematify/lint",
            "schematify/reconcile-status",
            "schematify/write-screen",
            "schematify/write-flow",
            "schematify/write-brief",
            "schematify/write-decision",
            "schematify/supersede-decision",
        ] {
            let err = dispatch(&context, method, Some(json!({})))
                .expect_err(&format!("{method} requires an actor"));
            assert_eq!(err.code, INVALID_PARAMS, "method: {method}");
        }
    }

    #[test]
    fn every_method_below_state_refuses_a_call_with_no_open_project() {
        let context = CallContext::default();
        for method in [
            "schematify/open-project",
            "schematify/load-graph",
            "schematify/write-node",
            "schematify/write-edge",
            "schematify/write-layout",
            "schematify/read-layout",
            "schematify/lint",
            "schematify/reconcile-status",
            "schematify/write-screen",
            "schematify/write-flow",
            "schematify/write-brief",
            "schematify/write-decision",
            "schematify/supersede-decision",
        ] {
            let err = dispatch(&context, method, Some(json!({ "actor": "human" })))
                .expect_err(&format!("{method} requires an open project"));
            assert_eq!(err.code, INTERNAL_ERROR, "method: {method}");
        }
    }

    #[test]
    fn open_project_reports_whether_kaava_exists() {
        let dir = TempDir::new("open-project");
        let context = context_at(dir.path());

        let before = dispatch(
            &context,
            "schematify/open-project",
            Some(json!({ "actor": "human" })),
        )
        .expect("open-project does not fail on a bare directory");
        assert_eq!(before["exists"], false);

        Store::open(dir.path()).init().expect("init succeeds");

        let after = dispatch(
            &context,
            "schematify/open-project",
            Some(json!({ "actor": "agent" })),
        )
        .expect("open-project does not fail once .kaava exists");
        assert_eq!(after["exists"], true);
    }

    #[test]
    fn load_graph_refuses_a_project_with_no_kaava_directory() {
        let dir = TempDir::new("load-graph-no-kaava");
        let context = context_at(dir.path());

        let err = dispatch(
            &context,
            "schematify/load-graph",
            Some(json!({ "actor": "human" })),
        )
        .expect_err("no .kaava directory is a refusal, not an empty graph");
        assert_eq!(err.code, INTERNAL_ERROR);
    }

    #[test]
    fn load_graph_returns_the_node_this_wave_wrote_and_a_clean_report() {
        let dir = TempDir::new("load-graph-clean");
        let store = Store::open(dir.path());
        store.init().expect("init succeeds");
        let context = context_at(dir.path());

        let node = sample_service_node();
        store.write_node(&node).expect("seed write succeeds");

        let value = dispatch(
            &context,
            "schematify/load-graph",
            Some(json!({ "actor": "human" })),
        )
        .expect("load-graph succeeds against a real .kaava directory");

        let nodes = value["graph"]["nodes"]
            .as_array()
            .expect("nodes is an array");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0]["id"], node.id().to_string());
        assert_eq!(value["report"]["clean"], true);
    }

    #[test]
    fn write_node_writes_the_content_a_reader_gets_back() {
        let dir = TempDir::new("write-node");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let node = sample_service_node();
        let params = json!({ "actor": "human", "node": node });

        dispatch(&context, "schematify/write-node", Some(params)).expect("write-node succeeds");

        let path = Store::open(dir.path()).node_path(node.id());
        let text = fs::read_to_string(path).expect("the node file exists");
        let written: Node = serde_json::from_str(&text).expect("the file parses as a node");
        assert_eq!(written.envelope.title, "Auth Service");
        assert_eq!(written.envelope.slug.as_str(), "auth-service");
    }

    #[test]
    fn write_edge_reports_a_contains_edge_as_not_stored() {
        let dir = TempDir::new("write-edge-contains");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let edge = Edge::new(
            schematify_core::mint_id(),
            schematify_core::EdgeKind::Contains,
            schematify_core::mint_id(),
            schematify_core::mint_id(),
            "2026-09-03T00:00:00Z",
        );
        let params = json!({ "actor": "agent", "edge": edge });

        let value =
            dispatch(&context, "schematify/write-edge", Some(params)).expect("write-edge succeeds");
        assert_eq!(value["stored"], false);
        assert!(value["path"].is_null());
    }

    #[test]
    fn write_edge_writes_the_content_a_reader_gets_back() {
        let dir = TempDir::new("write-edge-stored");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let edge = Edge::new(
            schematify_core::mint_id(),
            schematify_core::EdgeKind::DependsOn,
            schematify_core::mint_id(),
            schematify_core::mint_id(),
            "2026-09-03T00:00:00Z",
        );
        let params = json!({ "actor": "human", "edge": edge });

        let value =
            dispatch(&context, "schematify/write-edge", Some(params)).expect("write-edge succeeds");
        assert_eq!(value["stored"], true);

        let path = Store::open(dir.path()).edge_path(edge.id);
        let text = fs::read_to_string(path).expect("the edge file exists");
        let written: Edge = serde_json::from_str(&text).expect("the file parses as an edge");
        assert_eq!(written.id, edge.id);
        assert_eq!(written.kind, schematify_core::EdgeKind::DependsOn);
    }

    #[test]
    fn write_layout_then_read_layout_round_trips_the_exact_content_sent() {
        let dir = TempDir::new("write-layout-roundtrip");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        // Shaped like `apps/schematify/ui/src/graph/layout.ts`'s `LayoutFile`
        // — a `version`, a combined `viewport`, and an annotation carrying a
        // `body` string, none of which `schematify_core::Layout` can hold.
        let layout = json!({
            "version": 1,
            "schematic": "auth-service",
            "nodes": { "0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8": { "x": 10.0, "y": 20.0, "width": 240.0, "height": 120.0 } },
            "annotations": [{
                "id": "g1", "kind": "group", "slug": "core", "title": "Core",
                "parentId": null, "author": "human", "body": "why this group exists",
                "x": 0.0, "y": 0.0, "width": 600.0, "height": 400.0,
            }],
            "viewport": { "x": 0.0, "y": 0.0, "zoom": 0.68 },
        });

        dispatch(
            &context,
            "schematify/write-layout",
            Some(json!({ "actor": "human", "slug": "auth-service", "layout": layout })),
        )
        .expect("write-layout succeeds");

        let read = dispatch(
            &context,
            "schematify/read-layout",
            Some(json!({ "actor": "agent", "slug": "auth-service" })),
        )
        .expect("read-layout succeeds");

        assert_eq!(
            read, layout,
            "the annotation's body and the combined viewport both survive"
        );
    }

    #[test]
    fn read_layout_reports_null_for_a_schematic_never_written() {
        let dir = TempDir::new("read-layout-null");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let value = dispatch(
            &context,
            "schematify/read-layout",
            Some(json!({ "actor": "human", "slug": "never-opened" })),
        )
        .expect("read-layout does not fail on a missing file");
        assert!(value.is_null());
    }

    #[test]
    fn lint_reports_a_dependency_cycle_it_was_given() {
        use schematify_core::{Authorship, EdgeKind, Lifecycle, NodeEnvelope, NodeKind, Slug};

        let dir = TempDir::new("lint-cycle");
        let store = Store::open(dir.path());
        store.init().expect("init succeeds");
        let context = context_at(dir.path());

        let module = |slug: &str| {
            Node::new(NodeEnvelope {
                id: schematify_core::mint_id(),
                slug: Slug::new(slug).expect("legal slug"),
                kind: NodeKind::Module,
                title: slug.to_string(),
                description: None,
                lifecycle: Lifecycle::Draft,
                layer: None,
                parent: None,
                decisions: Vec::new(),
                authored_by: Authorship::Human,
                created: "2026-09-03T00:00:00Z".to_string(),
                superseded_by: None,
                stale: None,
            })
        };
        let a = module("a");
        let b = module("b");
        store.write_node(&a).expect("write a");
        store.write_node(&b).expect("write b");
        store
            .write_edge(&Edge::new(
                schematify_core::mint_id(),
                EdgeKind::DependsOn,
                a.id(),
                b.id(),
                "2026-09-03T00:00:00Z",
            ))
            .expect("write a->b");
        store
            .write_edge(&Edge::new(
                schematify_core::mint_id(),
                EdgeKind::DependsOn,
                b.id(),
                a.id(),
                "2026-09-03T00:00:00Z",
            ))
            .expect("write b->a");

        let value = dispatch(
            &context,
            "schematify/lint",
            Some(json!({ "actor": "human" })),
        )
        .expect("lint succeeds");

        assert_eq!(value["nodes"], 2);
        assert_eq!(value["edges"], 2);
        assert_eq!(value["rules"], schematify_core::RULE_COUNT);
        let findings = value["findings"].as_array().expect("findings is an array");
        assert!(
            findings.iter().any(|f| f["rule"] == "L02"),
            "the a<->b cycle should draw an L02 row: {findings:?}"
        );
    }

    #[test]
    fn lint_reports_no_findings_over_an_empty_project() {
        let dir = TempDir::new("lint-clean");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let value = dispatch(
            &context,
            "schematify/lint",
            Some(json!({ "actor": "agent" })),
        )
        .expect("lint succeeds over an empty project");
        assert_eq!(
            value["findings"].as_array().expect("array"),
            &Vec::<Value>::new()
        );
        assert_eq!(value["nodes"], 0);
    }

    #[test]
    fn reconcile_status_reports_null_for_a_node_never_reconciled() {
        let dir = TempDir::new("reconcile-null");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());
        let node = schematify_core::mint_id();

        let value = dispatch(
            &context,
            "schematify/reconcile-status",
            Some(json!({ "actor": "human", "node": node.to_string() })),
        )
        .expect("reconcile-status does not fail on a missing file");
        assert!(value.is_null());
    }

    #[test]
    fn reconcile_status_reads_the_reconcile_json_a_reconcile_run_wrote() {
        let dir = TempDir::new("reconcile-read");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());
        let node = schematify_core::mint_id();

        // A stand-in shape, not `schematify-reconcile`'s real
        // `NodeReconcileFile` (`crates/schematify-reconcile/src/report.rs`)
        // — this test is about the raw-JSON round trip `reconcile_status`
        // promises, which does not depend on the payload's real fields any
        // more than `write_layout_then_read_layout_round_trips` did.
        let dir_path = dir
            .path()
            .join(".kaava")
            .join("runs")
            .join(node.to_string());
        fs::create_dir_all(&dir_path).expect("runs dir");
        let payload = json!({
            "schema": "kaava-reconcile-v1",
            "at": "2026-09-03T00:00:00Z",
            "outcome": "matched",
        });
        fs::write(dir_path.join("reconcile.json"), payload.to_string())
            .expect("seed reconcile.json");

        let value = dispatch(
            &context,
            "schematify/reconcile-status",
            Some(json!({ "actor": "human", "node": node.to_string() })),
        )
        .expect("reconcile-status succeeds");
        assert_eq!(value, payload);
    }

    #[test]
    fn reconcile_status_refuses_a_node_that_is_not_a_uuid() {
        let dir = TempDir::new("reconcile-bad-uuid");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let err = dispatch(
            &context,
            "schematify/reconcile-status",
            Some(json!({ "actor": "human", "node": "not-a-uuid" })),
        )
        .expect_err("a malformed node id is refused");
        assert_eq!(err.code, INVALID_PARAMS);
    }

    /// Not a fabricated `Node` literal: `load-graph` against the real
    /// committed fixture (`crates/schematify-core/fixtures/saas-backend/`).
    /// This is what caught the wiring bug worth recording — a first version
    /// of `apps/schematify/ui/src/graph/project.ts` collapsed every
    /// non-`group` kind to `"module"`, so `auth-service`'s 12 real modules
    /// plus 58 of its own facets (contract methods, test cases, budgets)
    /// all drew as one flat 70-node service. This test pins the raw
    /// material — 12 modules, 1 group — not `project.ts`'s output;
    /// `project.test.ts`'s own real-shaped test pins that the group is
    /// still drawn (a real containment box) but not counted (annotation
    /// tier, per the owner's ruling recorded in
    /// `docs/overnight-jobs/overnight-2/handoffs/wiring.md`, which also
    /// carries the full comparison against the wave 2 stand-in fixture).
    #[test]
    fn load_graph_against_the_real_fixture_reports_a_clean_project_and_auth_service() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("crates")
            .join("schematify-core")
            .join("fixtures")
            .join("saas-backend");
        let context = context_at(&root);
        let value = dispatch(
            &context,
            "schematify/load-graph",
            Some(json!({ "actor": "human" })),
        )
        .expect("load-graph succeeds against the real fixture");

        assert_eq!(value["report"]["clean"], true);

        let nodes = value["graph"]["nodes"]
            .as_array()
            .expect("nodes is an array");
        let auth_service = nodes
            .iter()
            .find(|n| n["kind"] == "service" && n["slug"] == "auth-service")
            .expect("fixtures/saas-backend/ names an auth-service, per PRD §16.1");
        assert_eq!(auth_service["title"], "Auth Service");

        // The Service Schematic's own subtree: 12 modules, 1 group, and a
        // pile of tier-3 facets a Module Schematic draws instead — the
        // count `project.ts`'s `SERVICE_SCHEMATIC_KINDS` filter exists to
        // separate out. This assertion pins the raw material, not the
        // filter; `project.test.ts` pins the filter itself.
        let auth_id = auth_service["id"].as_str().unwrap();
        let by_id: std::collections::HashMap<&str, &Value> = nodes
            .iter()
            .map(|n| (n["id"].as_str().unwrap(), n))
            .collect();
        fn is_descendant<'a>(
            mut node: &'a Value,
            auth_id: &str,
            by_id: &std::collections::HashMap<&str, &'a Value>,
        ) -> bool {
            loop {
                match node["parent"].as_str() {
                    Some(p) if p == auth_id => return true,
                    Some(p) => match by_id.get(p) {
                        Some(parent) => node = parent,
                        None => return false,
                    },
                    None => return false,
                }
            }
        }
        let descendants: Vec<&Value> = nodes
            .iter()
            .filter(|n| n["id"] != auth_service["id"] && is_descendant(n, auth_id, &by_id))
            .collect();
        let modules = descendants.iter().filter(|n| n["kind"] == "module").count();
        let groups = descendants.iter().filter(|n| n["kind"] == "group").count();
        assert_eq!((modules, groups), (12, 1));
    }

    #[test]
    fn write_screen_writes_the_content_a_reader_gets_back() {
        let dir = TempDir::new("write-screen");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let screen = sample_screen();
        let params = json!({ "actor": "human", "screen": screen });

        dispatch(&context, "schematify/write-screen", Some(params)).expect("write-screen succeeds");

        let path = Store::open(dir.path()).screen_path(screen.id);
        let text = fs::read_to_string(path).expect("the screen file exists");
        let written: Screen = serde_json::from_str(&text).expect("the file parses as a screen");
        assert_eq!(written, screen);
    }

    #[test]
    fn write_screen_upserts_an_existing_screen() {
        // Unlike a decision row, a screen carries no append-only rule (PRD
        // §12.17 draws a per-screen editor, and nothing in §5.7 restricts a
        // second write) — a screen is exactly what `write_decision` below is
        // deliberately not.
        let dir = TempDir::new("write-screen-upsert");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let mut screen = sample_screen();
        dispatch(
            &context,
            "schematify/write-screen",
            Some(json!({ "actor": "human", "screen": screen })),
        )
        .expect("first write succeeds");

        screen.purpose = "A revised purpose.".to_owned();
        dispatch(
            &context,
            "schematify/write-screen",
            Some(json!({ "actor": "human", "screen": screen })),
        )
        .expect("second write to the same id succeeds");

        let path = Store::open(dir.path()).screen_path(screen.id);
        let written: Screen =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).expect("parses");
        assert_eq!(written.purpose, "A revised purpose.");
    }

    #[test]
    fn write_flow_writes_the_content_a_reader_gets_back() {
        let dir = TempDir::new("write-flow");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let flow = sample_flow();
        let params = json!({ "actor": "agent", "flow": flow });

        dispatch(&context, "schematify/write-flow", Some(params)).expect("write-flow succeeds");

        let path = Store::open(dir.path()).flow_path(flow.id);
        let text = fs::read_to_string(path).expect("the flow file exists");
        let written: Flow = serde_json::from_str(&text).expect("the file parses as a flow");
        assert_eq!(written, flow);
    }

    #[test]
    fn write_brief_writes_the_content_a_reader_gets_back() {
        let dir = TempDir::new("write-brief");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let brief = ProjectBrief {
            product_name: "saas-backend".to_owned(),
            problem: "Teams rebuild the same account layer each time.".to_owned(),
            users: vec!["Platform engineers".to_owned()],
            goals: Vec::new(),
            non_goals: Vec::new(),
            constraints: Vec::new(),
            success_metrics: Vec::new(),
        };
        let params = json!({ "actor": "human", "brief": brief });

        dispatch(&context, "schematify/write-brief", Some(params)).expect("write-brief succeeds");

        let path = Store::open(dir.path()).brief_path();
        let text = fs::read_to_string(path).expect("the brief file exists");
        let written: ProjectBrief =
            serde_json::from_str(&text).expect("the file parses as a brief");
        assert_eq!(written, brief);
    }

    #[test]
    fn write_decision_creates_a_new_standing_row() {
        let dir = TempDir::new("write-decision-new");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let decision = sample_decision(1, DecisionStatus::Active);
        let params = json!({ "actor": "human", "decision": decision });

        dispatch(&context, "schematify/write-decision", Some(params))
            .expect("write-decision succeeds for a fresh id");

        let path = Store::open(dir.path()).decision_path(decision.id);
        let written: Decision =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).expect("parses");
        assert_eq!(written, decision);
    }

    /// The boundary proof PRD §5.9 and wave 10c's own acceptance condition
    /// ask for: a decision row cannot be edited in place, checked against
    /// the RPC dispatcher rather than only a disabled UI button. Sending the
    /// same id back with a changed title is a plain edit attempt, and it is
    /// refused before anything on disk changes.
    #[test]
    fn write_decision_refuses_to_edit_an_existing_row_in_place() {
        let dir = TempDir::new("write-decision-edit-blocked");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let original = sample_decision(1, DecisionStatus::Active);
        dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": original })),
        )
        .expect("first write succeeds");

        let mut tampered = original.clone();
        tampered.title = "A quietly rewritten title".to_owned();
        let err = dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": tampered })),
        )
        .expect_err("a second write to the same id is refused");
        assert_eq!(err.code, INVALID_PARAMS);

        let path = Store::open(dir.path()).decision_path(original.id);
        let written: Decision =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).expect("parses");
        assert_eq!(
            written, original,
            "the file on disk must be untouched by the refused write"
        );
    }

    #[test]
    fn write_decision_refuses_a_payload_that_already_claims_a_supersession() {
        let dir = TempDir::new("write-decision-preclaimed");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let mut superseded = sample_decision(1, DecisionStatus::Superseded);
        superseded.superseded_by = Some(Uuid::from_u128(2));
        let err = dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": superseded })),
        )
        .expect_err("a fresh decision cannot arrive already superseded");
        assert_eq!(err.code, INVALID_PARAMS);

        let mut pre_linked = sample_decision(1, DecisionStatus::Active);
        pre_linked.supersedes = Some(Uuid::from_u128(3));
        let err = dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": pre_linked })),
        )
        .expect_err("a fresh decision cannot arrive already claiming a prior row");
        assert_eq!(err.code, INVALID_PARAMS);
    }

    /// The other half of "cannot be edited or removed": no method on this
    /// dispatcher deletes a decision file at all, proven the same way an
    /// unknown method is proven — by dispatching it and reading the error.
    #[test]
    fn no_method_removes_a_decision_row() {
        let context = CallContext::default();
        for method in [
            "schematify/delete-decision",
            "schematify/remove-decision",
            "schematify/edit-decision",
        ] {
            let err = dispatch(&context, method, None).expect_err("no such method exists");
            assert_eq!(err.code, METHOD_NOT_FOUND, "method: {method}");
        }
    }

    #[test]
    fn supersede_decision_adds_a_row_and_marks_the_prior_superseded() {
        let dir = TempDir::new("supersede-decision");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let prior = sample_decision(1, DecisionStatus::Active);
        dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": prior })),
        )
        .expect("seed write succeeds");

        let mut successor = sample_decision(2, DecisionStatus::Active);
        successor.title = "Verify against a wider key set".to_owned();
        let value = dispatch(
            &context,
            "schematify/supersede-decision",
            Some(json!({
                "actor": "human",
                "priorId": prior.id,
                "decision": successor,
            })),
        )
        .expect("supersede-decision succeeds");
        assert_eq!(value["id"], successor.id.to_string());

        let store = Store::open(dir.path());
        let written_successor: Decision =
            serde_json::from_str(&fs::read_to_string(store.decision_path(successor.id)).unwrap())
                .unwrap();
        assert_eq!(written_successor.status, DecisionStatus::Active);
        assert_eq!(written_successor.supersedes, Some(prior.id));
        assert_eq!(written_successor.title, "Verify against a wider key set");

        let written_prior: Decision =
            serde_json::from_str(&fs::read_to_string(store.decision_path(prior.id)).unwrap())
                .unwrap();
        assert_eq!(written_prior.status, DecisionStatus::Superseded);
        assert_eq!(written_prior.superseded_by, Some(successor.id));
        // Every other field on the prior row is untouched — the point of
        // routing this through the file already on disk rather than any
        // payload the caller sent.
        assert_eq!(written_prior.title, prior.title);
        assert_eq!(written_prior.context, prior.context);
        assert_eq!(written_prior.decision, prior.decision);
        assert_eq!(written_prior.consequences, prior.consequences);
        assert_eq!(written_prior.date, prior.date);
    }

    /// The successor's own `supersedes`/`superseded_by` are server-decided,
    /// not caller-decided — a payload naming the wrong prior id, or one
    /// already claiming a superseded_by, is overwritten rather than trusted.
    #[test]
    fn supersede_decision_ignores_a_forged_supersession_on_the_successor_payload() {
        let dir = TempDir::new("supersede-decision-forged");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let prior = sample_decision(1, DecisionStatus::Active);
        dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": prior })),
        )
        .expect("seed write succeeds");

        let mut forged = sample_decision(2, DecisionStatus::Superseded);
        forged.supersedes = Some(Uuid::from_u128(999));
        forged.superseded_by = Some(Uuid::from_u128(998));
        dispatch(
            &context,
            "schematify/supersede-decision",
            Some(json!({ "actor": "human", "priorId": prior.id, "decision": forged })),
        )
        .expect("supersede-decision succeeds despite the forged fields");

        let store = Store::open(dir.path());
        let written: Decision =
            serde_json::from_str(&fs::read_to_string(store.decision_path(forged.id)).unwrap())
                .unwrap();
        assert_eq!(written.status, DecisionStatus::Active);
        assert_eq!(written.supersedes, Some(prior.id));
        assert_eq!(written.superseded_by, None);
    }

    #[test]
    fn supersede_decision_refuses_a_prior_id_with_no_file() {
        let dir = TempDir::new("supersede-decision-no-prior");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let successor = sample_decision(2, DecisionStatus::Active);
        let err = dispatch(
            &context,
            "schematify/supersede-decision",
            Some(json!({
                "actor": "human",
                "priorId": Uuid::from_u128(999),
                "decision": successor,
            })),
        )
        .expect_err("no row exists to supersede");
        assert_eq!(err.code, INVALID_PARAMS);
    }

    #[test]
    fn supersede_decision_refuses_a_prior_row_that_is_already_superseded() {
        let dir = TempDir::new("supersede-decision-double");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let mut prior = sample_decision(1, DecisionStatus::Superseded);
        prior.superseded_by = Some(Uuid::from_u128(2));
        // Written directly, bypassing `write_decision`'s own refusal of a
        // pre-superseded payload — this test is about `supersede_decision`'s
        // own guard, not `write_decision`'s.
        Store::open(dir.path())
            .write_decision(&prior)
            .expect("seed write succeeds");

        let successor = sample_decision(3, DecisionStatus::Active);
        let err = dispatch(
            &context,
            "schematify/supersede-decision",
            Some(json!({
                "actor": "human",
                "priorId": prior.id,
                "decision": successor,
            })),
        )
        .expect_err("a row already superseded cannot be superseded again");
        assert_eq!(err.code, INVALID_PARAMS);
    }

    #[test]
    fn supersede_decision_refuses_a_successor_id_that_already_exists() {
        let dir = TempDir::new("supersede-decision-collision");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let prior = sample_decision(1, DecisionStatus::Active);
        let already_there = sample_decision(2, DecisionStatus::Active);
        dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": prior })),
        )
        .expect("seed prior succeeds");
        dispatch(
            &context,
            "schematify/write-decision",
            Some(json!({ "actor": "human", "decision": already_there })),
        )
        .expect("seed already_there succeeds");

        let colliding = sample_decision(2, DecisionStatus::Active);
        let err = dispatch(
            &context,
            "schematify/supersede-decision",
            Some(json!({
                "actor": "human",
                "priorId": prior.id,
                "decision": colliding,
            })),
        )
        .expect_err("a successor id that already exists is refused, same as write-decision");
        assert_eq!(err.code, INVALID_PARAMS);
    }

    fn sample_screen() -> Screen {
        use schematify_core::mint_id;

        Screen {
            id: mint_id(),
            kind: schematify_core::ScreenKind::default(),
            slug: schematify_core::Slug::new("login-form").expect("legal slug"),
            title: "Login form".to_owned(),
            purpose: "Collects credentials and starts a session.".to_owned(),
            states: vec!["empty".to_owned(), "locked".to_owned()],
            acceptance: vec!["A locked account shall show the recovery path.".to_owned()],
            design_ref: None,
            backed_by: Vec::new(),
        }
    }

    fn sample_flow() -> Flow {
        use schematify_core::mint_id;

        Flow {
            id: mint_id(),
            kind: schematify_core::FlowKind::default(),
            slug: schematify_core::Slug::new("first-run-signup").expect("legal slug"),
            title: "First-run signup".to_owned(),
            trigger: "A visitor opens the product with no account.".to_owned(),
            steps: Vec::new(),
            outcome: "The visitor holds an active session.".to_owned(),
        }
    }

    fn sample_decision(id: u128, status: DecisionStatus) -> Decision {
        Decision {
            id: Uuid::from_u128(id),
            kind: schematify_core::DecisionKind::default(),
            slug: schematify_core::Slug::new("DEC-TEC-AUTH-004").expect("legal decision slug"),
            title: "Verify signatures against a rotating key set".to_owned(),
            context: "The prior design pinned one signing key.".to_owned(),
            decision: "Schematify shall verify against the published key set.".to_owned(),
            consequences: "Key rotation adds a network fetch to the cold path.".to_owned(),
            status,
            supersedes: None,
            superseded_by: None,
            date: "2026-08-19".to_owned(),
        }
    }

    fn sample_service_node() -> Node {
        use schematify_core::{Authorship, Lifecycle, NodeEnvelope, NodeKind, Slug};

        Node::new(NodeEnvelope {
            id: schematify_core::mint_id(),
            slug: Slug::new("auth-service").expect("legal slug"),
            kind: NodeKind::Service,
            title: "Auth Service".to_string(),
            description: None,
            lifecycle: Lifecycle::Accepted,
            layer: None,
            parent: None,
            decisions: Vec::new(),
            authored_by: Authorship::Human,
            created: "2026-09-03T00:00:00Z".to_string(),
            superseded_by: None,
            stale: None,
        })
    }
}
