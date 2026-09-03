//! Schematify's Rust half — the design layer of OpenKaava. A module here,
//! registered like Home and Files, per `docs/design/SCHEMATIFY-PRD.md` §1.3.
//!
//! A thin JSON-RPC layer over `schematify-core`: this file resolves a
//! project root from [`CallContext`], turns request `params` into typed
//! arguments, calls the crate, and shapes the answer back into JSON. One
//! dispatch function rather than one `#[tauri::command]` per operation,
//! matching `home.rs` and `files.rs` (`docs/audits/schematify-baseline.md` §11).
//!
//! PRD §14.5 lists ten operations. This file wires nine: open a project,
//! load the whole graph and its report, write one node, write one edge,
//! read/write one layout, run the linter, read one reconcile status, and
//! ingest a CI run artifact — plus `schematify/state` from wave 1a and
//! `schematify/module-dashboard` (wave 9d's own addition, feeding PRD
//! §12.13). `transition` and `search` stay unwired — see
//! `docs/overnight-jobs/overnight-2/handoffs/wiring.md`.
//!
//! Decision SCH-API-003 puts an `actor` (`"human"` or `"agent"`) on every
//! operation, so wave 10's human-only gate has something honest to read.
//! [`actor_param`] refuses a call that omits it rather than defaulting it.

use std::fs;
use std::path::Path;

use crate::apps::CallContext;
use kaava_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND};
use schematify_core::{
    ingest_run_file, lint, load_project, BudgetTier, CoreError, Edge, Node, NodeKind, Store,
    TestStatus, Uuid,
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
        "schematify/ingest-run" => ingest_run(context, params.as_ref()),
        "schematify/module-dashboard" => module_dashboard(context, params.as_ref()),
        "schematify/runs" => list_runs(context, params.as_ref()),
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

/// `schematify/ingest-run`. The Tauri wiring for wave 9b's
/// `schematify_core::ingest_run_file` (`crates/schematify-core/src/ingest.rs`;
/// see `docs/overnight-jobs/overnight-2/handoffs/w9b-runs.md`), and PRD §8's
/// "Schematify ingests the artifact into `runs/` and draws it." `module` is
/// the scope wave 9b's own doc comment names: the node whose CI workflow
/// produced the run, not a budget node itself, since one workflow answers
/// several budgets in one file. `path` is wherever CI dropped the
/// `kaava-bench-v1` artifact, outside `.kaava/` — Schematify never invokes
/// the probe that produced it, only reads what it wrote.
fn ingest_run(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let module = string_param(params, "module")?;
    let scope = Uuid::parse_str(&module)
        .map_err(|e| RpcError::new(INVALID_PARAMS, format!("module must be a UUID: {e}")))?;
    let path = string_param(params, "path")?;

    let outcome = load_project(root).map_err(core_rpc)?;
    let store = Store::open(root);
    ingest_run_file(&outcome.graph, &store, scope, Path::new(&path)).map_err(core_rpc)?;

    Ok(json!({ "module": scope, "ingested": true }))
}

/// `schematify/runs`. S-14, PRD §12.2: "Run number, timestamp, commit,
/// workflow file, ingest state" for the Runs dock tab. Undrawn by any
/// wireframe screen, so this reads the simplest project-wide shape: every
/// run under every node, newest first — the same "whole project, not one
/// tier" scope the Problems panel already draws (wave 7b). A run's presence
/// here is its ingest state: `ingest_run_file` refuses anything that fails
/// its checks before it ever reaches disk, so every row this call returns
/// already reads `Ingested` — there is no "pending" state this crate models.
fn list_runs(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let outcome = load_project(root).map_err(core_rpc)?;
    let graph = &outcome.graph;

    let mut rows: Vec<Value> = Vec::new();
    for node in graph.nodes() {
        for run in graph.runs(node.id()) {
            rows.push(json!({
                "module": {
                    "id": node.id(),
                    "title": node.envelope.title,
                    "slug": node.envelope.slug.as_str(),
                },
                "run": run.run,
                "at": run.at,
                "commit": run.commit,
                "workflow": run.workflow,
            }));
        }
    }
    rows.sort_by(|a, b| {
        let a_at = a["at"].as_str().unwrap_or_default();
        let b_at = b["at"].as_str().unwrap_or_default();
        b_at.cmp(a_at)
    });

    Ok(json!({ "runs": rows }))
}

/// `schematify/module-dashboard`. Shapes PRD §12.13's Module dashboard: 5
/// counters, the budget history, the reconciliation table, and the lifecycle
/// audit log. `module` is a module node's id, the same value `load-graph`
/// hands back on `nodes[].id`. Every field below is read fresh off the graph
/// and the module's own run/audit history on each call — PRD §0.4 forbids
/// storing a count, and this function is where that rule is kept for the
/// dashboard specifically, the same way `lint_graph` keeps it for Problems.
///
/// Contract change history (the dashboard's 4th table) is not shaped here.
/// No schema in this crate records a per-method change log — `AuditRow`
/// records a lifecycle *transition*, not the contract edit that motivated
/// one — so there is nothing on the graph for this function to compute from.
/// See the wave 9d handoff for the recorded gap.
fn module_dashboard(context: &CallContext, params: Option<&Value>) -> Result<Value, RpcError> {
    actor_param(params)?;
    let root = require_project(context)?;
    let module = string_param(params, "module")?;

    let outcome = load_project(root).map_err(core_rpc)?;
    let graph = &outcome.graph;

    // `module` accepts either a node id or a slug. A UUID is what
    // `load-graph` hands back on `nodes[].id`, the ordinary case once the
    // Module Schematic loads real graph data; a slug is what the Module
    // Schematic's own stand-in engine (`apps/schematify/ui/src/graph/module.ts`
    // — the pre-existing gap wave 7b's handoff §6 item 3 already recorded)
    // can offer today, since it never learned the real backend's uuids. Both
    // resolve to the same node here rather than making the frontend carry a
    // 2nd lookup call before it can even open the dashboard.
    let module_id = match Uuid::parse_str(&module) {
        Ok(id) => id,
        Err(_) => graph
            .nodes()
            .find(|n| *n.kind() == NodeKind::Module && n.envelope.slug.as_str() == module)
            .map(Node::id)
            .ok_or_else(|| {
                RpcError::new(
                    INVALID_PARAMS,
                    format!("no module node with slug {module:?}"),
                )
            })?,
    };
    let node = graph
        .node(module_id)
        .ok_or_else(|| RpcError::new(INVALID_PARAMS, format!("no node with id {module_id}")))?;
    let store = Store::open(root);

    // Budgets and tests are graph state — a probe declaration or a linked
    // test status does not wait for a run to be true, so neither is read off
    // `latest_run` below.
    let children: Vec<&Node> = graph
        .children(module_id)
        .iter()
        .filter_map(|&id| graph.node(id))
        .collect();

    let budgets: Vec<(&Node, schematify_core::BudgetFields)> = children
        .iter()
        .filter(|n| *n.kind() == NodeKind::Budget)
        .filter_map(|n| n.budget().ok().map(|fields| (*n, fields)))
        .collect();
    let budgets_with_probe = budgets.iter().filter(|(_, f)| f.probe.is_some()).count();
    let hard_missing_probe = budgets
        .iter()
        .filter(|(_, f)| f.probe.is_none() && f.tier == BudgetTier::Hard)
        .count();

    let tests: Vec<schematify_core::TestCaseFields> = children
        .iter()
        .filter(|n| *n.kind() == NodeKind::TestCase)
        .filter_map(|n| n.test_case().ok())
        .collect();
    let tests_passing = tests
        .iter()
        .filter(|t| t.status == TestStatus::Passing)
        .count();
    let tests_failing = tests
        .iter()
        .filter(|t| t.status == TestStatus::Failing)
        .count();
    let tests_unlinked = tests
        .iter()
        .filter(|t| t.status == TestStatus::Declared)
        .count();

    // `LATEST RUN` per PRD §12.13: the highest run number ingested under this
    // module. `Graph::runs` is empty on a module CI has never run.
    let latest_run = graph.runs(module_id).iter().max_by_key(|run| run.run);

    let budget_history: Vec<Value> = budgets
        .iter()
        .map(|(_, fields)| {
            let measured =
                latest_run.and_then(|run| run.budgets.iter().find(|b| b.metric == fields.metric));
            json!({
                "metric": fields.metric,
                "tier": fields.tier,
                "op": fields.op,
                "threshold": fields.value,
                "unit": fields.unit,
                "hasProbe": fields.probe.is_some(),
                "probeCommand": fields.probe.as_ref().map(|p| p.command.clone()),
                "latestValue": measured.map(|m| m.value),
                "pass": measured.map(|m| m.pass),
                "signOff": fields.sign_off,
            })
        })
        .collect();

    // The reconciliation counters are the latest run's own summary (PRD
    // §5.10, §9.2) — a run artifact is the one place those 4 numbers are
    // recorded. The `SITE` cell is not: no run field carries where a marker
    // was found, only how many, so `reconciliation_sites` reads the
    // `reconcile.json` `kaava reconcile` writes per node (PRD §9.3) for the
    // module and its direct facet children — the same "direct children of
    // scope" boundary wave 9b's own `ingest_run` drew for budgets.
    let reconcile_scope: Vec<Uuid> = std::iter::once(module_id)
        .chain(children.iter().map(|n| n.id()))
        .collect();
    let titles: std::collections::HashMap<Uuid, &str> = std::iter::once(node)
        .chain(children.iter().copied())
        .map(|n| (n.id(), n.envelope.title.as_str()))
        .collect();
    let reconciliation_rows = reconciliation_rows(
        &store,
        &reconcile_scope,
        &titles,
        latest_run.and_then(|run| run.reconcile),
    );

    let audit_log: Vec<Value> = graph
        .audit(module_id)
        .iter()
        .rev()
        .take(5)
        .map(|row| {
            json!({
                "when": row.at,
                "from": row.from,
                "to": row.to,
                "actor": row.actor.as_str(),
                "actorName": row.actor_name,
                "reason": row.reason,
            })
        })
        .collect();

    Ok(json!({
        "module": {
            "id": node.id(),
            "title": node.envelope.title,
            "slug": node.envelope.slug.as_str(),
        },
        "runsPath": format!("runs/{}/", elide_uuid(module_id)),
        "latestRun": latest_run.map(|run| json!({
            "run": run.run,
            "at": run.at,
            "commit": run.commit,
            "workflow": run.workflow,
        })),
        "budgets": {
            "withProbe": budgets_with_probe,
            "total": budgets.len(),
            "hardMissingProbe": hard_missing_probe,
        },
        "tests": {
            "passing": tests_passing,
            "total": tests.len(),
            "failing": tests_failing,
            "unlinked": tests_unlinked,
        },
        "linter": latest_run.and_then(|run| run.linter).map(|l| json!({
            "rules": l.rules,
            "violations": l.violations,
        })),
        "reconciliation": latest_run.and_then(|run| run.reconcile).map(|r| json!({
            "matched": r.matched,
            "declaredAbsent": r.declared_absent,
            "presentUnknown": r.present_unknown,
            "duplicate": r.duplicate,
        })),
        "reconciliationRows": reconciliation_rows,
        "budgetHistory": budget_history,
        "auditLog": audit_log,
    }))
}

/// `0192f4a1-…-a7b8` from a full uuid — PRD §12.13's own elision, for the
/// `runsPath` header line.
fn elide_uuid(id: Uuid) -> String {
    let text = id.to_string();
    let (first, rest) = text.split_once('-').unwrap_or((text.as_str(), ""));
    let last = rest.rsplit('-').next().unwrap_or(rest);
    format!("{first}-\u{2026}-{last}")
}

/// One row of the Reconciliation table: PRD §9.2's drawn outcome name, a
/// `SITE` cell, and the count.
struct ReconcileRow {
    outcome: &'static str,
    site: String,
    count: u32,
}

impl ReconcileRow {
    fn to_value(&self) -> Value {
        json!({ "outcome": self.outcome, "site": self.site, "count": self.count })
    }
}

/// Reads `runs/<id>/reconcile.json` for every id in `scope` (raw JSON, same
/// convention `reconcile_status` uses — see `read_json_object_or_null`'s own
/// doc comment for why this crate does not type it against
/// `schematify-reconcile`'s shape), groups the outcomes it finds by kind, and
/// builds the 4 rows PRD §12.13 draws. `counts` is the latest run's own
/// summary — see `module_dashboard`'s doc comment for why the count and the
/// site text come from two different sources. A count with nothing behind it
/// (no `reconcile.json` on disk yet, the ordinary state for a project that
/// has never run `kaava reconcile`) draws `—`, not a guess.
fn reconciliation_rows(
    store: &Store,
    scope: &[Uuid],
    titles: &std::collections::HashMap<Uuid, &str>,
    counts: Option<schematify_core::ReconcileResult>,
) -> Vec<Value> {
    let mut matched_sites: Vec<String> = Vec::new();
    let mut absent_sites: Vec<String> = Vec::new();
    let mut unknown_sites: Vec<String> = Vec::new();
    let mut duplicate_sites: Vec<String> = Vec::new();

    // The reconciled node's own title, not `reconcile.json`'s own `slug`
    // field — a contract method's slug is kebab-case
    // (`schematify_core::Slug`'s own rule) but PRD §16.1's drawn form
    // (`skew_window — no marker`) is the method's call name, which is what
    // `NodeEnvelope::title` holds for a `contract-method` node. Falls back to
    // the file's own `slug` for a node this dashboard's own graph walk never
    // loaded (should not happen for `scope`, built from the same graph).
    let title_of = |value: &Value| -> String {
        value
            .get("node_id")
            .and_then(Value::as_str)
            .and_then(|s| Uuid::parse_str(s).ok())
            .and_then(|id| titles.get(&id).copied())
            .map(str::to_owned)
            .or_else(|| value.get("slug").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_default()
    };

    for &id in scope {
        let path = store
            .kaava_dir()
            .join("runs")
            .join(id.to_string())
            .join("reconcile.json");
        let Ok(value) = read_json_object_or_null(&path) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        match value.get("outcome").and_then(Value::as_str) {
            Some("matched") => {
                if let Some(file) = value
                    .get("site")
                    .and_then(|s| s.get("file"))
                    .and_then(Value::as_str)
                {
                    matched_sites.push(file.to_owned());
                }
            }
            Some("declared_absent") => {
                absent_sites.push(format!("{} — no marker", title_of(&value)));
            }
            Some("present_unknown") => {
                if let Some(file) = value
                    .get("site")
                    .and_then(|s| s.get("file"))
                    .and_then(Value::as_str)
                {
                    unknown_sites.push(file.to_owned());
                }
            }
            Some("duplicate") => {
                duplicate_sites.push(title_of(&value));
            }
            _ => {}
        }
    }

    let counts = counts.unwrap_or_default();
    vec![
        ReconcileRow {
            outcome: "matched",
            site: first_and_overflow(&matched_sites),
            count: counts.matched,
        }
        .to_value(),
        ReconcileRow {
            outcome: "declared, absent",
            site: first_and_overflow(&absent_sites),
            count: counts.declared_absent,
        }
        .to_value(),
        ReconcileRow {
            outcome: "present, unknown",
            site: first_and_overflow(&unknown_sites),
            count: counts.present_unknown,
        }
        .to_value(),
        ReconcileRow {
            outcome: "duplicate",
            site: first_and_overflow(&duplicate_sites),
            count: counts.duplicate,
        }
        .to_value(),
    ]
}

/// PRD §12.13's `SITE` cell form: `src/auth/verifier.ts +3 more`, deduplicated
/// so 7 matches inside 4 files draw as 1 name and 3 more, not 6. `—` when
/// `sites` is empty.
fn first_and_overflow(sites: &[String]) -> String {
    let mut distinct: Vec<&String> = Vec::new();
    for site in sites {
        if !distinct.contains(&site) {
            distinct.push(site);
        }
    }
    match distinct.split_first() {
        None => "—".to_owned(),
        Some((first, [])) => (*first).clone(),
        Some((first, rest)) => format!("{first} +{} more", rest.len()),
    }
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
            "schematify/ingest-run",
            "schematify/module-dashboard",
            "schematify/runs",
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
            "schematify/ingest-run",
            "schematify/module-dashboard",
            "schematify/runs",
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

    fn budget_module_node(id: Uuid, slug: &str, metric: &str) -> Node {
        use schematify_core::{
            Authorship, BudgetFields, BudgetTier, Lifecycle, NodeEnvelope, NodeKind, Probe, Slug,
        };

        Node::new(NodeEnvelope {
            id,
            slug: Slug::new(slug).expect("legal slug"),
            kind: NodeKind::Budget,
            title: metric.to_string(),
            description: None,
            lifecycle: Lifecycle::Specified,
            layer: None,
            parent: None,
            decisions: Vec::new(),
            authored_by: Authorship::Human,
            created: "2026-09-03T00:00:00Z".to_string(),
            superseded_by: None,
            stale: None,
        })
        .with_fields(&BudgetFields {
            metric: metric.to_string(),
            op: "<".to_string(),
            value: 3.0,
            unit: "ms".to_string(),
            tier: BudgetTier::Hard,
            probe: Some(Probe {
                command: "pnpm bench:x".to_string(),
                parser: "kaava-bench-v1".to_string(),
            }),
            sign_off: None,
        })
        .expect("budget fields serialize")
    }

    #[test]
    fn ingest_run_writes_the_file_a_reader_gets_back() {
        use schematify_core::{RunArtifact, RUN_SCHEMA_VERSION};

        let dir = TempDir::new("ingest-run");
        let store = Store::open(dir.path());
        store.init().expect("init succeeds");
        let context = context_at(dir.path());

        let scope_id = schematify_core::mint_id();
        let scope = Node::new(schematify_core::NodeEnvelope {
            id: scope_id,
            slug: schematify_core::Slug::new("token-verifier").expect("legal slug"),
            kind: schematify_core::NodeKind::Module,
            title: "Token Verifier".to_string(),
            description: None,
            lifecycle: schematify_core::Lifecycle::Accepted,
            layer: None,
            parent: None,
            decisions: Vec::new(),
            authored_by: schematify_core::Authorship::Human,
            created: "2026-09-03T00:00:00Z".to_string(),
            superseded_by: None,
            stale: None,
        });
        store.write_node(&scope).expect("seed module write");
        let budget = budget_module_node(schematify_core::mint_id(), "verify-p95", "verify_p95");
        let mut budget = budget;
        budget.envelope.parent = Some(scope_id);
        store.write_node(&budget).expect("seed budget write");

        let artifact = RunArtifact {
            schema: RUN_SCHEMA_VERSION.to_string(),
            run: 1,
            at: "2026-09-03T00:00:00Z".to_string(),
            commit: "abc1234".to_string(),
            workflow: "ci/verify.yml".to_string(),
            budgets: vec![schematify_core::BudgetResult {
                metric: "verify_p95".to_string(),
                value: 1.0,
                unit: "ms".to_string(),
                pass: true,
            }],
            tests: Vec::new(),
            linter: None,
            reconcile: None,
        };
        let artifact_path = dir.path().join("ci-artifact.json");
        fs::write(
            &artifact_path,
            serde_json::to_vec(&artifact).expect("artifact serializes"),
        )
        .expect("write the artifact CI would have dropped");

        let value = dispatch(
            &context,
            "schematify/ingest-run",
            Some(json!({
                "actor": "human",
                "module": scope_id.to_string(),
                "path": artifact_path.display().to_string(),
            })),
        )
        .expect("ingest-run succeeds");
        assert_eq!(value["ingested"], true);

        let written = store.run_path(scope_id, 1);
        assert!(
            written.is_file(),
            "the run landed at runs/<module>/run-1.json"
        );
    }

    #[test]
    fn ingest_run_refuses_a_second_ingestion_at_the_same_run_number() {
        // Broken on purpose to confirm this test can fail: temporarily
        // asserted `is_ok()` on the second call instead of `is_err()`, watched
        // it fail with "second ingestion should be refused: Ok(...)", then
        // restored the assertion below. Recorded per the task's own rule
        // rather than left to a comment nobody checked.
        use schematify_core::{RunArtifact, RUN_SCHEMA_VERSION};

        let dir = TempDir::new("ingest-run-dup");
        let store = Store::open(dir.path());
        store.init().expect("init succeeds");
        let context = context_at(dir.path());

        let scope_id = schematify_core::mint_id();
        let scope = Node::new(schematify_core::NodeEnvelope {
            id: scope_id,
            slug: schematify_core::Slug::new("token-verifier").expect("legal slug"),
            kind: schematify_core::NodeKind::Module,
            title: "Token Verifier".to_string(),
            description: None,
            lifecycle: schematify_core::Lifecycle::Accepted,
            layer: None,
            parent: None,
            decisions: Vec::new(),
            authored_by: schematify_core::Authorship::Human,
            created: "2026-09-03T00:00:00Z".to_string(),
            superseded_by: None,
            stale: None,
        });
        store.write_node(&scope).expect("seed module write");

        let artifact = RunArtifact {
            schema: RUN_SCHEMA_VERSION.to_string(),
            run: 1,
            at: "2026-09-03T00:00:00Z".to_string(),
            commit: "abc1234".to_string(),
            workflow: "ci/verify.yml".to_string(),
            budgets: Vec::new(),
            tests: Vec::new(),
            linter: None,
            reconcile: None,
        };
        let artifact_path = dir.path().join("ci-artifact.json");
        fs::write(
            &artifact_path,
            serde_json::to_vec(&artifact).expect("artifact serializes"),
        )
        .expect("write the artifact CI would have dropped");

        let params = json!({
            "actor": "human",
            "module": scope_id.to_string(),
            "path": artifact_path.display().to_string(),
        });
        dispatch(&context, "schematify/ingest-run", Some(params.clone()))
            .expect("first ingestion succeeds");
        let second = dispatch(&context, "schematify/ingest-run", Some(params));
        assert!(
            second.is_err(),
            "second ingestion should be refused: {second:?}"
        );
    }

    /// Against the real committed fixture, per §16.1: `verify-signature.json`,
    /// `refresh-keys.json` and the module's own file carry `probe`; only
    /// `cold-start-p95` does not, so `2 / 3` and `1 hard budget has no probe`.
    /// `5 / 7` tests, `1` failing, `1` unlinked, per the 7 `test-case`
    /// children this crate's own fixture holds.
    #[test]
    fn module_dashboard_against_the_real_fixture_draws_the_16_1_values() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("crates")
            .join("schematify-core")
            .join("fixtures")
            .join("saas-backend");
        let context = context_at(&root);

        // token-verifier's real id, per the committed fixture (also read by
        // `load_graph_against_the_real_fixture_reports_a_clean_project_and_auth_service`
        // above via slug lookup; this test pins the id literally since it is
        // this fixture's own stable identifier).
        let module = "01a03637-7800-7024-8962-cc11fce89708";

        let value = dispatch(
            &context,
            "schematify/module-dashboard",
            Some(json!({ "actor": "human", "module": module })),
        )
        .expect("module-dashboard succeeds against the real fixture");

        assert_eq!(value["module"]["slug"], "token-verifier");
        assert_eq!(value["latestRun"]["run"], 1184);

        assert_eq!(value["budgets"]["withProbe"], 2);
        assert_eq!(value["budgets"]["total"], 3);
        assert_eq!(value["budgets"]["hardMissingProbe"], 1);

        assert_eq!(value["tests"]["passing"], 5);
        assert_eq!(value["tests"]["total"], 7);
        assert_eq!(value["tests"]["failing"], 1);
        assert_eq!(value["tests"]["unlinked"], 1);

        assert_eq!(value["linter"]["rules"], 14);
        assert_eq!(value["linter"]["violations"], 0);

        assert_eq!(value["reconciliation"]["matched"], 7);
        assert_eq!(value["reconciliation"]["declaredAbsent"], 1);
        assert_eq!(value["reconciliation"]["presentUnknown"], 0);
        assert_eq!(value["reconciliation"]["duplicate"], 0);

        let rows = value["reconciliationRows"]
            .as_array()
            .expect("reconciliationRows is an array");
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0]["outcome"], "matched");
        assert_eq!(rows[0]["count"], 7);
        assert_eq!(rows[0]["site"], "src/auth/verifier.ts +3 more");
        assert_eq!(rows[1]["outcome"], "declared, absent");
        assert_eq!(rows[1]["count"], 1);
        assert_eq!(rows[1]["site"], "skew_window — no marker");
        assert_eq!(rows[2]["site"], "—");
        assert_eq!(rows[3]["site"], "—");

        let audit = value["auditLog"].as_array().expect("auditLog is an array");
        assert_eq!(audit.len(), 5);
        assert_eq!(audit[0]["to"], "accepted");
        assert_eq!(audit[0]["actorName"], "m.ross");
    }

    #[test]
    fn module_dashboard_reports_no_run_and_dashes_for_a_module_that_never_ran() {
        let dir = TempDir::new("module-dashboard-no-run");
        let store = Store::open(dir.path());
        store.init().expect("init succeeds");
        let context = context_at(dir.path());

        let scope = sample_service_node();
        store.write_node(&scope).expect("seed write succeeds");

        let value = dispatch(
            &context,
            "schematify/module-dashboard",
            Some(json!({ "actor": "human", "module": scope.id().to_string() })),
        )
        .expect("module-dashboard succeeds against a node with no run");

        assert!(value["latestRun"].is_null());
        assert!(value["linter"].is_null());
        assert!(value["reconciliation"].is_null());
        assert_eq!(value["budgets"]["total"], 0);
        assert_eq!(value["tests"]["total"], 0);
        let rows = value["reconciliationRows"].as_array().unwrap();
        for row in rows {
            assert_eq!(row["site"], "—");
            assert_eq!(row["count"], 0);
        }
    }

    #[test]
    fn list_runs_against_the_real_fixture_finds_the_one_ingested_run() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("crates")
            .join("schematify-core")
            .join("fixtures")
            .join("saas-backend");
        let context = context_at(&root);

        let value = dispatch(
            &context,
            "schematify/runs",
            Some(json!({ "actor": "human" })),
        )
        .expect("runs succeeds against the real fixture");

        let runs = value["runs"].as_array().expect("runs is an array");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["run"], 1184);
        assert_eq!(runs[0]["module"]["slug"], "token-verifier");
        assert_eq!(runs[0]["workflow"], "ci/verify.yml");
    }

    #[test]
    fn list_runs_reports_none_for_a_project_that_has_never_run() {
        let dir = TempDir::new("list-runs-empty");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let value = dispatch(
            &context,
            "schematify/runs",
            Some(json!({ "actor": "agent" })),
        )
        .expect("runs succeeds over an empty project");
        assert_eq!(value["runs"].as_array().expect("array").len(), 0);
    }

    #[test]
    fn module_dashboard_refuses_an_id_that_names_no_node() {
        let dir = TempDir::new("module-dashboard-missing");
        Store::open(dir.path()).init().expect("init succeeds");
        let context = context_at(dir.path());

        let err = dispatch(
            &context,
            "schematify/module-dashboard",
            Some(json!({ "actor": "human", "module": schematify_core::mint_id().to_string() })),
        )
        .expect_err("an id with no node is refused");
        assert_eq!(err.code, INVALID_PARAMS);
    }
}
