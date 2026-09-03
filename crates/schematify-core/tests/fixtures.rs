//! The three reference fixtures of PRD section 16, asserted against the crate.
//!
//! These are integration tests rather than unit tests because they read the
//! committed fixture trees from disk. A unit test that builds a graph in
//! memory proves the loader parses what this crate wrote; these prove it parses
//! what `fixtures/generate.mjs` wrote, which is a different claim and the one
//! every later wave depends on.
//!
//! The load budget of PRD section 14.7 is asserted here, against
//! `stress-2000`. It is a wall-clock assertion on a shared machine, so it is
//! deliberately the stated 1000 ms and not a tighter number somebody would
//! spend a morning on when a build agent is busy.

use std::path::PathBuf;

use schematify_core::{
    check_transition, load_project, EdgeKind, Graph, Lifecycle, Node, NodeKind, SlugScope, Uuid,
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
/// avoids resolving fixtures against a directory that no longer exists.
fn manifest_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| env!("CARGO_MANIFEST_DIR").to_string()),
    )
}

/// Every node named in PRD section 16.1, by slug.
const NAMED: &[&str] = &[
    "api-gateway",
    "platform-core",
    "auth-service",
    "session-service",
    "billing-service",
    "notification-service",
    "ledger-store",
    "event-bus",
    "http-entry",
    "token-issuer",
    "token-verifier",
    "jwks-cache",
    "clock-skew",
    "session-store",
    "session-codec",
    "session-index",
    "crypto-primitives",
    "password-hasher",
    "rate-limiter",
    "audit-emitter",
    "verify-signature",
    "refresh-keys",
    "skew-window",
    "issue-pair",
    "mint",
    "revoke",
    "check-password",
    "verify-p95",
    "jwks-refetch-rate",
    "cold-start-p95",
    "token-pipeline",
    "two-caches-on-purpose",
];

#[test]
fn every_node_named_in_the_wireframe_fixture_exists() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let slugs: Vec<String> = outcome
        .graph
        .nodes()
        .map(|n| n.envelope.slug.as_str().to_owned())
        .collect();
    for name in NAMED {
        assert!(slugs.iter().any(|s| s == name), "{name} is missing");
    }
}

#[test]
fn the_wireframe_fixture_loads_with_nothing_dangling() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    assert!(
        outcome.report.quarantined.is_empty(),
        "{:?}",
        outcome.report.quarantined
    );
    assert!(
        outcome.report.slug_collisions.is_empty(),
        "{:?}",
        outcome.report.slug_collisions
    );
    assert!(outcome.report.unreadable.is_empty());
}

fn by_slug(graph: &Graph, slug: &str) -> Uuid {
    graph
        .nodes()
        .find(|n| n.envelope.slug.as_str() == slug)
        .map(Node::id)
        .unwrap_or_else(|| panic!("{slug} is missing"))
}

#[test]
fn the_stack_tier_computes_the_counts_the_wireframe_draws() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;

    let services = graph.nodes_of_kind(&NodeKind::Service);
    assert_eq!(services.len(), 7, "seven nodes of kind service");

    let counts = [
        ("api-gateway", 4, 11),
        ("auth-service", 12, 4),
        ("session-service", 6, 2),
        ("billing-service", 9, 6),
        ("ledger-store", 2, 3),
        ("notification-service", 2, 0),
    ];
    for (slug, modules, exports) in counts {
        let id = by_slug(graph, slug);
        assert_eq!(
            graph.modules_of_service(id).len(),
            modules,
            "{slug} module count"
        );
        let service = graph.node(id).unwrap().service().unwrap();
        assert_eq!(service.exports.len(), exports, "{slug} export count");
        for export in &service.exports {
            let node = graph.node(*export).unwrap();
            assert_eq!(*node.kind(), NodeKind::ContractMethod, "{slug} export kind");
            assert!(node.contract_method().unwrap().exported);
        }
    }
}

#[test]
fn the_event_bus_is_shared_and_sits_at_the_lowest_common_ancestor() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let bus = by_slug(graph, "event-bus");

    assert_eq!(graph.dependents(bus).len(), 4, "four dependents");
    assert!(graph.is_shared(bus));
    assert_eq!(graph.shared_node_parent(bus), Some(None), "the stack root");
    assert!(graph.shared_node_is_at_lca(bus));
    assert_eq!(graph.node(bus).unwrap().envelope.parent, None);
}

#[test]
fn crypto_primitives_sits_above_the_lca_of_its_dependents() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let shared = by_slug(graph, "crypto-primitives");
    let verifier = by_slug(graph, "token-verifier");

    assert_eq!(graph.dependents(shared).len(), 2);
    assert_eq!(graph.shared_node_parent(shared), Some(Some(verifier)));
    assert!(
        !graph.shared_node_is_at_lca(shared),
        "rule L10 should have something to find"
    );
}

#[test]
fn the_wireframe_fixture_carries_the_dependency_cycle_the_problems_panel_draws() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let cycle = graph.dependency_cycle().expect("a cycle exists");
    let codec = by_slug(graph, "session-codec");
    assert!(cycle.contains(&codec), "session-codec is in the cycle");
}

#[test]
fn the_wireframe_fixture_carries_a_budget_with_no_probe_and_a_method_with_no_covers() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;

    let cold_start = graph.node(by_slug(graph, "cold-start-p95")).unwrap();
    assert!(cold_start.budget().unwrap().probe.is_none());

    let mint = by_slug(graph, "mint");
    let covers = graph
        .edges()
        .filter(|e| e.kind == EdgeKind::Covers && e.target == mint)
        .count();
    assert_eq!(covers, 0, "token-issuer.mint carries no covers edge");
}

#[test]
fn the_annotation_node_carries_the_semantic_edge_rule_l05_looks_for() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let comment = by_slug(graph, "two-caches-on-purpose");
    assert!(graph.node(comment).unwrap().kind().is_annotation());
    let offending = graph
        .edges()
        .filter(|e| e.source == comment && e.kind.is_semantic())
        .count();
    assert_eq!(offending, 1);
}

#[test]
fn the_token_verifier_holds_the_facets_and_the_history_the_wireframe_draws() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let verifier = by_slug(graph, "token-verifier");

    assert_eq!(graph.facet_count(verifier), 15);
    assert_eq!(
        graph.node(verifier).unwrap().envelope.lifecycle,
        Lifecycle::Accepted
    );

    let runs = graph.runs(verifier);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].run, 1184);
    assert_eq!(runs[0].tests_passing(), (5, 7));
    assert_eq!(runs[0].budgets_passing(), (2, 3));
    assert_eq!(runs[0].reconcile.unwrap().matched, 7);

    let audit = graph.audit(verifier);
    assert_eq!(audit.last().unwrap().to, Lifecycle::Accepted);
    assert_eq!(audit.last().unwrap().actor_name, "m.ross");
}

#[test]
fn the_stale_node_carries_the_reason_the_caption_draws() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let emitter = graph.node(by_slug(graph, "audit-emitter")).unwrap();

    assert_eq!(emitter.envelope.lifecycle, Lifecycle::Stale);
    let mark = emitter.envelope.stale.as_ref().expect("a stale reason");
    assert_eq!(mark.source, by_slug(graph, "token-verifier"));
    assert_eq!(mark.member.as_deref(), Some("verify-signature"));

    // The dependency edge that justifies the mark exists, so a wave 10
    // cascade over this fixture reproduces it rather than contradicting it.
    assert!(graph.dependents(mark.source).contains(&emitter.id()));
}

#[test]
fn every_audit_row_in_the_fixture_is_a_legal_transition() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let verifier = by_slug(graph, "token-verifier");

    let mut state = Lifecycle::Draft;
    for row in graph.audit(verifier) {
        assert_eq!(row.from, state, "history is a chain");
        check_transition(row.from, row.to, row.actor)
            .unwrap_or_else(|e| panic!("{:?} to {:?}: {e}", row.from, row.to));
        state = row.to;
    }
    assert_eq!(state, graph.node(verifier).unwrap().envelope.lifecycle);
}

#[test]
fn the_derived_tech_stack_counts_come_out_of_the_modules() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;

    for (name, expected) in [("jose", 6), ("zod", 14), ("argon2", 2), ("postgres", 9)] {
        let entry = graph.libraries().by_name(name).expect(name);
        let used = graph
            .nodes()
            .filter(|n| *n.kind() == NodeKind::Module)
            .filter(|n| {
                n.module()
                    .is_ok_and(|m| m.allowed_libraries.contains(&entry.id))
            })
            .count();
        assert_eq!(used, expected, "{name} module count");
    }
}

#[test]
fn the_rule_registry_holds_the_fourteen_rows_the_linter_card_counts() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    assert_eq!(outcome.graph.rules().count(), 14);
}

#[test]
fn the_ui_refs_cache_matches_the_references_ui_edge() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let verifier = by_slug(graph, "token-verifier");

    let edges: Vec<Uuid> = graph
        .edges()
        .filter(|e| e.kind == EdgeKind::ReferencesUi && e.source == verifier)
        .map(|e| e.target)
        .collect();
    let cache: Vec<Uuid> = graph
        .node(verifier)
        .unwrap()
        .module()
        .unwrap()
        .ui_refs
        .iter()
        .map(|u| u.id)
        .collect();
    assert_eq!(edges, cache);
    assert!(!edges.is_empty());
}

#[test]
fn the_slug_index_scopes_a_facet_to_its_module() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let verifier = by_slug(&outcome.graph, "token-verifier");
    assert!(outcome
        .report
        .slug_owner(SlugScope::ModuleRoot(verifier), "verify-signature")
        .is_some());
}

#[test]
fn the_dense_fixture_holds_two_hundred_modules_at_depth_five() {
    let outcome = load_project(&fixture("dense-service")).unwrap();
    let graph = &outcome.graph;
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );

    let modules = graph.nodes_of_kind(&NodeKind::Module);
    assert_eq!(modules.len(), 200);
    assert_eq!(graph.edge_count(), 260);

    let deepest = modules
        .iter()
        .map(|id| graph.ancestors(*id).len())
        .max()
        .unwrap();
    assert!(deepest >= 4, "containment depth 5 counting the service");
    assert!(!graph.has_dependency_cycle());
}

#[test]
fn the_stress_fixture_holds_two_thousand_nodes_and_three_thousand_edges() {
    let outcome = load_project(&fixture("stress-2000")).unwrap();
    assert_eq!(outcome.graph.node_count(), 2000);
    assert_eq!(outcome.graph.edge_count(), 3000);
    assert_eq!(outcome.graph.nodes_of_kind(&NodeKind::Service).len(), 20);
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );
}

/// PRD section 14.7: the stress fixture loads in under 1000 ms.
///
/// The loader is timed rather than the whole test, so the fixture path
/// resolution and the assertions below it stay out of the number.
#[test]
fn the_stress_fixture_loads_inside_the_wave_one_budget() {
    let root = fixture("stress-2000");
    // One warm pass first. The budget is about the loader, not about the
    // operating system's first look at 5000 files it has never opened.
    let _ = load_project(&root).unwrap();

    let outcome = load_project(&root).unwrap();
    assert_eq!(outcome.graph.node_count(), 2000);
    // Printed rather than only asserted, so `cargo test -- --nocapture` says
    // how much headroom is left rather than only that some was.
    println!("stress-2000 loaded in {} ms", outcome.report.duration_ms);
    assert!(
        outcome.report.duration_ms < 1000,
        "the stress fixture loaded in {} ms, over the 1000 ms budget",
        outcome.report.duration_ms
    );
}
