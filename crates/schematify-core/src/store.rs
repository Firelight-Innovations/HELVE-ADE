//! The `.kaava/` storage layout of PRD section 6, and the writes it allows.
//!
//! The three layers are not organisational tidiness. They are the enforcement
//! mechanism for the rule that an agent shall not change the design: the
//! permission boundary is a path glob, so CODEOWNERS and a CI path check
//! enforce it mechanically rather than by instruction. A benchmark job
//! appending latency numbers writes to `runs/`; a person editing a contract
//! writes to `nodes/`; the two writes never conflict. Layout splits for the
//! same reason, so dragging a node does not dirty a semantic file.
//!
//! [`Store::write_transition`] is the one exception, PRD section 6.3: a
//! lifecycle change writes a node and appends an audit row in one action, and
//! the CI gate passes that pair and blocks every other write touching both
//! trees. [`allowed_together`] is that gate as a function.
//!
//! Nothing is deleted. [`Store::deprecate`] is what a caller reaches for
//! instead, and [`Store::delete_node`] exists to refuse.

use std::fs;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::atomic::write_json_atomic;
use crate::decision::Decision;
use crate::edge::Edge;
use crate::error::{CoreError, Result};
use crate::graph::Graph;
use crate::layout::Layout;
use crate::lifecycle::{check_transition, Actor, AuditRow, Lifecycle};
use crate::node::Node;
use crate::product::{Flow, Screen};
use crate::registry::{LibraryRegistry, Rule};
use crate::run::RunArtifact;

/// The directory name Schematify keeps design data in.
const KAAVA: &str = ".kaava";

/// Which of the three layers of PRD section 6.2 a path belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WriteLayer {
    /// Human-authored design. Nodes, edges, screens, flows, decisions, rules,
    /// the library registry, and the brief.
    Semantic,
    /// Machine-written history, append-only. Runs and lifecycle audits.
    Audit,
    /// Positions. A lost cosmetic file costs positions and nothing else.
    Cosmetic,
}

impl WriteLayer {
    /// Whether this layer's content is expected to vary by branch.
    ///
    /// Semantic and cosmetic data do, and PRD section 6.5 says that is correct
    /// rather than a defect: a branch that changes the design and the code
    /// together, reviewed as one pull request, is the traceability property in
    /// operation. Audit data does not - a sign-off outlives the branch it was
    /// made on, and this is the seam the future hosted store cuts along.
    #[must_use]
    pub fn varies_by_branch(self) -> bool {
        self != Self::Audit
    }
}

/// Which layer a path under `.kaava/` belongs to.
///
/// Returns `None` for a path outside `.kaava/`, or one this build does not
/// recognise. An unknown path is not assumed semantic: a gate that guesses
/// would either block a legitimate write or pass one it should have caught.
#[must_use]
pub fn layer_of(path: &Path) -> Option<WriteLayer> {
    let mut after_kaava = false;
    for part in path.components() {
        let part = part.as_os_str().to_string_lossy();
        if part == KAAVA {
            after_kaava = true;
            continue;
        }
        if !after_kaava {
            continue;
        }
        return match part.as_ref() {
            "nodes" | "edges" | "screens" | "flows" | "decisions" | "rules" | "registry" => {
                Some(WriteLayer::Semantic)
            }
            "brief.json" => Some(WriteLayer::Semantic),
            "runs" => Some(WriteLayer::Audit),
            "layout" => Some(WriteLayer::Cosmetic),
            _ => None,
        };
    }
    None
}

/// Whether a set of paths may be written in one action.
///
/// The rule of PRD section 6.3: a write touching both `nodes/` and `runs/` is
/// allowed when it is exactly one node file and exactly one `audit.json`, and
/// is blocked otherwise. Anything that touches neither pair is allowed, since
/// this gate is about the semantic and audit trees meeting and nothing else.
#[must_use]
pub fn allowed_together(paths: &[PathBuf]) -> bool {
    let semantic: Vec<&PathBuf> = paths
        .iter()
        .filter(|p| layer_of(p) == Some(WriteLayer::Semantic))
        .collect();
    let audit: Vec<&PathBuf> = paths
        .iter()
        .filter(|p| layer_of(p) == Some(WriteLayer::Audit))
        .collect();

    if semantic.is_empty() || audit.is_empty() {
        return true;
    }

    let one_node = semantic.len() == 1
        && semantic[0]
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|n| n == "nodes");
    let one_audit = audit.len() == 1
        && audit[0]
            .file_name()
            .is_some_and(|n| n == "audit.json");
    one_node && one_audit
}

/// One project's `.kaava/` tree, and the writes into it.
#[derive(Debug, Clone)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    /// A store over a project directory. `.kaava/` sits inside it.
    #[must_use]
    pub fn open(project_root: impl Into<PathBuf>) -> Self {
        Self {
            root: project_root.into(),
        }
    }

    /// The project directory.
    #[must_use]
    pub fn project_root(&self) -> &Path {
        &self.root
    }

    /// The `.kaava/` directory itself.
    #[must_use]
    pub fn kaava_dir(&self) -> PathBuf {
        self.root.join(KAAVA)
    }

    /// Where a node file lives.
    #[must_use]
    pub fn node_path(&self, id: Uuid) -> PathBuf {
        self.kaava_dir().join("nodes").join(format!("{id}.json"))
    }

    /// Where an edge file lives.
    #[must_use]
    pub fn edge_path(&self, id: Uuid) -> PathBuf {
        self.kaava_dir().join("edges").join(format!("{id}.json"))
    }

    /// Where a screen file lives.
    #[must_use]
    pub fn screen_path(&self, id: Uuid) -> PathBuf {
        self.kaava_dir().join("screens").join(format!("{id}.json"))
    }

    /// Where a flow file lives.
    #[must_use]
    pub fn flow_path(&self, id: Uuid) -> PathBuf {
        self.kaava_dir().join("flows").join(format!("{id}.json"))
    }

    /// Where a decision file lives.
    #[must_use]
    pub fn decision_path(&self, id: Uuid) -> PathBuf {
        self.kaava_dir().join("decisions").join(format!("{id}.json"))
    }

    /// Where a rule file lives.
    #[must_use]
    pub fn rule_path(&self, id: Uuid) -> PathBuf {
        self.kaava_dir().join("rules").join(format!("{id}.json"))
    }

    /// Where the one library registry file lives.
    #[must_use]
    pub fn libraries_path(&self) -> PathBuf {
        self.kaava_dir().join("registry").join("libraries.json")
    }

    /// Where the project brief lives.
    #[must_use]
    pub fn brief_path(&self) -> PathBuf {
        self.kaava_dir().join("brief.json")
    }

    /// Where a Schematic's layout lives, named by slug rather than by UUID.
    #[must_use]
    pub fn layout_path(&self, schematic: &str) -> PathBuf {
        self.kaava_dir()
            .join("layout")
            .join(format!("{schematic}.json"))
    }

    /// Where one ingested run lives.
    #[must_use]
    pub fn run_path(&self, node: Uuid, run: u64) -> PathBuf {
        self.kaava_dir()
            .join("runs")
            .join(node.to_string())
            .join(format!("run-{run}.json"))
    }

    /// Where a node's lifecycle audit lives.
    #[must_use]
    pub fn audit_path(&self, node: Uuid) -> PathBuf {
        self.kaava_dir()
            .join("runs")
            .join(node.to_string())
            .join("audit.json")
    }

    /// Create the directory tree of PRD section 6.1.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Io`] when a directory cannot be created.
    pub fn init(&self) -> Result<()> {
        for directory in [
            "nodes", "edges", "screens", "flows", "decisions", "rules", "registry", "runs",
            "layout",
        ] {
            let path = self.kaava_dir().join(directory);
            fs::create_dir_all(&path).map_err(|source| CoreError::Io { path, source })?;
        }
        Ok(())
    }

    /// Write one node.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_node(&self, node: &Node) -> Result<()> {
        write_json_atomic(&self.node_path(node.id()), node)?;
        Ok(())
    }

    /// Write one edge. A `contains` edge is refused, because containment lives
    /// on the child node and a second copy would be a second truth.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_edge(&self, edge: &Edge) -> Result<bool> {
        if !edge.is_stored() {
            return Ok(false);
        }
        write_json_atomic(&self.edge_path(edge.id), edge)?;
        Ok(true)
    }

    /// Write one screen.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_screen(&self, screen: &Screen) -> Result<()> {
        write_json_atomic(&self.screen_path(screen.id), screen)?;
        Ok(())
    }

    /// Write one flow.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_flow(&self, flow: &Flow) -> Result<()> {
        write_json_atomic(&self.flow_path(flow.id), flow)?;
        Ok(())
    }

    /// Write one decision.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_decision(&self, decision: &Decision) -> Result<()> {
        write_json_atomic(&self.decision_path(decision.id), decision)?;
        Ok(())
    }

    /// Write one rule.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_rule(&self, rule: &Rule) -> Result<()> {
        write_json_atomic(&self.rule_path(rule.id), rule)?;
        Ok(())
    }

    /// Write the library registry.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_libraries(&self, registry: &LibraryRegistry) -> Result<()> {
        write_json_atomic(&self.libraries_path(), registry)?;
        Ok(())
    }

    /// Write one layout.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::AtomicWrite`] when the write fails.
    pub fn write_layout(&self, layout: &Layout) -> Result<()> {
        write_json_atomic(&self.layout_path(&layout.schematic), layout)?;
        Ok(())
    }

    /// Ingest one run artifact.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::UnknownRunSchema`] when the artifact declares a
    /// schema this build does not read, and [`CoreError::AtomicWrite`] when
    /// the write fails.
    pub fn write_run(&self, node: Uuid, run: &RunArtifact) -> Result<()> {
        if !run.is_known_schema() {
            return Err(CoreError::UnknownRunSchema {
                found: run.schema.clone(),
                expected: crate::run::RUN_SCHEMA_VERSION,
            });
        }
        write_json_atomic(&self.run_path(node, run.run), run)?;
        Ok(())
    }

    /// Move a node's lifecycle on, writing the node and appending the audit
    /// row as the one action PRD section 6.3 allows.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Lifecycle`] when the transition is illegal or the
    /// actor is not allowed it, and the node file is left untouched. Returns
    /// [`CoreError::Io`] or [`CoreError::AtomicWrite`] when either write
    /// fails.
    pub fn write_transition(
        &self,
        node: &mut Node,
        to: Lifecycle,
        actor: Actor,
        actor_name: &str,
        at: &str,
        reason: &str,
    ) -> Result<AuditRow> {
        let from = node.envelope.lifecycle;
        check_transition(from, to, actor)?;

        let row = AuditRow {
            node: node.id(),
            at: at.to_owned(),
            from,
            to,
            actor,
            actor_name: actor_name.to_owned(),
            reason: reason.to_owned(),
        };

        node.envelope.lifecycle = to;
        self.write_node(node)?;

        let mut history = self.read_audit(node.id())?;
        history.push(row.clone());
        write_json_atomic(&self.audit_path(node.id()), &history)?;
        Ok(row)
    }

    /// A node's audit history, or an empty history when it has none.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Io`] when the file exists and cannot be read, and
    /// [`CoreError::Parse`] when it holds something other than a row array.
    pub fn read_audit(&self, node: Uuid) -> Result<Vec<AuditRow>> {
        let path = self.audit_path(node);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let text = fs::read_to_string(&path).map_err(|source| CoreError::Io {
            path: path.clone(),
            source,
        })?;
        serde_json::from_str(&text).map_err(|source| CoreError::Parse {
            path,
            schema: "audit",
            source,
        })
    }

    /// Rename a layout file when its Schematic slug changes.
    ///
    /// A missing source file is not an error. Layout is cosmetic, and a rename
    /// of a Schematic nobody has opened yet has nothing to move.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Io`] when the rename fails.
    pub fn rename_layout(&self, from: &str, to: &str) -> Result<bool> {
        let source = self.layout_path(from);
        if !source.exists() {
            return Ok(false);
        }
        let target = self.layout_path(to);
        fs::rename(&source, &target).map_err(|error| CoreError::Io {
            path: target,
            source: error,
        })?;
        Ok(true)
    }

    /// Refuse to delete a node, per PRD section 6.6.
    ///
    /// Nothing is ever deleted. This method exists so a caller gets the reason
    /// and the reference count rather than a missing method, and so the rule
    /// has somewhere to be tested.
    ///
    /// # Errors
    ///
    /// Always returns [`CoreError::DeleteRefused`].
    pub fn delete_node(&self, graph: &Graph, id: Uuid) -> Result<()> {
        let inbound = graph.dependents(id).len() + graph.children(id).len();
        Err(CoreError::DeleteRefused { id, inbound })
    }

    /// Retire a node by marking it deprecated and naming its replacement.
    ///
    /// This is what PRD section 6.6 offers instead of deletion, and it takes
    /// the same path as any other transition so the audit row is written too.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Lifecycle`] when the actor may not deprecate, and
    /// an IO error when either write fails.
    pub fn deprecate(
        &self,
        node: &mut Node,
        superseded_by: Option<Uuid>,
        actor: Actor,
        actor_name: &str,
        at: &str,
        reason: &str,
    ) -> Result<AuditRow> {
        node.envelope.superseded_by = superseded_by;
        self.write_transition(node, Lifecycle::Deprecated, actor, actor_name, at, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{NodeEnvelope, NodeKind};
    use crate::slug::Slug;

    fn node(id: u128, lifecycle: Lifecycle) -> Node {
        Node::new(NodeEnvelope {
            id: Uuid::from_u128(id),
            slug: Slug::new("token-verifier").unwrap(),
            kind: NodeKind::Module,
            title: "Token Verifier".to_owned(),
            description: None,
            lifecycle,
            layer: None,
            parent: None,
            decisions: Vec::new(),
            authored_by: Actor::Human,
            created: "2026-08-25T00:00:00Z".to_owned(),
            superseded_by: None,
        })
    }

    #[test]
    fn every_path_sits_where_the_prd_puts_it() {
        let store = Store::open("C:/work/saas-backend");
        let id = Uuid::from_u128(1);
        let ends = |p: PathBuf| p.to_string_lossy().replace('\\', "/");
        assert!(ends(store.node_path(id)).ends_with(".kaava/nodes/00000000-0000-0000-0000-000000000001.json"));
        assert!(ends(store.edge_path(id)).contains(".kaava/edges/"));
        assert!(ends(store.libraries_path()).ends_with(".kaava/registry/libraries.json"));
        assert!(ends(store.brief_path()).ends_with(".kaava/brief.json"));
        assert!(ends(store.layout_path("auth-service")).ends_with(".kaava/layout/auth-service.json"));
        assert!(ends(store.run_path(id, 1184)).ends_with("/run-1184.json"));
        assert!(ends(store.audit_path(id)).ends_with("/audit.json"));
    }

    #[test]
    fn each_directory_reports_its_layer() {
        let store = Store::open("/p");
        let id = Uuid::from_u128(1);
        assert_eq!(layer_of(&store.node_path(id)), Some(WriteLayer::Semantic));
        assert_eq!(layer_of(&store.edge_path(id)), Some(WriteLayer::Semantic));
        assert_eq!(layer_of(&store.brief_path()), Some(WriteLayer::Semantic));
        assert_eq!(layer_of(&store.libraries_path()), Some(WriteLayer::Semantic));
        assert_eq!(layer_of(&store.run_path(id, 1)), Some(WriteLayer::Audit));
        assert_eq!(layer_of(&store.audit_path(id)), Some(WriteLayer::Audit));
        assert_eq!(layer_of(&store.layout_path("s")), Some(WriteLayer::Cosmetic));
        assert_eq!(layer_of(Path::new("/p/src/main.rs")), None);
    }

    #[test]
    fn the_audit_layer_is_the_one_that_outlives_a_branch() {
        assert!(WriteLayer::Semantic.varies_by_branch());
        assert!(WriteLayer::Cosmetic.varies_by_branch());
        assert!(!WriteLayer::Audit.varies_by_branch());
    }

    #[test]
    fn the_gate_passes_one_node_with_one_audit_and_blocks_the_rest() {
        let store = Store::open("/p");
        let id = Uuid::from_u128(1);
        let other = Uuid::from_u128(2);

        assert!(allowed_together(&[store.node_path(id), store.audit_path(id)]));
        assert!(allowed_together(&[store.node_path(id)]));
        assert!(allowed_together(&[store.run_path(id, 1), store.run_path(id, 2)]));
        assert!(!allowed_together(&[
            store.node_path(id),
            store.node_path(other),
            store.audit_path(id)
        ]));
        assert!(!allowed_together(&[
            store.node_path(id),
            store.run_path(id, 1184)
        ]));
        assert!(!allowed_together(&[
            store.edge_path(id),
            store.audit_path(id)
        ]));
    }

    #[test]
    fn a_transition_writes_the_node_and_appends_one_audit_row() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        let mut value = node(1, Lifecycle::Reviewed);

        store
            .write_transition(
                &mut value,
                Lifecycle::Accepted,
                Actor::Human,
                "m.ross",
                "2026-08-25T14:02:00Z",
                "Accepted.",
            )
            .unwrap();

        assert_eq!(value.envelope.lifecycle, Lifecycle::Accepted);
        let written: Node =
            serde_json::from_str(&fs::read_to_string(store.node_path(value.id())).unwrap()).unwrap();
        assert_eq!(written.envelope.lifecycle, Lifecycle::Accepted);
        let history = store.read_audit(value.id()).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].to, Lifecycle::Accepted);
    }

    #[test]
    fn an_agent_transition_to_accepted_writes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        let mut value = node(1, Lifecycle::Reviewed);

        let error = store
            .write_transition(
                &mut value,
                Lifecycle::Accepted,
                Actor::Agent,
                "claude-sdd",
                "2026-08-25T14:02:00Z",
                "Tried.",
            )
            .unwrap_err();

        assert!(matches!(error, CoreError::Lifecycle(_)));
        assert_eq!(value.envelope.lifecycle, Lifecycle::Reviewed);
        assert!(!store.node_path(value.id()).exists());
        assert!(store.read_audit(value.id()).unwrap().is_empty());
    }

    #[test]
    fn audit_rows_accumulate_rather_than_replace() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        let mut value = node(1, Lifecycle::Draft);
        for (to, actor) in [
            (Lifecycle::Specified, Actor::Human),
            (Lifecycle::Assigned, Actor::Human),
            (Lifecycle::Implemented, Actor::Agent),
        ] {
            store
                .write_transition(&mut value, to, actor, "who", "2026-08-25T00:00:00Z", "why")
                .unwrap();
        }
        assert_eq!(store.read_audit(value.id()).unwrap().len(), 3);
    }

    #[test]
    fn a_containment_edge_is_never_written() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        let edge = Edge::new(
            Uuid::from_u128(9),
            crate::edge::EdgeKind::Contains,
            Uuid::from_u128(1),
            Uuid::from_u128(2),
            "2026-08-25T00:00:00Z",
        );
        assert!(!store.write_edge(&edge).unwrap());
        assert!(!store.edge_path(edge.id).exists());
    }

    #[test]
    fn a_run_with_an_unknown_schema_is_refused_before_it_is_written() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        let run = RunArtifact {
            schema: "kaava-bench-v9".to_owned(),
            run: 1,
            at: "2026-08-25T00:00:00Z".to_owned(),
            commit: "abc".to_owned(),
            workflow: "ci/verify.yml".to_owned(),
            budgets: Vec::new(),
            tests: Vec::new(),
            linter: None,
            reconcile: None,
        };
        let error = store.write_run(Uuid::from_u128(1), &run).unwrap_err();
        assert!(matches!(error, CoreError::UnknownRunSchema { .. }));
        assert!(!store.run_path(Uuid::from_u128(1), 1).exists());
    }

    #[test]
    fn a_layout_rename_moves_the_file_and_a_missing_one_is_not_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        store.write_layout(&Layout::new("auth-service")).unwrap();
        assert!(store.rename_layout("auth-service", "identity-service").unwrap());
        assert!(!store.layout_path("auth-service").exists());
        assert!(store.layout_path("identity-service").exists());
        assert!(!store.rename_layout("never-drawn", "elsewhere").unwrap());
    }

    #[test]
    fn deletion_is_refused_and_names_the_reference_count() {
        let store = Store::open("/p");
        let mut graph = Graph::new();
        graph.insert_node(node(1, Lifecycle::Accepted));
        graph.reindex();
        let error = store.delete_node(&graph, Uuid::from_u128(1)).unwrap_err();
        assert!(matches!(error, CoreError::DeleteRefused { inbound: 0, .. }));
    }

    #[test]
    fn deprecation_records_the_replacement_and_the_row() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        let mut value = node(1, Lifecycle::Accepted);
        let row = store
            .deprecate(
                &mut value,
                Some(Uuid::from_u128(2)),
                Actor::Human,
                "m.ross",
                "2026-08-25T00:00:00Z",
                "Replaced.",
            )
            .unwrap();
        assert_eq!(row.to, Lifecycle::Deprecated);
        assert_eq!(value.envelope.superseded_by, Some(Uuid::from_u128(2)));
    }

    #[test]
    fn init_creates_every_directory_the_prd_lists() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path());
        store.init().unwrap();
        for name in [
            "nodes", "edges", "screens", "flows", "decisions", "rules", "registry", "runs",
            "layout",
        ] {
            assert!(store.kaava_dir().join(name).is_dir(), "{name}");
        }
    }
}
