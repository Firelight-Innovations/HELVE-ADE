//! The graph linter of PRD section 10.4, asserted against the reference
//! fixtures rather than against a graph built in memory.
//!
//! Two acceptance conditions of PRD section 17 wave 7 live here. The first is
//! the five Problems rows of section 16.1, asserted literally: the rule name,
//! the `NODE` cell and the `LOCATION` cell of every row, in the order the
//! panel draws them. The second is the 500 ms lint budget of section 14.7
//! against `fixtures/stress-2000/`.
//!
//! A duration assertion is worth nothing on its own, because a linter that
//! returned an empty report instantly would pass it. Every timing test here
//! states what went in and what came out first, and times second.

use std::path::PathBuf;
use std::time::Instant;

use schematify_core::{
    lint, load_project, Authorship, BudgetFields, BudgetTier, Lifecycle, Node, NodeEnvelope,
    NodeKind, RuleId, Severity, Slug, Uuid, RULE_COUNT,
};

fn fixture(name: &str) -> PathBuf {
    manifest_dir().join("fixtures").join(name)
}

/// `CARGO_MANIFEST_DIR`, preferring the value Cargo puts in the environment
/// of a test binary it launches over the one baked in at compile time.
///
/// Several worktrees sharing one `CARGO_TARGET_DIR` (a deliberate convention
/// for agents working this repo) hold identical sources, so Cargo can reuse
/// a test binary compiled in a worktree that has since been removed,
/// carrying that worktree's absolute path. Reading the environment first
/// avoids resolving fixtures against a directory that no longer exists; the
/// check below catches the rarer case where a stale binary somehow still
/// ran, and names the problem instead of leaving a bare `NotFound` for the
/// next agent to puzzle over.
fn manifest_dir() -> PathBuf {
    let dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| env!("CARGO_MANIFEST_DIR").to_string()),
    );
    assert!(
        dir.is_dir(),
        "CARGO_MANIFEST_DIR resolved to {}, which does not exist -- this looks like a \
         stale cross-worktree build (a test binary compiled in a worktree that has since \
         been removed and reused from a shared CARGO_TARGET_DIR); rerun `cargo test` from \
         this worktree to force a rebuild",
        dir.display()
    );
    dir
}

/// The Problems table of PRD section 16.1, row for row.
const WIREFRAME_ROWS: &[(Severity, &str, &str, &str)] = &[
    (
        Severity::Error,
        "Dependency graph is acyclic",
        "session-codec → token-issuer → …",
        "Stack › Auth Service",
    ),
    (
        Severity::Error,
        "Budget declared without a probe",
        "token-verifier · cold_start_p95",
        "› Token Verifier",
    ),
    (
        Severity::Error,
        "Annotation node carrying a semantic edge",
        "comment \"Two caches here…\"",
        "Stack › Auth Service",
    ),
    (
        Severity::Warning,
        "Shared node sits above the LCA of its dependents",
        "crypto-primitives",
        "Stack › Auth Service",
    ),
    (
        Severity::Warning,
        "Contract method with no covers edge",
        "token-issuer.mint",
        "› Token Issuer",
    ),
];

#[test]
fn the_wireframe_fixture_draws_the_five_rows_the_problems_panel_draws() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let report = lint(&outcome.graph);

    let drawn: Vec<(Severity, &str, &str, String)> = report
        .findings
        .iter()
        .map(|f| {
            (
                f.severity,
                f.rule.name(),
                f.node_cell.as_str(),
                f.location.cell(),
            )
        })
        .collect();
    let expected: Vec<(Severity, &str, &str, String)> = WIREFRAME_ROWS
        .iter()
        .map(|(severity, rule, node, location)| (*severity, *rule, *node, (*location).to_owned()))
        .collect();

    assert_eq!(drawn, expected, "the five rows of PRD section 16.1");
    assert_eq!(report.errors(), 3, "three errors");
    assert_eq!(report.warnings(), 2, "two warnings");
}

#[test]
fn errors_sort_above_warnings_in_the_wireframe_fixture() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let report = lint(&outcome.graph);

    let severities: Vec<Severity> = report.findings.iter().map(|f| f.severity).collect();
    assert_eq!(
        severities,
        [
            Severity::Error,
            Severity::Error,
            Severity::Error,
            Severity::Warning,
            Severity::Warning
        ],
        "a user never scrolls to discover that an error exists"
    );
    let first_warning = severities
        .iter()
        .position(|s| *s == Severity::Warning)
        .expect("the fixture holds a warning");
    assert!(
        severities[..first_warning]
            .iter()
            .all(|s| *s == Severity::Error),
        "nothing but errors above the first warning"
    );
}

#[test]
fn every_row_names_a_surface_and_something_on_it_to_select() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let report = lint(graph);

    assert_eq!(report.findings.len(), 5);
    for finding in &report.findings {
        assert!(
            graph.node(finding.subject.id).is_some(),
            "{} names a node the panel can select: {}",
            finding.rule.code(),
            finding.subject
        );
        if let Some(schematic) = finding.location.schematic() {
            assert!(
                graph.node(schematic).is_some(),
                "{} names a Schematic that exists",
                finding.rule.code()
            );
        }
        assert!(
            !finding.detail.is_empty(),
            "{} states its evidence",
            finding.rule.code()
        );
    }
}

#[test]
fn the_dependency_cycle_row_carries_the_whole_cycle_and_not_only_the_two_it_draws() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let report = lint(&outcome.graph);

    let cycle = report.of(RuleId::L02).next().expect("one cycle row");
    assert_eq!(cycle.node_cell, "session-codec → token-issuer → …");
    assert_eq!(
        cycle.evidence.len(),
        3,
        "the drawn cell clips at two and the finding keeps all three"
    );
    let slugs: Vec<&str> = cycle
        .evidence
        .iter()
        .filter_map(|id| outcome.graph.node(*id))
        .map(|n| n.envelope.slug.as_str())
        .collect();
    assert_eq!(slugs, ["session-codec", "token-issuer", "session-store"]);
}

#[test]
fn the_stress_fixture_lints_inside_the_wave_seven_budget() {
    let outcome = load_project(&fixture("stress-2000")).unwrap();
    let graph = &outcome.graph;

    // What went in. PRD section 16.3 sizes this fixture, and a duration
    // assertion against a graph that failed to load would pass on nothing.
    assert_eq!(graph.node_count(), 2000, "2000 nodes went in");
    assert_eq!(graph.edge_count(), 3000, "3000 edges went in");
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );

    let started = Instant::now();
    let report = lint(graph);
    let elapsed = started.elapsed();

    // What came out. The rule count is the guard against a rule quietly
    // leaving the dispatch table, and the finding count against a run that
    // walked the graph and looked at nothing.
    assert_eq!(report.rules, RULE_COUNT, "every rule ran");
    assert_eq!(report.nodes, 2000, "every node was linted");
    assert_eq!(report.edges, 3000, "every edge was linted");
    assert_eq!(
        report.findings.len(),
        STRESS_FINDINGS,
        "the stress fixture produces the findings it produced when this \
         budget was measured; a change here is a rule change, not a slow \
         machine"
    );
    assert!(
        report.of(RuleId::L02).next().is_none(),
        "the generator wires this fixture acyclically, so a cycle row would \
         mean the input changed under the budget"
    );

    // Printed rather than only asserted, matching fixtures.rs's load-budget
    // test — so `cargo test -- --nocapture` reports the number, and Wave 9's
    // `pnpm bench:lint` can read it off this run rather than re-timing the
    // linter itself.
    println!("stress-2000 lint in {} ms", elapsed.as_millis());
    assert!(
        elapsed.as_millis() < 500,
        "PRD section 14.7 gives the full graph lint 500 ms against \
         fixtures/stress-2000/, and this run took {} ms over {} nodes and {} \
         edges, producing {} findings",
        elapsed.as_millis(),
        report.nodes,
        report.edges,
        report.findings.len()
    );
}

/// How many findings `fixtures/stress-2000/` produces.
///
/// None. The fixture holds 20 services and 1980 bare modules: no facet, no
/// screen, no decision and no library, so nine of the thirteen rules have
/// nothing to look at. The generator wires every dependency edge backwards in
/// mint order, which leaves L02 nothing. L10 stays quiet because the edges run
/// between services as well as inside them, so a shared module's dependents
/// share only the project root and the module sits *below* that rather than
/// above it, which is the condition PRD section 10.4 names.
///
/// A budget asserted against an empty report would be a budget asserted
/// against nothing, which is why
/// `the_rules_really_run_over_the_stress_fixture` sits below.
const STRESS_FINDINGS: usize = 0;

#[test]
fn the_rules_really_run_over_the_stress_fixture() {
    let outcome = load_project(&fixture("stress-2000")).unwrap();
    let mut graph = outcome.graph;
    assert_eq!(graph.node_count(), 2000);

    // The clean run above proves the linter is fast over 2000 nodes. This one
    // proves it was looking: one planted defect inside the same graph, found.
    let host = graph
        .nodes_of_kind(&NodeKind::Module)
        .first()
        .copied()
        .expect("the stress fixture holds modules");
    let planted = Node::new(NodeEnvelope {
        id: Uuid::from_u128(0x7a11_0001),
        slug: Slug::new("planted-budget").unwrap(),
        kind: NodeKind::Budget,
        title: "planted_p95".to_owned(),
        description: None,
        lifecycle: Lifecycle::Specified,
        layer: None,
        parent: Some(host),
        decisions: Vec::new(),
        authored_by: Authorship::Human,
        created: "2026-08-25T00:00:00Z".to_owned(),
        superseded_by: None,
        stale: None,
    })
    .with_fields(&BudgetFields {
        metric: "planted_p95".to_owned(),
        op: "<".to_owned(),
        value: 5.0,
        unit: "ms".to_owned(),
        tier: BudgetTier::Hard,
        probe: None,
        sign_off: None,
    })
    .unwrap();
    graph.insert_node(planted);
    graph.reindex();

    let report = lint(&graph);
    assert_eq!(report.nodes, 2001, "the planted node went in");
    let found: Vec<&str> = report
        .of(RuleId::L03)
        .map(|f| f.node_cell.as_str())
        .collect();
    assert_eq!(
        found.len(),
        1,
        "rule L03 ran over the stress graph and found the planted budget"
    );
    assert!(
        found[0].ends_with(" · planted_p95"),
        "the row names the module and the metric: {}",
        found[0]
    );
}

#[test]
fn the_dense_fixture_lints_clean_of_everything_it_has_no_content_for() {
    let outcome = load_project(&fixture("dense-service")).unwrap();
    let report = lint(&outcome.graph);

    assert_eq!(report.nodes, 201);
    assert_eq!(report.rules, RULE_COUNT);
    for rule in [
        RuleId::L02,
        RuleId::L03,
        RuleId::L04,
        RuleId::L05,
        RuleId::L06,
        RuleId::L07,
        RuleId::L08,
        RuleId::L09,
        RuleId::L11,
        RuleId::L12,
        RuleId::L13,
    ] {
        assert_eq!(
            report.of(rule).count(),
            0,
            "{} has nothing to find in a fixture of bare modules",
            rule.code()
        );
    }
}
