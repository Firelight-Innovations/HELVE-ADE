//! The Schematify graph linter: rules L01 through L13 of PRD section 10.4.
//!
//! Everything here is a pure function over a loaded [`Graph`]. The linter
//! opens no file and keeps no state between runs, which is what lets the
//! Problems panel re-run it after every edit.
//!
//! **The rule set is a table, not a `match`.** [`CATALOG`] holds one row per
//! rule: its identifier, the name the `RULE` column draws, its severity, and
//! the function that finds it. [`lint`] walks that array and nothing else, so
//! a fourteenth rule is one row and one function rather than a new arm inside
//! an existing one. That is the shape [`crate::EdgeKind`] uses, and it is
//! deliberate: a linter is where a list of special cases accumulates.
//!
//! **A finding carries what the panel draws and where the row navigates.**
//! PRD section 12.14 gives the Problems panel four columns and a click-through
//! per row. [`Finding`] holds the severity, the rule, the `NODE` cell and the
//! [`Location`], and the location doubles as the navigation target. Nothing is
//! left for the panel to invent, because a panel that invents a cell becomes a
//! second definition of what the rule found.

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::edge::{Edge, EdgeKind};
use crate::graph::Graph;
use crate::lifecycle::Lifecycle;
use crate::node::{Node, NodeKind};
use crate::registry::Severity;
use crate::uri::{Uri, UriKind};

/// How many rules PRD section 10.4 defines.
pub const RULE_COUNT: usize = 13;

/// How wide a quoted body is drawn in the `NODE` cell before it is clipped.
///
/// PRD section 16.1 draws `comment "Two caches here…"` against a note whose
/// body runs to ninety characters, so the cell clips at a word boundary and
/// marks the clip. Sixteen is the width that reproduces that row.
const CELL_WIDTH: usize = 16;

/// One rule of PRD section 10.4, by its identifier.
///
/// A new rule is a new variant here, a new arm in [`RuleId::code`] which the
/// compiler asks for, and a new row in [`CATALOG`]. Nothing else changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RuleId {
    /// Containment is a tree.
    L01,
    /// Dependency is acyclic.
    L02,
    /// A budget carries a probe.
    L03,
    /// A whitelisted library sits in the registry.
    L04,
    /// An annotation node carries no semantic edge.
    L05,
    /// Every reference resolves.
    L06,
    /// A superseded decision names its successor.
    L07,
    /// The `ui_refs` cache matches the `references_ui` edges.
    L08,
    /// A cross-service call lands on an exported method.
    L09,
    /// A shared node sits at the lowest common ancestor of its dependents.
    L10,
    /// A contract method carries a covers edge.
    L11,
    /// A live node does not reference a deprecated one.
    L12,
    /// A screen has a backing module.
    L13,
}

impl RuleId {
    /// The identifier drawn beside the rule and stored in a run artifact.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::L01 => "L01",
            Self::L02 => "L02",
            Self::L03 => "L03",
            Self::L04 => "L04",
            Self::L05 => "L05",
            Self::L06 => "L06",
            Self::L07 => "L07",
            Self::L08 => "L08",
            Self::L09 => "L09",
            Self::L10 => "L10",
            Self::L11 => "L11",
            Self::L12 => "L12",
            Self::L13 => "L13",
        }
    }

    /// The name the `RULE` column of the Problems panel draws.
    #[must_use]
    pub fn name(self) -> &'static str {
        self.entry().name
    }

    /// What a violation costs, per PRD section 10.4.
    #[must_use]
    pub fn severity(self) -> Severity {
        self.entry().severity
    }

    /// Every rule, in code order.
    #[must_use]
    pub fn all() -> Vec<Self> {
        CATALOG.iter().map(|row| row.id).collect()
    }

    // A variant with no catalogue row falls back to UNREGISTERED, whose name
    // says so on the surface rather than aborting a lint run over what is a
    // programming error. The test `every_rule_resolves_to_its_own_row` is what
    // keeps that fallback unreachable.
    fn entry(self) -> &'static CatalogRow {
        CATALOG
            .iter()
            .find(|row| row.id == self)
            .unwrap_or(&UNREGISTERED)
    }
}

/// What one rule finds, given the indexed graph.
type RuleFn = fn(&Scan<'_>, &mut Vec<Finding>);

/// One row of the rule table.
struct CatalogRow {
    id: RuleId,
    name: &'static str,
    severity: Severity,
    run: RuleFn,
}

/// The stand-in for a [`RuleId`] nobody gave a catalogue row.
static UNREGISTERED: CatalogRow = CatalogRow {
    id: RuleId::L01,
    name: "Unregistered rule",
    severity: Severity::Review,
    run: no_rule,
};

fn no_rule(_: &Scan<'_>, _: &mut Vec<Finding>) {}

/// PRD section 10.4 as data: one row per rule, and the whole of the dispatch.
static CATALOG: [CatalogRow; RULE_COUNT] = [
    CatalogRow {
        id: RuleId::L01,
        name: "Containment graph is a tree — no node has two parents",
        severity: Severity::Error,
        run: containment_is_a_tree,
    },
    CatalogRow {
        id: RuleId::L02,
        name: "Dependency graph is acyclic",
        severity: Severity::Error,
        run: dependency_is_acyclic,
    },
    CatalogRow {
        id: RuleId::L03,
        name: "Budget declared without a probe",
        severity: Severity::Error,
        run: budget_without_a_probe,
    },
    CatalogRow {
        id: RuleId::L04,
        name: "Library whitelisted but absent from registry",
        severity: Severity::Error,
        run: library_absent_from_registry,
    },
    CatalogRow {
        id: RuleId::L05,
        name: "Annotation node carrying a semantic edge",
        severity: Severity::Error,
        run: annotation_carrying_a_semantic_edge,
    },
    CatalogRow {
        id: RuleId::L06,
        name: "Dangling reference after resolver exists",
        severity: Severity::Error,
        run: dangling_reference,
    },
    CatalogRow {
        id: RuleId::L07,
        name: "Superseded decision without a successor",
        severity: Severity::Error,
        run: superseded_decision_without_successor,
    },
    CatalogRow {
        id: RuleId::L08,
        name: "ui_refs cache does not match references_ui edges",
        severity: Severity::Error,
        run: ui_refs_cache_mismatch,
    },
    CatalogRow {
        id: RuleId::L09,
        name: "Cross-service call to a non-exported method",
        severity: Severity::Error,
        run: cross_service_call_to_unexported,
    },
    CatalogRow {
        id: RuleId::L10,
        name: "Shared node sits above the LCA of its dependents",
        severity: Severity::Warning,
        run: shared_node_above_the_lca,
    },
    CatalogRow {
        id: RuleId::L11,
        name: "Contract method with no covers edge",
        severity: Severity::Warning,
        run: contract_method_without_covers,
    },
    CatalogRow {
        id: RuleId::L12,
        name: "Reference to a deprecated node without acknowledgement",
        severity: Severity::Warning,
        run: reference_to_a_deprecated_node,
    },
    CatalogRow {
        id: RuleId::L13,
        name: "Screen with no backing module",
        severity: Severity::Warning,
        run: screen_without_a_backing_module,
    },
];

/// Which surface a finding is drawn on, and what the `LOCATION` cell reads.
///
/// This doubles as the click-through target of PRD section 12.14: the variant
/// names the Schematic to open and [`Finding::subject`] names what to select
/// on it. A panel holding only the drawn string would have to parse a
/// breadcrumb back into an identifier before it could navigate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "surface", rename_all = "snake_case")]
pub enum Location {
    /// The Stack Schematic. Drawn `Stack`.
    Stack,
    /// One Service Schematic. Drawn `Stack › Auth Service`.
    Service {
        /// The service whose Schematic this is.
        id: Uuid,
        /// Its title, so the cell renders without the graph.
        title: String,
    },
    /// One Module Schematic. Drawn `› Token Verifier`.
    Module {
        /// The module whose Schematic this is.
        id: Uuid,
        /// Its title, so the cell renders without the graph.
        title: String,
    },
    /// The decision log of PRD section 12.18. Drawn `Decision Log`.
    DecisionLog,
    /// The product surfaces of PRD section 12.17. Drawn `Product`.
    Product,
}

impl Location {
    /// The string the `LOCATION` column draws.
    #[must_use]
    pub fn cell(&self) -> String {
        match self {
            Self::Stack => "Stack".to_owned(),
            Self::Service { title, .. } => format!("Stack › {title}"),
            Self::Module { title, .. } => format!("› {title}"),
            Self::DecisionLog => "Decision Log".to_owned(),
            Self::Product => "Product".to_owned(),
        }
    }

    /// The node whose Schematic the row navigates to, where there is one.
    #[must_use]
    pub fn schematic(&self) -> Option<Uuid> {
        match self {
            Self::Service { id, .. } | Self::Module { id, .. } => Some(*id),
            Self::Stack | Self::DecisionLog | Self::Product => None,
        }
    }
}

/// One rule violation, carrying everything a Problems row draws.
///
/// The four columns of PRD section 12.14 come from here and nowhere else:
/// `SEVERITY` from [`Finding::severity`], `RULE` from `rule.name()`, `NODE`
/// from [`Finding::node_cell`], and `LOCATION` from `location.cell()`. The
/// click-through is [`Location::schematic`] plus [`Finding::subject`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    /// Which rule fired.
    pub rule: RuleId,
    /// What the violation costs, copied from the rule so a caller sorts
    /// without a table lookup.
    pub severity: Severity,
    /// What to select once the surface is open.
    pub subject: Uri,
    /// The `NODE` cell, drawn.
    pub node_cell: String,
    /// The `LOCATION` cell, and the surface the row opens.
    pub location: Location,
    /// The evidence, in one sentence, for a tooltip or the Inspector.
    pub detail: String,
    /// The other elements this finding is about, in the order `detail` names
    /// them: the members of a cycle, or the offending edge.
    pub evidence: Vec<Uuid>,
}

impl Finding {
    fn new(
        rule: RuleId,
        subject: Uri,
        node_cell: String,
        location: Location,
        detail: String,
    ) -> Self {
        Self {
            rule,
            severity: rule.severity(),
            subject,
            node_cell,
            location,
            detail,
            evidence: Vec::new(),
        }
    }

    fn with_evidence(mut self, evidence: Vec<Uuid>) -> Self {
        self.evidence = evidence;
        self
    }
}

/// What one lint run found, and what it looked at.
///
/// The counts are here so an assertion can state what was linted rather than
/// only that a function returned. A duration budget asserted against a report
/// that walked nothing is a test that cannot fail.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LintReport {
    /// Every violation, errors before warnings, per PRD section 12.14.
    pub findings: Vec<Finding>,
    /// How many nodes the run walked.
    pub nodes: usize,
    /// How many edges the run walked, superseded ones included.
    pub edges: usize,
    /// How many screens the run walked.
    pub screens: usize,
    /// How many decisions the run walked.
    pub decisions: usize,
    /// How many rules ran. Always [`RULE_COUNT`], and reported rather than
    /// assumed, because a rule that quietly stops being dispatched is exactly
    /// the regression a count catches.
    pub rules: usize,
}

impl LintReport {
    /// How many findings are errors.
    #[must_use]
    pub fn errors(&self) -> usize {
        self.findings
            .iter()
            .filter(|f| f.severity == Severity::Error)
            .count()
    }

    /// How many findings are warnings.
    #[must_use]
    pub fn warnings(&self) -> usize {
        self.findings
            .iter()
            .filter(|f| f.severity == Severity::Warning)
            .count()
    }

    /// Every finding of one rule, in the order the panel draws them.
    pub fn of(&self, rule: RuleId) -> impl Iterator<Item = &Finding> {
        self.findings.iter().filter(move |f| f.rule == rule)
    }
}

/// Run every rule of PRD section 10.4 over a loaded graph.
///
/// Findings come back sorted: errors above warnings, then by rule code, then
/// by the drawn `NODE` cell, so a rerun over an unchanged graph draws the same
/// rows in the same order.
#[must_use]
pub fn lint(graph: &Graph) -> LintReport {
    let scan = Scan::new(graph);
    let mut findings = Vec::new();
    for row in &CATALOG {
        (row.run)(&scan, &mut findings);
    }
    findings.sort_by(|a, b| {
        rank(a.severity)
            .cmp(&rank(b.severity))
            .then_with(|| a.rule.code().cmp(b.rule.code()))
            .then_with(|| a.node_cell.cmp(&b.node_cell))
            .then_with(|| a.subject.id.cmp(&b.subject.id))
    });
    LintReport {
        findings,
        nodes: graph.node_count(),
        edges: graph.edge_count(),
        screens: graph.screens().count(),
        decisions: graph.decisions().count(),
        rules: CATALOG.len(),
    }
}

/// Errors above warnings, warnings above anything held for review.
fn rank(severity: Severity) -> u8 {
    match severity {
        Severity::Error => 0,
        Severity::Warning => 1,
        Severity::Review => 2,
    }
}

/// The graph plus the indexes every rule would otherwise rebuild.
///
/// Thirteen rules each walking every edge is thirteen passes over the one
/// collection that grows fastest. The indexes below are built once, which is
/// what keeps the stress fixture inside its budget with room to spare.
struct Scan<'g> {
    graph: &'g Graph,
    live: Vec<&'g Edge>,
    dependencies: HashMap<Uuid, Vec<Uuid>>,
    inbound_covers: HashMap<Uuid, usize>,
    contains_sources: HashMap<Uuid, BTreeSet<Uuid>>,
    ui_edges_by_module: HashMap<Uuid, BTreeSet<Uuid>>,
    ui_edges_by_screen: HashMap<Uuid, usize>,
    test_cases_by_parent: HashMap<Uuid, usize>,
}

impl<'g> Scan<'g> {
    fn new(graph: &'g Graph) -> Self {
        let live: Vec<&Edge> = graph.edges().filter(|e| e.is_live()).collect();
        let mut dependencies: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        let mut inbound_covers: HashMap<Uuid, usize> = HashMap::new();
        let mut contains_sources: HashMap<Uuid, BTreeSet<Uuid>> = HashMap::new();
        let mut ui_edges_by_module: HashMap<Uuid, BTreeSet<Uuid>> = HashMap::new();
        let mut ui_edges_by_screen: HashMap<Uuid, usize> = HashMap::new();

        for edge in &live {
            match edge.kind {
                EdgeKind::DependsOn => {
                    dependencies
                        .entry(edge.source)
                        .or_default()
                        .push(edge.target);
                }
                EdgeKind::Covers => {
                    *inbound_covers.entry(edge.target).or_default() += 1;
                }
                EdgeKind::Contains => {
                    contains_sources
                        .entry(edge.target)
                        .or_default()
                        .insert(edge.source);
                }
                EdgeKind::ReferencesUi => {
                    ui_edges_by_module
                        .entry(edge.source)
                        .or_default()
                        .insert(edge.target);
                    *ui_edges_by_screen.entry(edge.target).or_default() += 1;
                }
                EdgeKind::Implements | EdgeKind::Satisfies | EdgeKind::Documents => {}
            }
        }
        for list in dependencies.values_mut() {
            list.sort_unstable();
            list.dedup();
        }

        let mut test_cases_by_parent: HashMap<Uuid, usize> = HashMap::new();
        for node in graph.nodes() {
            if *node.kind() == NodeKind::TestCase {
                if let Some(parent) = node.envelope.parent {
                    *test_cases_by_parent.entry(parent).or_default() += 1;
                }
            }
        }

        Self {
            graph,
            live,
            dependencies,
            inbound_covers,
            contains_sources,
            ui_edges_by_module,
            ui_edges_by_screen,
            test_cases_by_parent,
        }
    }

    fn slug(&self, id: Uuid) -> String {
        self.graph
            .node(id)
            .map_or_else(|| id.to_string(), |n| n.envelope.slug.as_str().to_owned())
    }

    fn title(&self, id: Uuid) -> String {
        self.graph
            .node(id)
            .map_or_else(|| id.to_string(), |n| n.envelope.title.clone())
    }

    fn depends_on(&self, id: Uuid) -> &[Uuid] {
        self.dependencies.get(&id).map_or(&[], Vec::as_slice)
    }

    /// The nearest service at or above a node.
    fn owning_service(&self, id: Uuid) -> Option<Uuid> {
        let node = self.graph.node(id)?;
        if *node.kind() == NodeKind::Service {
            return Some(id);
        }
        self.graph
            .ancestors(id)
            .into_iter()
            .find(|a| self.is_kind(*a, &NodeKind::Service))
    }

    fn is_kind(&self, id: Uuid, kind: &NodeKind) -> bool {
        self.graph.node(id).is_some_and(|n| n.kind() == kind)
    }

    /// Which surface PRD section 12.14 draws this node on.
    ///
    /// A facet is drawn on its module's Module Schematic, a module on its
    /// service's Service Schematic, and a service on the Stack. An annotation
    /// node anchored to a service has no module above it, so it falls through
    /// to the Service Schematic, which is where the wireframe draws the
    /// `Two caches here` comment.
    fn location(&self, id: Uuid) -> Location {
        let Some(node) = self.graph.node(id) else {
            return Location::Stack;
        };
        if *node.kind() == NodeKind::Service {
            return Location::Stack;
        }
        if node.kind().is_facet() {
            if let Some(module) = self.graph.module_root(id) {
                if module != id {
                    return Location::Module {
                        id: module,
                        title: self.title(module),
                    };
                }
            }
        }
        self.owning_service(id)
            .map_or(Location::Stack, |service| Location::Service {
                id: service,
                title: self.title(service),
            })
    }

    /// The `NODE` cell for a facet: `token-issuer.mint`, `token-verifier · cold_start_p95`.
    fn qualified(&self, facet: Uuid, member: &str, separator: &str) -> String {
        match self.graph.module_root(facet) {
            Some(module) if module != facet => {
                format!("{}{separator}{member}", self.slug(module))
            }
            _ => member.to_owned(),
        }
    }
}

/// Clip a body at a word boundary and mark the clip, as the `NODE` cell does.
fn clipped(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut kept = String::new();
    for word in text.split_whitespace() {
        let candidate = if kept.is_empty() {
            word.to_owned()
        } else {
            format!("{kept} {word}")
        };
        if candidate.chars().count() > max {
            break;
        }
        kept = candidate;
    }
    if kept.is_empty() {
        kept = text.chars().take(max).collect();
    }
    format!("{kept}…")
}

/// Draw a path of nodes the way the `NODE` cell draws a cycle.
fn path_cell(scan: &Scan<'_>, path: &[Uuid]) -> String {
    let drawn: Vec<String> = path.iter().take(2).map(|id| scan.slug(*id)).collect();
    format!("{} → …", drawn.join(" → "))
}

// ---------------------------------------------------------------------------
// L01. Containment graph is a tree.
// ---------------------------------------------------------------------------

/// Two ways a containment graph stops being a tree, and both are this rule.
///
/// A second parent is the one PRD section 10.4 names. It is reachable even
/// though [`crate::NodeEnvelope::parent`] holds one value, because a hand
/// written `contains` edge is a second claim on the same child: PRD section
/// 5.6 has the kind in the vocabulary and [`Edge::is_stored`] is the only
/// thing that normally keeps it off disk. A cycle in the `parent` chain is
/// the other, and a graph where a node contains its own container is not a
/// tree by any reading of the heading.
fn containment_is_a_tree(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for node in scan.graph.nodes() {
        let mut parents: BTreeSet<Uuid> = BTreeSet::new();
        if let Some(parent) = node.envelope.parent {
            parents.insert(parent);
        }
        if let Some(claimed) = scan.contains_sources.get(&node.id()) {
            parents.extend(claimed.iter().copied());
        }
        if parents.len() < 2 {
            continue;
        }
        let drawn: Vec<String> = parents.iter().map(|p| scan.slug(*p)).collect();
        out.push(
            Finding::new(
                RuleId::L01,
                Uri::node(node.id()),
                scan.slug(node.id()),
                scan.location(node.id()),
                format!(
                    "{} is contained by {} parents: {}.",
                    scan.slug(node.id()),
                    parents.len(),
                    drawn.join(", ")
                ),
            )
            .with_evidence(parents.into_iter().collect()),
        );
    }

    for cycle in containment_cycles(scan.graph) {
        let Some(anchor) = cycle.first().copied() else {
            continue;
        };
        let drawn: Vec<String> = cycle.iter().map(|id| scan.slug(*id)).collect();
        out.push(
            Finding::new(
                RuleId::L01,
                Uri::node(anchor),
                path_cell(scan, &cycle),
                scan.location(anchor),
                format!(
                    "The containment chain closes on itself: {}.",
                    drawn.join(" → ")
                ),
            )
            .with_evidence(cycle),
        );
    }
}

/// Every cycle in the `parent` chain, each reported once.
fn containment_cycles(graph: &Graph) -> Vec<Vec<Uuid>> {
    let mut settled: HashSet<Uuid> = HashSet::new();
    let mut anchors: HashSet<Uuid> = HashSet::new();
    let mut cycles: Vec<Vec<Uuid>> = Vec::new();

    for node in graph.nodes() {
        let mut path: Vec<Uuid> = Vec::new();
        let mut on_path: HashSet<Uuid> = HashSet::new();
        let mut current = Some(node.id());
        while let Some(at) = current {
            if settled.contains(&at) {
                break;
            }
            if !on_path.insert(at) {
                if let Some(start) = path.iter().position(|n| *n == at) {
                    let mut cycle = path[start..].to_vec();
                    rotate_to_lowest_slug(graph, &mut cycle);
                    if let Some(anchor) = cycle.first().copied() {
                        if anchors.insert(anchor) {
                            cycles.push(cycle);
                        }
                    }
                }
                break;
            }
            path.push(at);
            current = graph.node(at).and_then(|n| n.envelope.parent);
        }
        settled.extend(path);
    }
    cycles
}

/// Rotate a cycle so the member with the lowest slug leads.
///
/// A cycle has no first member, so one has to be chosen or the drawn cell
/// changes with the order the loader happened to read files in. The lowest
/// slug is the choice, and it is what draws `session-codec → token-issuer → …`
/// for the wireframe fixture.
fn rotate_to_lowest_slug(graph: &Graph, cycle: &mut [Uuid]) {
    let lead = cycle
        .iter()
        .enumerate()
        .min_by_key(|(_, id)| {
            graph
                .node(**id)
                .map_or_else(|| id.to_string(), |n| n.envelope.slug.as_str().to_owned())
        })
        .map(|(index, _)| index);
    if let Some(index) = lead {
        cycle.rotate_left(index);
    }
}

// ---------------------------------------------------------------------------
// L02. Dependency graph is acyclic.
// ---------------------------------------------------------------------------

/// One finding per dependency cycle, drawn from the member with the lowest
/// slug so the row is stable across loads.
fn dependency_is_acyclic(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for component in strongly_connected(scan) {
        let mut members: Vec<Uuid> = component.iter().copied().collect();
        members.sort_unstable();
        rotate_to_lowest_slug(scan.graph, &mut members);
        let Some(start) = members.first().copied() else {
            continue;
        };
        let path = shortest_cycle(scan, &component, start);
        if path.is_empty() {
            continue;
        }
        let drawn: Vec<String> = path.iter().map(|id| scan.slug(*id)).collect();
        out.push(
            Finding::new(
                RuleId::L02,
                Uri::node(start),
                path_cell(scan, &path),
                scan.location(start),
                format!(
                    "The dependency chain closes on itself: {} → {}.",
                    drawn.join(" → "),
                    scan.slug(start)
                ),
            )
            .with_evidence(path),
        );
    }
}

/// Every strongly connected component that holds a cycle.
///
/// Kosaraju rather than Tarjan, and iterative rather than recursive: the
/// stress fixture is 2000 nodes and a dependency chain built by a generator
/// can be arbitrarily long, so the walk keeps its own stack.
fn strongly_connected(scan: &Scan<'_>) -> Vec<HashSet<Uuid>> {
    let ids: Vec<Uuid> = scan.graph.nodes().map(Node::id).collect();
    let mut order: Vec<Uuid> = Vec::with_capacity(ids.len());
    let mut visited: HashSet<Uuid> = HashSet::new();

    for start in &ids {
        if visited.contains(start) {
            continue;
        }
        visited.insert(*start);
        let mut stack = vec![(*start, 0usize)];
        while let Some((at, index)) = stack.pop() {
            let next = scan.depends_on(at);
            if index < next.len() {
                stack.push((at, index + 1));
                let child = next[index];
                if visited.insert(child) {
                    stack.push((child, 0));
                }
            } else {
                order.push(at);
            }
        }
    }

    let mut reverse: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (source, targets) in &scan.dependencies {
        for target in targets {
            reverse.entry(*target).or_default().push(*source);
        }
    }

    let mut assigned: HashSet<Uuid> = HashSet::new();
    let mut components: Vec<HashSet<Uuid>> = Vec::new();
    for start in order.iter().rev() {
        if assigned.contains(start) {
            continue;
        }
        let mut component: HashSet<Uuid> = HashSet::new();
        let mut queue = vec![*start];
        assigned.insert(*start);
        component.insert(*start);
        while let Some(at) = queue.pop() {
            for previous in reverse.get(&at).map_or(&[][..], Vec::as_slice) {
                if assigned.insert(*previous) {
                    component.insert(*previous);
                    queue.push(*previous);
                }
            }
        }
        let self_loop = component.len() == 1 && scan.depends_on(*start).contains(start);
        if component.len() > 1 || self_loop {
            components.push(component);
        }
    }
    components.sort_by_key(|c| c.iter().copied().min());
    components
}

/// The shortest cycle through `start` inside one component.
fn shortest_cycle(scan: &Scan<'_>, component: &HashSet<Uuid>, start: Uuid) -> Vec<Uuid> {
    if scan.depends_on(start).contains(&start) {
        return vec![start];
    }
    let mut previous: HashMap<Uuid, Uuid> = HashMap::new();
    let mut queue: VecDeque<Uuid> = VecDeque::new();
    let mut closing: Option<Uuid> = None;

    for first in scan.depends_on(start) {
        if component.contains(first) && previous.insert(*first, start).is_none() {
            queue.push_back(*first);
        }
    }
    'search: while let Some(at) = queue.pop_front() {
        for next in scan.depends_on(at) {
            if !component.contains(next) {
                continue;
            }
            if *next == start {
                closing = Some(at);
                break 'search;
            }
            if previous.insert(*next, at).is_none() {
                queue.push_back(*next);
            }
        }
    }

    let mut path = Vec::new();
    let mut at = closing;
    while let Some(node) = at {
        path.push(node);
        if node == start {
            break;
        }
        at = previous.get(&node).copied();
    }
    path.reverse();
    path
}

// ---------------------------------------------------------------------------
// L03 to L05.
// ---------------------------------------------------------------------------

/// A budget with no probe is an unmeasurable claim, which PRD section 8 makes
/// an error rather than a warning.
fn budget_without_a_probe(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for id in scan.graph.nodes_of_kind(&NodeKind::Budget) {
        let Some(node) = scan.graph.node(id) else {
            continue;
        };
        let Ok(budget) = node.budget() else {
            continue;
        };
        if budget.probe.is_some() {
            continue;
        }
        out.push(Finding::new(
            RuleId::L03,
            Uri::node(id),
            scan.qualified(id, &budget.metric, " · "),
            scan.location(id),
            format!(
                "{} declares {} {} {} with no probe command.",
                scan.slug(id),
                budget.metric,
                budget.op,
                budget.value
            ),
        ));
    }
}

/// A module may whitelist a library the registry holds, and no other.
fn library_absent_from_registry(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for id in scan.graph.nodes_of_kind(&NodeKind::Module) {
        let Some(node) = scan.graph.node(id) else {
            continue;
        };
        let Ok(module) = node.module() else {
            continue;
        };
        for library in &module.allowed_libraries {
            if scan.graph.libraries().contains(*library) {
                continue;
            }
            out.push(
                Finding::new(
                    RuleId::L04,
                    Uri::node(id),
                    format!("{} · {library}", scan.slug(id)),
                    scan.location(id),
                    format!(
                        "{} whitelists {library}, which the library registry does not hold.",
                        scan.slug(id)
                    ),
                )
                .with_evidence(vec![*library]),
            );
        }
    }
}

/// PRD section 11.3: an annotation node refuses every semantic edge.
fn annotation_carrying_a_semantic_edge(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for edge in &scan.live {
        if !edge.kind.is_semantic() {
            continue;
        }
        for end in [edge.source, edge.target] {
            let Some(node) = scan.graph.node(end) else {
                continue;
            };
            if !node.kind().is_annotation() {
                continue;
            }
            let body = node
                .comment()
                .map_or_else(|_| node.envelope.title.clone(), |c| c.body);
            out.push(
                Finding::new(
                    RuleId::L05,
                    Uri::node(end),
                    format!(
                        "{} \"{}\"",
                        node.kind().as_str(),
                        clipped(&body, CELL_WIDTH)
                    ),
                    scan.location(end),
                    format!(
                        "{} is annotation tier and carries a {} edge.",
                        scan.slug(end),
                        edge.kind
                    ),
                )
                .with_evidence(vec![edge.id]),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// L06. Dangling references.
// ---------------------------------------------------------------------------

/// Every reference in the graph, checked against what it points at.
///
/// Layout placements are deliberately outside this rule. A placement for a
/// node that is no longer drawn is a stale cache the layout writer prunes,
/// not a reference a reader would follow, and reporting one as a graph error
/// would put a row in the Problems panel that no Schematic can navigate to.
fn dangling_reference(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    let mut report = |owner: Uri, owner_id: Uuid, field: &str, missing: String| {
        let cell = if scan.graph.node(owner_id).is_some() {
            format!("{} · {field}", scan.slug(owner_id))
        } else {
            format!("{owner} · {field}")
        };
        out.push(Finding::new(
            RuleId::L06,
            owner,
            cell,
            scan.location(owner_id),
            format!("{field} points at {missing}, which nothing in the project holds."),
        ));
    };

    for node in scan.graph.nodes() {
        let id = node.id();
        let uri = Uri::node(id);
        for (field, target) in [
            ("parent", node.envelope.parent),
            ("superseded_by", node.envelope.superseded_by),
        ] {
            if let Some(target) = target {
                if scan.graph.node(target).is_none() {
                    report(uri, id, field, target.to_string());
                }
            }
        }
        if let Some(stale) = node.envelope.stale.as_ref() {
            if scan.graph.node(stale.source).is_none() {
                report(uri, id, "stale.source", stale.source.to_string());
            }
        }
        for decision in &node.envelope.decisions {
            if !resolves(scan, decision) {
                report(uri, id, "decisions", decision.to_string());
            }
        }
        dangling_in_fields(scan, node, &mut report);
    }

    for edge in &scan.live {
        let uri = Uri::node(edge.source);
        if scan.graph.node(edge.source).is_none() {
            report(uri, edge.source, "edge.source", edge.source.to_string());
        }
        let target_exists = if edge.kind == EdgeKind::ReferencesUi {
            scan.graph.screen(edge.target).is_some()
        } else {
            scan.graph.node(edge.target).is_some()
        };
        if !target_exists {
            report(uri, edge.source, "edge.target", edge.target.to_string());
        }
    }

    for screen in scan.graph.screens() {
        for backing in &screen.backed_by {
            if !resolves(scan, backing) {
                report(
                    Uri::screen(screen.id),
                    screen.id,
                    "backed_by",
                    backing.to_string(),
                );
            }
        }
    }
    for flow in scan.graph.flows() {
        for step in &flow.steps {
            if !resolves(scan, &step.screen) {
                report(
                    Uri::flow(flow.id),
                    flow.id,
                    "steps",
                    step.screen.to_string(),
                );
            }
        }
    }
    for decision in scan.graph.decisions() {
        for (field, target) in [
            ("supersedes", decision.supersedes),
            ("superseded_by", decision.superseded_by),
        ] {
            if let Some(target) = target {
                if scan.graph.decision(target).is_none() {
                    report(
                        Uri::decision(decision.id),
                        decision.id,
                        field,
                        target.to_string(),
                    );
                }
            }
        }
    }
}

/// The references that live in a node's typed fields rather than its envelope.
fn dangling_in_fields(
    scan: &Scan<'_>,
    node: &Node,
    report: &mut impl FnMut(Uri, Uuid, &str, String),
) {
    let id = node.id();
    let uri = Uri::node(id);
    match node.kind() {
        NodeKind::Service => {
            if let Ok(service) = node.service() {
                for export in &service.exports {
                    if scan.graph.node(*export).is_none() {
                        report(uri, id, "exports", export.to_string());
                    }
                }
            }
        }
        NodeKind::Module => {
            if let Ok(module) = node.module() {
                for reference in &module.ui_refs {
                    if !resolves(scan, reference) {
                        report(uri, id, "ui_refs", reference.to_string());
                    }
                }
            }
        }
        NodeKind::ExternalDep => {
            if let Ok(dep) = node.external_dep() {
                if !scan.graph.libraries().contains(dep.registry_ref) {
                    report(uri, id, "registry_ref", dep.registry_ref.to_string());
                }
            }
        }
        NodeKind::Comment => {
            if let Ok(comment) = node.comment() {
                if let Some(anchor) = comment.anchor {
                    if scan.graph.node(anchor).is_none() {
                        report(uri, id, "anchor", anchor.to_string());
                    }
                }
            }
        }
        NodeKind::Group => {
            if let Ok(group) = node.group() {
                for member in &group.members {
                    if scan.graph.node(*member).is_none() {
                        report(uri, id, "members", member.to_string());
                    }
                }
            }
        }
        NodeKind::ContractMethod
        | NodeKind::TestCase
        | NodeKind::Budget
        | NodeKind::DocBlock
        | NodeKind::Custom(_) => {}
    }
}

/// Whether a `schematify://` reference finds what it names.
fn resolves(scan: &Scan<'_>, uri: &Uri) -> bool {
    match uri.kind {
        UriKind::Node => scan.graph.node(uri.id).is_some(),
        UriKind::Screen => scan.graph.screen(uri.id).is_some(),
        UriKind::Flow => scan.graph.flow(uri.id).is_some(),
        UriKind::Decision => scan.graph.decision(uri.id).is_some(),
    }
}

// ---------------------------------------------------------------------------
// L07 to L09.
// ---------------------------------------------------------------------------

/// A superseded decision that names no successor is a dead end: it says the
/// reasoning was replaced and gives a reader nowhere to go.
fn superseded_decision_without_successor(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for decision in scan.graph.decisions() {
        if !decision.is_superseded_without_successor() {
            continue;
        }
        out.push(Finding::new(
            RuleId::L07,
            Uri::decision(decision.id),
            decision.slug.as_str().to_owned(),
            Location::DecisionLog,
            format!(
                "{} is marked superseded and names no successor.",
                decision.slug.as_str()
            ),
        ));
    }
}

/// PRD section 5.11 makes the `references_ui` edge authoritative and the
/// `ui_refs` array a cache written from it, so a difference is an error.
fn ui_refs_cache_mismatch(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for id in scan.graph.nodes_of_kind(&NodeKind::Module) {
        let Some(node) = scan.graph.node(id) else {
            continue;
        };
        let Ok(module) = node.module() else {
            continue;
        };
        let cached: BTreeSet<Uuid> = module.ui_refs.iter().map(|u| u.id).collect();
        let empty = BTreeSet::new();
        let drawn = scan.ui_edges_by_module.get(&id).unwrap_or(&empty);
        if cached == *drawn {
            continue;
        }
        out.push(Finding::new(
            RuleId::L08,
            Uri::node(id),
            scan.slug(id),
            scan.location(id),
            format!(
                "{} caches {} screen references against {} references_ui edges.",
                scan.slug(id),
                cached.len(),
                drawn.len()
            ),
        ));
    }
}

/// A dependency that crosses a service boundary lands on the published
/// contract or it lands on an internal, and the second is the error.
fn cross_service_call_to_unexported(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for edge in &scan.live {
        if !matches!(edge.kind, EdgeKind::DependsOn | EdgeKind::Implements) {
            continue;
        }
        let Some(target) = scan.graph.node(edge.target) else {
            continue;
        };
        if *target.kind() != NodeKind::ContractMethod {
            continue;
        }
        let Ok(method) = target.contract_method() else {
            continue;
        };
        if method.exported {
            continue;
        }
        let across = scan.owning_service(edge.source) != scan.owning_service(edge.target);
        if !across {
            continue;
        }
        out.push(
            Finding::new(
                RuleId::L09,
                Uri::node(edge.target),
                scan.qualified(edge.target, &target.envelope.title, "."),
                scan.location(edge.target),
                format!(
                    "{} reaches {} across a service boundary, and the method is not exported.",
                    scan.slug(edge.source),
                    scan.slug(edge.target)
                ),
            )
            .with_evidence(vec![edge.id]),
        );
    }
}

// ---------------------------------------------------------------------------
// L10 to L13.
// ---------------------------------------------------------------------------

/// PRD section 4.3 puts a shared node at the lowest common ancestor of its
/// dependents, and section 10.4 fires this rule on one drawn above it.
///
/// Above alone, deliberately. A node drawn below its lowest common ancestor
/// is a different fault with a different fix, and PRD section 10.4 names only
/// the one. Reporting both under one heading would draw a row whose rule text
/// contradicts what the reader is looking at.
fn shared_node_above_the_lca(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for node in scan.graph.nodes() {
        let id = node.id();
        let Some(expected) = scan.graph.shared_node_parent(id) else {
            continue;
        };
        let actual = node.envelope.parent;
        if actual == expected {
            continue;
        }
        let Some(expected_id) = expected else {
            continue;
        };
        let above = match actual {
            None => true,
            Some(parent) => scan.graph.ancestors(expected_id).contains(&parent),
        };
        if !above {
            continue;
        }
        let dependents = scan.graph.dependents(id);
        out.push(
            Finding::new(
                RuleId::L10,
                Uri::node(id),
                scan.slug(id),
                scan.location(id),
                format!(
                    "{} has {} dependents whose lowest common ancestor is {}, and sits above it.",
                    scan.slug(id),
                    dependents.len(),
                    scan.slug(expected_id)
                ),
            )
            .with_evidence(dependents),
        );
    }
}

/// A contract method with no covers edge has no coverage of design.
///
/// Scoped to a module that declares at least one test case. A module with no
/// declared test is not under-covered in one method, it is untested as a
/// whole, and that is what the lifecycle gate of PRD section 7.2 is for:
/// nothing reaches `implemented` without its declared tests linked. Firing
/// here on every method of every untested module would bury the one method
/// somebody genuinely missed under a list nobody reads.
fn contract_method_without_covers(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for id in scan.graph.nodes_of_kind(&NodeKind::ContractMethod) {
        let Some(node) = scan.graph.node(id) else {
            continue;
        };
        let Some(module) = scan.graph.module_root(id) else {
            continue;
        };
        if scan.test_cases_by_parent.get(&module).copied().unwrap_or(0) == 0 {
            continue;
        }
        if scan.inbound_covers.get(&id).copied().unwrap_or(0) > 0 {
            continue;
        }
        out.push(Finding::new(
            RuleId::L11,
            Uri::node(id),
            scan.qualified(id, &node.envelope.title, "."),
            scan.location(id),
            format!(
                "{} declares test cases and none of them covers {}.",
                scan.slug(module),
                node.envelope.title
            ),
        ));
    }
}

/// A live node pointing at a deprecated one, where nobody has acknowledged it.
///
/// Acknowledgement is the referring node having moved off the live path
/// itself: a node that is `deprecated` or `stale` has already been marked as
/// needing attention, and a second row saying so adds nothing.
fn reference_to_a_deprecated_node(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for edge in &scan.live {
        let (Some(source), Some(target)) =
            (scan.graph.node(edge.source), scan.graph.node(edge.target))
        else {
            continue;
        };
        if target.envelope.lifecycle != Lifecycle::Deprecated {
            continue;
        }
        if matches!(
            source.envelope.lifecycle,
            Lifecycle::Deprecated | Lifecycle::Stale
        ) {
            continue;
        }
        out.push(
            Finding::new(
                RuleId::L12,
                Uri::node(edge.source),
                format!("{} → {}", scan.slug(edge.source), scan.slug(edge.target)),
                scan.location(edge.source),
                format!(
                    "{} is {} and holds a {} edge to {}, which is deprecated.",
                    scan.slug(edge.source),
                    source.envelope.lifecycle,
                    edge.kind,
                    scan.slug(edge.target)
                ),
            )
            .with_evidence(vec![edge.id]),
        );
    }
}

/// A screen nothing backs is a product surface with no module behind it.
fn screen_without_a_backing_module(scan: &Scan<'_>, out: &mut Vec<Finding>) {
    for screen in scan.graph.screens() {
        if scan
            .ui_edges_by_screen
            .get(&screen.id)
            .copied()
            .unwrap_or(0)
            > 0
        {
            continue;
        }
        out.push(Finding::new(
            RuleId::L13,
            Uri::screen(screen.id),
            screen.slug.as_str().to_owned(),
            Location::Product,
            format!(
                "{} holds no inbound references_ui edge, so no module backs it.",
                screen.slug.as_str()
            ),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::{Authorship, NodeEnvelope};
    use crate::product::{Screen, ScreenKind};
    use crate::slug::Slug;

    fn node(id: u128, slug: &str, kind: NodeKind, parent: Option<u128>) -> Node {
        Node::new(NodeEnvelope {
            id: Uuid::from_u128(id),
            slug: Slug::new(slug).unwrap(),
            kind,
            title: slug.to_owned(),
            description: None,
            lifecycle: Lifecycle::Specified,
            layer: None,
            parent: parent.map(Uuid::from_u128),
            decisions: Vec::new(),
            authored_by: Authorship::Human,
            created: "2026-08-25T00:00:00Z".to_owned(),
            superseded_by: None,
            stale: None,
        })
    }

    fn edge(id: u128, kind: EdgeKind, source: u128, target: u128) -> Edge {
        Edge::new(
            Uuid::from_u128(id),
            kind,
            Uuid::from_u128(source),
            Uuid::from_u128(target),
            "2026-08-25T00:00:00Z",
        )
    }

    #[test]
    fn every_rule_resolves_to_its_own_row() {
        assert_eq!(CATALOG.len(), RULE_COUNT);
        assert_eq!(RuleId::all().len(), RULE_COUNT);
        for row in &CATALOG {
            assert_eq!(row.id.name(), row.name, "{}", row.id.code());
            assert_eq!(row.id.severity(), row.severity, "{}", row.id.code());
        }
        let codes: Vec<&str> = RuleId::all().iter().map(|r| r.code()).collect();
        assert_eq!(codes.first().copied(), Some("L01"));
        assert_eq!(codes.last().copied(), Some("L13"));
        let unique: BTreeSet<&str> = codes.iter().copied().collect();
        assert_eq!(unique.len(), RULE_COUNT, "codes are unique");
    }

    #[test]
    fn a_lint_run_reports_how_many_rules_it_dispatched() {
        let report = lint(&Graph::new());
        assert_eq!(report.rules, RULE_COUNT);
        assert_eq!(report.nodes, 0);
        assert!(report.findings.is_empty());
    }

    #[test]
    fn errors_sort_above_warnings_whatever_order_the_rules_ran_in() {
        let mut graph = Graph::new();
        // One L10 warning and one L03 error, so the sort has both to order.
        graph.insert_node(node(1, "auth-service", NodeKind::Service, None));
        graph.insert_node(node(2, "token-verifier", NodeKind::Module, Some(1)));
        graph.insert_node(node(3, "jwks-cache", NodeKind::Module, Some(2)));
        graph.insert_node(node(4, "clock-skew", NodeKind::Module, Some(2)));
        graph.insert_node(node(5, "crypto-primitives", NodeKind::Module, Some(1)));
        graph.insert_node(
            node(6, "cold-start-p95", NodeKind::Budget, Some(2))
                .with_fields(&serde_json::json!({
                    "metric": "cold_start_p95",
                    "op": "<",
                    "value": 800.0,
                    "unit": "ms",
                    "tier": "hard",
                }))
                .unwrap(),
        );
        graph.insert_edge(edge(100, EdgeKind::DependsOn, 3, 5));
        graph.insert_edge(edge(101, EdgeKind::DependsOn, 4, 5));
        graph.reindex();

        let report = lint(&graph);
        assert_eq!(report.errors(), 1);
        assert_eq!(report.warnings(), 1);
        assert_eq!(report.findings[0].rule, RuleId::L03);
        assert_eq!(report.findings[1].rule, RuleId::L10);
        assert_eq!(
            report.findings[0].node_cell,
            "token-verifier · cold_start_p95"
        );
        assert_eq!(report.findings[0].location.cell(), "› token-verifier");
        assert_eq!(report.findings[1].node_cell, "crypto-primitives");
        assert_eq!(report.findings[1].location.cell(), "Stack › auth-service");
    }

    #[test]
    fn a_shared_node_below_its_lca_is_not_this_rule() {
        let mut graph = Graph::new();
        graph.insert_node(node(1, "auth-service", NodeKind::Service, None));
        graph.insert_node(node(2, "token-verifier", NodeKind::Module, Some(1)));
        graph.insert_node(node(3, "http-entry", NodeKind::Module, Some(1)));
        graph.insert_node(node(4, "audit-emitter", NodeKind::Module, Some(1)));
        // Two dependents whose LCA is the service, and the shared node buried
        // one level below it.
        graph.insert_node(node(5, "crypto-primitives", NodeKind::Module, Some(2)));
        graph.insert_edge(edge(100, EdgeKind::DependsOn, 3, 5));
        graph.insert_edge(edge(101, EdgeKind::DependsOn, 4, 5));
        graph.reindex();

        let report = lint(&graph);
        assert!(!graph.shared_node_is_at_lca(Uuid::from_u128(5)));
        assert_eq!(report.of(RuleId::L10).count(), 0, "below is not above");
    }

    #[test]
    fn a_second_parent_and_a_containment_cycle_are_both_l01() {
        let mut graph = Graph::new();
        graph.insert_node(node(1, "a", NodeKind::Module, None));
        graph.insert_node(node(2, "b", NodeKind::Module, None));
        graph.insert_node(node(3, "c", NodeKind::Module, Some(1)));
        // A hand-written contains edge is the second claim on `c`.
        graph.insert_edge(edge(100, EdgeKind::Contains, 2, 3));
        graph.insert_node(node(4, "d", NodeKind::Module, Some(5)));
        graph.insert_node(node(5, "e", NodeKind::Module, Some(4)));
        graph.reindex();

        let report = lint(&graph);
        let cells: Vec<&str> = report
            .of(RuleId::L01)
            .map(|f| f.node_cell.as_str())
            .collect();
        assert_eq!(cells, ["c", "d → e → …"]);
        assert!(report
            .of(RuleId::L01)
            .all(|f| f.severity == Severity::Error));
    }

    #[test]
    fn a_dependency_cycle_draws_from_the_lowest_slug_whatever_order_it_was_read_in() {
        let mut graph = Graph::new();
        graph.insert_node(node(3, "session-store", NodeKind::Module, None));
        graph.insert_node(node(1, "session-codec", NodeKind::Module, None));
        graph.insert_node(node(2, "token-issuer", NodeKind::Module, None));
        graph.insert_edge(edge(100, EdgeKind::DependsOn, 1, 2));
        graph.insert_edge(edge(101, EdgeKind::DependsOn, 2, 3));
        graph.insert_edge(edge(102, EdgeKind::DependsOn, 3, 1));
        graph.reindex();

        let report = lint(&graph);
        let found: Vec<&Finding> = report.of(RuleId::L02).collect();
        assert_eq!(found.len(), 1, "one cycle, one row");
        assert_eq!(found[0].node_cell, "session-codec → token-issuer → …");
        assert_eq!(found[0].evidence.len(), 3);
        assert_eq!(found[0].subject.id, Uuid::from_u128(1));
    }

    #[test]
    fn a_clipped_body_stops_on_a_word_and_says_it_stopped() {
        assert_eq!(
            clipped("Two caches here on purpose - the rest", 16),
            "Two caches here…"
        );
        assert_eq!(clipped("short", 16), "short");
        assert_eq!(clipped("unbrokenlongsingleword", 6), "unbrok…");
    }

    #[test]
    fn a_screen_with_no_backing_module_is_reported_on_the_product_surface() {
        let mut graph = Graph::new();
        graph.insert_screen(Screen {
            id: Uuid::from_u128(1),
            kind: ScreenKind::Screen,
            slug: Slug::new("login-form").unwrap(),
            title: "Login form".to_owned(),
            purpose: "Collects credentials.".to_owned(),
            states: Vec::new(),
            acceptance: Vec::new(),
            design_ref: None,
            backed_by: Vec::new(),
        });
        graph.reindex();

        let report = lint(&graph);
        let found: Vec<&Finding> = report.of(RuleId::L13).collect();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].location.cell(), "Product");
        assert_eq!(found[0].subject.kind, UriKind::Screen);
        assert_eq!(report.screens, 1);
    }
}
