//! The graph loader of PRD section 6.4, with quarantine on a dangling
//! reference.
//!
//! On project open Schematify walks `.kaava/`, parses every file, and builds
//! the graph in memory. There is no index to consult and none to keep in step.
//!
//! The loader never panics and never returns early on bad data. A design tree
//! lives in git, gets hand-edited, gets merged, and arrives with a reference
//! to a node somebody deleted on another branch. PRD section 6.6 says what to
//! do about it: quarantine the referring node, report the reference, and never
//! drop it in silence. So the only error this module returns is "there is no
//! project here". Everything else lands in the [`Report`], which the caller
//! reads alongside a graph that loaded.
//!
//! Reading is split across threads because the budget is tight: PRD section
//! 14.7 gives the stress fixture, 5000 files, under 1000 ms. Parsing is the
//! cost and it is trivially parallel, since each file becomes one value and
//! nothing joins up until the graph is assembled.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::brief::ProjectBrief;
use crate::decision::Decision;
use crate::edge::{Edge, EdgeKind};
use crate::error::{CoreError, Result};
use crate::graph::Graph;
use crate::layout::Layout;
use crate::lifecycle::AuditRow;
use crate::node::Node;
use crate::product::{Flow, Screen};
use crate::registry::{LibraryRegistry, Rule};
use crate::run::RunArtifact;
use crate::slug::{SlugIndex, SlugScope};
use crate::uri::{Uri, UriKind};

/// Why a node was quarantined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuarantineReason {
    /// The `parent` field names a node that is not in the tree.
    MissingParent,
    /// A `decisions` entry names a decision that is not in the tree.
    MissingDecision,
    /// A `superseded_by` field names something that is not in the tree.
    MissingSuccessor,
    /// An edge endpoint names something that is not in the tree.
    MissingEndpoint,
    /// A `ui_refs` entry names a screen that is not in the tree.
    MissingScreen,
    /// An `allowed_libraries` or `registry_ref` entry is absent from the
    /// library registry.
    MissingLibrary,
    /// An `exports`, `members`, `anchor`, or `backed_by` entry names a node
    /// that is not in the tree.
    MissingNode,
    /// A flow step names a screen that is not in the tree.
    MissingFlowScreen,
    /// A run file declares a schema version this build does not read.
    UnknownRunSchema,
}

impl QuarantineReason {
    /// What this reason says on a Problems row.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissingParent => "containment parent does not exist",
            Self::MissingDecision => "decision does not exist",
            Self::MissingSuccessor => "superseding node does not exist",
            Self::MissingEndpoint => "edge endpoint does not exist",
            Self::MissingScreen => "screen does not exist",
            Self::MissingLibrary => "library is absent from the registry",
            Self::MissingNode => "node does not exist",
            Self::MissingFlowScreen => "flow step screen does not exist",
            Self::UnknownRunSchema => "run artifact declares an unknown schema",
        }
    }
}

/// One quarantined thing, and the reference that put it there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quarantine {
    /// What was quarantined.
    pub subject: Uuid,
    /// The field the bad reference sat in.
    pub field: String,
    /// The reference itself, as it was written.
    pub reference: String,
    /// Why it failed to resolve.
    pub reason: QuarantineReason,
    /// The file it was read from.
    pub file: PathBuf,
}

/// One file that could not be read or parsed.
#[derive(Debug)]
pub struct ReadProblem {
    /// The file.
    pub file: PathBuf,
    /// What went wrong.
    pub error: CoreError,
}

/// What the loader found, alongside the graph it built.
#[derive(Debug, Default)]
pub struct Report {
    /// Every dangling reference, and what it quarantined.
    pub quarantined: Vec<Quarantine>,
    /// Every file that would not read or parse.
    pub unreadable: Vec<ReadProblem>,
    /// Every slug collision, as the error the slug index raised.
    pub slug_collisions: Vec<crate::slug::SlugError>,
    /// Every slug the loader claimed, so a caller can look one up.
    ///
    /// It sits on the report rather than on the graph because it is a load
    /// time artifact: the graph is what loaded, and this is what the loading
    /// found on the way.
    pub slug_index: SlugIndex,
    /// How long the load took.
    pub duration_ms: u128,
}

impl Report {
    /// Whether the load found nothing wrong.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.quarantined.is_empty() && self.unreadable.is_empty() && self.slug_collisions.is_empty()
    }

    /// What holds a slug in a scope, if anything does.
    #[must_use]
    pub fn slug_owner(&self, scope: SlugScope, slug: &str) -> Option<Uuid> {
        self.slug_index.lookup(scope, slug)
    }
}

/// A loaded project.
#[derive(Debug)]
pub struct LoadOutcome {
    /// The graph, including anything quarantined.
    pub graph: Graph,
    /// What the loader found on the way.
    pub report: Report,
}

/// Walk `.kaava/` under a project root and build the graph.
///
/// # Errors
///
/// Returns [`CoreError::NoProject`] when the directory holds no `.kaava/`
/// tree. Every other failure is reported rather than returned, because a
/// project that half-loads is worth drawing and a project that does not exist
/// is not.
pub fn load_project(project_root: &Path) -> Result<LoadOutcome> {
    let started = Instant::now();
    let kaava = project_root.join(".kaava");
    if !kaava.is_dir() {
        return Err(CoreError::NoProject {
            root: project_root.to_path_buf(),
        });
    }

    let mut graph = Graph::new();
    let mut report = Report::default();

    let (nodes, problems) = read_directory::<Node>(&kaava.join("nodes"), "node");
    report.unreadable.extend(problems);
    let (edges, problems) = read_directory::<Edge>(&kaava.join("edges"), "edge");
    report.unreadable.extend(problems);
    let (screens, problems) = read_directory::<Screen>(&kaava.join("screens"), "screen");
    report.unreadable.extend(problems);
    let (flows, problems) = read_directory::<Flow>(&kaava.join("flows"), "flow");
    report.unreadable.extend(problems);
    let (decisions, problems) = read_directory::<Decision>(&kaava.join("decisions"), "decision");
    report.unreadable.extend(problems);
    let (rules, problems) = read_directory::<Rule>(&kaava.join("rules"), "rule");
    report.unreadable.extend(problems);
    let (layouts, problems) = read_directory::<Layout>(&kaava.join("layout"), "layout");
    report.unreadable.extend(problems);

    if let Some(registry) = read_one::<LibraryRegistry>(
        &kaava.join("registry").join("libraries.json"),
        "library registry",
        &mut report,
    ) {
        graph.set_libraries(registry);
    }
    if let Some(brief) = read_one::<ProjectBrief>(&kaava.join("brief.json"), "brief", &mut report) {
        graph.set_brief(brief);
    }

    for (_, node) in nodes {
        let scope = SlugScope::for_node(node.kind(), node.envelope.parent);
        if let Err(error) = report
            .slug_index
            .claim(scope, &node.envelope.slug, node.id())
        {
            report.slug_collisions.push(error);
        }
        graph.insert_node(node);
    }
    for (_, edge) in edges {
        graph.insert_edge(edge);
    }
    for (_, screen) in screens {
        graph.insert_screen(screen);
    }
    for (_, flow) in flows {
        graph.insert_flow(flow);
    }
    for (_, decision) in decisions {
        graph.insert_decision(decision);
    }
    for (_, rule) in rules {
        graph.insert_rule(rule);
    }
    for (_, layout) in layouts {
        graph.insert_layout(layout);
    }

    read_runs(&kaava.join("runs"), &mut graph, &mut report);
    graph.reindex();
    resolve_references(&kaava, &mut graph, &mut report);

    report.duration_ms = started.elapsed().as_millis();
    Ok(LoadOutcome { graph, report })
}

/// Read every `.json` file in a directory, in parallel.
///
/// A directory that does not exist reads as empty. A project with no flows has
/// no `flows/`, and treating that as a failure would make an empty project
/// unloadable.
fn read_directory<T: DeserializeOwned + Send>(
    directory: &Path,
    schema: &'static str,
) -> (Vec<(PathBuf, T)>, Vec<ReadProblem>) {
    read_files(&json_files(directory), schema)
}

/// Parse a known list of files, in parallel.
fn read_files<T: DeserializeOwned + Send>(
    paths: &[PathBuf],
    schema: &'static str,
) -> (Vec<(PathBuf, T)>, Vec<ReadProblem>) {
    if paths.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let workers = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    let chunk = paths.len().div_ceil(workers.max(1));

    let mut values = Vec::with_capacity(paths.len());
    let mut problems = Vec::new();

    std::thread::scope(|scope| {
        let handles: Vec<_> = paths
            .chunks(chunk.max(1))
            .map(|slice| scope.spawn(move || parse_all::<T>(slice, schema)))
            .collect();
        for handle in handles {
            match handle.join() {
                Ok((parsed, failed)) => {
                    values.extend(parsed);
                    problems.extend(failed);
                }
                // A worker panics only if serde does, which is a bug rather
                // than bad input. The load continues without that chunk so the
                // rest of the project still opens.
                Err(_) => problems.push(ReadProblem {
                    file: PathBuf::from(schema),
                    error: CoreError::Io {
                        path: PathBuf::from(schema),
                        source: std::io::Error::other("a parse worker panicked"),
                    },
                }),
            }
        }
    });

    (values, problems)
}

fn parse_all<T: DeserializeOwned>(
    paths: &[PathBuf],
    schema: &'static str,
) -> (Vec<(PathBuf, T)>, Vec<ReadProblem>) {
    let mut values = Vec::with_capacity(paths.len());
    let mut problems = Vec::new();
    for path in paths {
        match fs::read(path) {
            Err(source) => problems.push(ReadProblem {
                file: path.clone(),
                error: CoreError::Io {
                    path: path.clone(),
                    source,
                },
            }),
            Ok(bytes) => match serde_json::from_slice::<T>(&bytes) {
                Ok(value) => values.push((path.clone(), value)),
                Err(source) => problems.push(ReadProblem {
                    file: path.clone(),
                    error: CoreError::Parse {
                        path: path.clone(),
                        schema,
                        source,
                    },
                }),
            },
        }
    }
    (values, problems)
}

fn json_files(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == "json"))
        .collect()
}

fn read_one<T: DeserializeOwned>(
    path: &Path,
    schema: &'static str,
    report: &mut Report,
) -> Option<T> {
    if !path.is_file() {
        return None;
    }
    match fs::read(path) {
        Err(source) => {
            report.unreadable.push(ReadProblem {
                file: path.to_path_buf(),
                error: CoreError::Io {
                    path: path.to_path_buf(),
                    source,
                },
            });
            None
        }
        Ok(bytes) => match serde_json::from_slice::<T>(&bytes) {
            Ok(value) => Some(value),
            Err(source) => {
                report.unreadable.push(ReadProblem {
                    file: path.to_path_buf(),
                    error: CoreError::Parse {
                        path: path.to_path_buf(),
                        schema,
                        source,
                    },
                });
                None
            }
        },
    }
}

fn read_runs(directory: &Path, graph: &mut Graph, report: &mut Report) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(node) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| Uuid::parse_str(n).ok())
        else {
            continue;
        };

        if let Some(rows) = read_one::<Vec<AuditRow>>(&path.join("audit.json"), "audit", report) {
            graph.insert_audit(node, rows);
        }

        // `audit.json` sits in this directory too and holds an array of
        // transition rows rather than a run. Reading every file here would
        // report it as a broken run on every load.
        let (runs, problems) = read_files::<RunArtifact>(
            &json_files(&path)
                .into_iter()
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("run-"))
                })
                .collect::<Vec<_>>(),
            "run",
        );
        report.unreadable.extend(problems);
        for (file, run) in runs {
            if run.is_known_schema() {
                graph.insert_run(node, run);
            } else {
                report.quarantined.push(Quarantine {
                    subject: node,
                    field: "schema".to_owned(),
                    reference: run.schema.clone(),
                    reason: QuarantineReason::UnknownRunSchema,
                    file,
                });
            }
        }
    }
}

/// Resolve every stored reference, quarantining what does not land.
///
/// The subject of a quarantine is the *referring* thing, never the missing
/// one. A missing node has no record to attach a problem to, and the thing a
/// person has to fix is the reference that points at nothing.
fn resolve_references(kaava: &Path, graph: &mut Graph, report: &mut Report) {
    let ids: Vec<Uuid> = graph.nodes().map(Node::id).collect();
    let mut quarantine = Vec::new();

    for id in ids {
        let Some(node) = graph.node(id) else { continue };
        let file = kaava.join("nodes").join(format!("{id}.json"));
        let mut problems = Vec::new();

        if let Some(parent) = node.envelope.parent {
            if graph.node(parent).is_none() {
                problems.push((
                    "parent",
                    parent.to_string(),
                    QuarantineReason::MissingParent,
                ));
            }
        }
        if let Some(successor) = node.envelope.superseded_by {
            if graph.node(successor).is_none() {
                problems.push((
                    "superseded_by",
                    successor.to_string(),
                    QuarantineReason::MissingSuccessor,
                ));
            }
        }
        for uri in &node.envelope.decisions {
            if !resolves(graph, *uri) {
                problems.push((
                    "decisions",
                    uri.to_string(),
                    QuarantineReason::MissingDecision,
                ));
            }
        }

        if let Ok(module) = node.module() {
            for library in &module.allowed_libraries {
                if !graph.libraries().contains(*library) {
                    problems.push((
                        "allowed_libraries",
                        library.to_string(),
                        QuarantineReason::MissingLibrary,
                    ));
                }
            }
            for uri in &module.ui_refs {
                if !resolves(graph, *uri) {
                    problems.push(("ui_refs", uri.to_string(), QuarantineReason::MissingScreen));
                }
            }
        }
        if let Ok(service) = node.service() {
            for export in &service.exports {
                if graph.node(*export).is_none() {
                    problems.push(("exports", export.to_string(), QuarantineReason::MissingNode));
                }
            }
        }
        if let Ok(dep) = node.external_dep() {
            if !graph.libraries().contains(dep.registry_ref) {
                problems.push((
                    "registry_ref",
                    dep.registry_ref.to_string(),
                    QuarantineReason::MissingLibrary,
                ));
            }
        }
        if let Ok(comment) = node.comment() {
            if let Some(anchor) = comment.anchor {
                if graph.node(anchor).is_none() {
                    problems.push(("anchor", anchor.to_string(), QuarantineReason::MissingNode));
                }
            }
        }
        if let Ok(group) = node.group() {
            for member in &group.members {
                if graph.node(*member).is_none() {
                    problems.push(("members", member.to_string(), QuarantineReason::MissingNode));
                }
            }
        }

        for (field, reference, reason) in problems {
            quarantine.push(Quarantine {
                subject: id,
                field: field.to_owned(),
                reference,
                reason,
                file: file.clone(),
            });
        }
    }

    let edges: Vec<Edge> = graph.edges().cloned().collect();
    for edge in edges {
        let file = kaava.join("edges").join(format!("{}.json", edge.id));
        for (field, endpoint) in [("source", edge.source), ("target", edge.target)] {
            if !endpoint_exists(graph, edge.kind, field, endpoint) {
                quarantine.push(Quarantine {
                    subject: edge.id,
                    field: field.to_owned(),
                    reference: endpoint.to_string(),
                    reason: QuarantineReason::MissingEndpoint,
                    file: file.clone(),
                });
            }
        }
    }

    let screens: Vec<(Uuid, Vec<Uri>)> = graph
        .screens()
        .map(|s| (s.id, s.backed_by.clone()))
        .collect();
    for (id, backed_by) in screens {
        let file = kaava.join("screens").join(format!("{id}.json"));
        for uri in backed_by {
            if !resolves(graph, uri) {
                quarantine.push(Quarantine {
                    subject: id,
                    field: "backed_by".to_owned(),
                    reference: uri.to_string(),
                    reason: QuarantineReason::MissingNode,
                    file: file.clone(),
                });
            }
        }
    }

    let flows: Vec<(Uuid, Vec<Uri>)> = graph
        .flows()
        .map(|f| (f.id, f.steps.iter().map(|s| s.screen).collect()))
        .collect();
    for (id, steps) in flows {
        let file = kaava.join("flows").join(format!("{id}.json"));
        for uri in steps {
            if !resolves(graph, uri) {
                quarantine.push(Quarantine {
                    subject: id,
                    field: "steps".to_owned(),
                    reference: uri.to_string(),
                    reason: QuarantineReason::MissingFlowScreen,
                    file: file.clone(),
                });
            }
        }
    }

    let decisions: Vec<(Uuid, Option<Uuid>, Option<Uuid>)> = graph
        .decisions()
        .map(|d| (d.id, d.supersedes, d.superseded_by))
        .collect();
    for (id, supersedes, superseded_by) in decisions {
        let file = kaava.join("decisions").join(format!("{id}.json"));
        for (field, target) in [("supersedes", supersedes), ("superseded_by", superseded_by)] {
            if let Some(target) = target {
                if graph.decision(target).is_none() {
                    quarantine.push(Quarantine {
                        subject: id,
                        field: field.to_owned(),
                        reference: target.to_string(),
                        reason: QuarantineReason::MissingSuccessor,
                        file: file.clone(),
                    });
                }
            }
        }
    }

    for record in &quarantine {
        graph.quarantine(record.subject);
    }
    report.quarantined.extend(quarantine);
}

fn resolves(graph: &Graph, uri: Uri) -> bool {
    match uri.kind {
        UriKind::Node => graph.node(uri.id).is_some(),
        UriKind::Screen => graph.screen(uri.id).is_some(),
        UriKind::Flow => graph.flow(uri.id).is_some(),
        UriKind::Decision => graph.decision(uri.id).is_some(),
    }
}

/// Whether an edge endpoint names something that exists.
///
/// The target of a `references_ui` edge is a screen rather than a node, which
/// is the one place an endpoint leaves the node collection. Everything else
/// joins two nodes.
fn endpoint_exists(graph: &Graph, kind: EdgeKind, field: &str, id: Uuid) -> bool {
    if kind == EdgeKind::ReferencesUi && field == "target" {
        return graph.screen(id).is_some();
    }
    graph.node(id).is_some()
}
