//! The three acceptance conditions of PRD wave 8, asserted against the
//! reference fixtures rather than against a graph built in memory.
//!
//! The search budget of PRD section 14.7 is the hard one: a first result in
//! under 100 ms over `fixtures/stress-2000/`. It is written the way the wave 7
//! lint budget was written, and for the same reason. A timing assertion over
//! an empty index would pass instantly and prove nothing, so this states what
//! was indexed and what came back before it times anything.

use std::path::PathBuf;
use std::time::Instant;

use schematify_core::{
    load_project, whitelist_library, GraphIndex, HitKind, LibraryEntry, LicensePolicy,
    LicenseVerdict, MatchRank, Node, NodeKind, RegistryError, RuleDocument, SearchIndex, Severity,
    Uuid, DEFAULT_LIMIT,
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

// ---------------------------------------------------------------------------
// Acceptance: a library with a blocked license is refused with a stated reason.
// ---------------------------------------------------------------------------

#[test]
fn a_blocked_licence_is_refused_against_the_real_registry_and_states_why() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let mut registry = outcome.graph.libraries().clone();
    assert_eq!(registry.libraries.len(), 4, "the fixture registry loaded");

    let error = registry
        .add(
            LibraryEntry {
                id: Uuid::from_u128(0x8a_0001),
                name: "readline".to_owned(),
                version: "8.2".to_owned(),
                license: "GPL-3.0-or-later".to_owned(),
                rationale: Some("Line editing.".to_owned()),
                decision: None,
            },
            &LicensePolicy::default(),
        )
        .expect_err("PRD section 10.1 makes a GPL dependency a blocked add");

    let drawn = error.to_string();
    assert!(drawn.contains("readline 8.2"), "names the library: {drawn}");
    assert!(
        drawn.contains("GPL-3.0-or-later"),
        "names the licence: {drawn}"
    );
    assert!(drawn.contains("copyleft"), "states the reason: {drawn}");
    assert_eq!(registry.libraries.len(), 4, "the refused add wrote nothing");
}

#[test]
fn every_licence_the_reference_fixture_ships_survives_the_default_policy() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let policy = LicensePolicy::default();

    let licences: Vec<&str> = outcome
        .graph
        .libraries()
        .libraries
        .iter()
        .map(|entry| entry.license.as_str())
        .collect();
    assert_eq!(licences.len(), 4, "four libraries went in");

    for licence in licences {
        assert_eq!(
            policy.verdict(licence),
            LicenseVerdict::Allowed,
            "the default policy blocks {licence}, which the fixture ships"
        );
    }
}

// ---------------------------------------------------------------------------
// Acceptance: a module cannot whitelist a library missing from the registry.
// ---------------------------------------------------------------------------

#[test]
fn a_module_cannot_whitelist_a_library_the_registry_does_not_hold() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let registry = graph.libraries();

    let id = graph
        .nodes()
        .find(|n| n.envelope.slug.as_str() == "token-issuer")
        .map(Node::id)
        .expect("token-issuer is in the fixture");
    let mut module = graph.node(id).expect("the node loaded").clone();
    let before = module.module().unwrap().allowed_libraries.len();
    assert!(
        before > 0,
        "the fixture module already whitelists something"
    );

    let absent = Uuid::from_u128(0x8a_0002);
    assert!(
        !registry.contains(absent),
        "and the registry lacks this one"
    );

    let error = whitelist_library(&mut module, registry, absent)
        .expect_err("PRD section 10.1 permits a library the registry holds and no other");
    assert!(matches!(
        error,
        RegistryError::LibraryNotInRegistry { library, .. } if library == absent
    ));
    assert_eq!(
        module.module().unwrap().allowed_libraries.len(),
        before,
        "the refusal wrote nothing"
    );

    // The same call succeeds for a library the registry does hold, so the
    // refusal is the registry check and not the function failing outright.
    let held = registry.libraries[0].id;
    whitelist_library(&mut module, registry, held).expect("a registered library goes in");
    assert!(module.module().unwrap().allowed_libraries.contains(&held));
}

// ---------------------------------------------------------------------------
// The rule registry as a document.
// ---------------------------------------------------------------------------

#[test]
fn the_rule_registry_reads_as_a_document_of_the_fourteen_rows() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let document = RuleDocument::build(outcome.graph.rules());

    assert_eq!(
        document.rule_count(),
        14,
        "PRD section 10.2 seeds the fourteen the LINTER card counts"
    );
    assert_eq!(
        document.sections.len(),
        1,
        "every fixture rule carries the same severity"
    );
    assert_eq!(document.sections[0].severity, Severity::Error);
    assert_eq!(document.sections[0].heading, "MUST");

    let slugs: Vec<&str> = document.sections[0]
        .rules
        .iter()
        .map(|row| row.slug.as_str())
        .collect();
    let mut sorted = slugs.clone();
    sorted.sort_unstable();
    assert_eq!(slugs, sorted, "the page does not reshuffle between loads");
    assert!(
        document.sections[0]
            .rules
            .iter()
            .all(|row| !row.statement.is_empty()),
        "every row carries the standard it states"
    );
}

// ---------------------------------------------------------------------------
// Acceptance: search returns a first result in under 100 ms on stress-2000.
// ---------------------------------------------------------------------------

/// How many things `fixtures/stress-2000/` puts in the index.
///
/// Its 2000 nodes and nothing else: PRD section 16.3 gives it 20 services and
/// 1980 modules, with no rule, library, screen, flow or decision. If this
/// number moves, the fixture changed and the budget below is being measured
/// against different input.
const STRESS_ENTRIES: usize = 2000;

#[test]
fn search_returns_a_first_result_inside_the_wave_eight_budget() {
    let outcome = load_project(&fixture("stress-2000")).unwrap();
    let graph = &outcome.graph;

    // What went in.
    assert_eq!(graph.node_count(), 2000, "2000 nodes went in");
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );

    // The index builds on project load, per PRD section 12.16, so the budget
    // is the query and the build is not inside it.
    let index = GraphIndex::build(graph);
    assert_eq!(
        index.entry_count(),
        STRESS_ENTRIES,
        "the whole fixture was indexed, so the query below scans it"
    );

    let started = Instant::now();
    let hits = index.search("stress-module-7-42", DEFAULT_LIMIT);
    let elapsed = started.elapsed();

    // What came back. A budget met by returning nothing is not a budget met.
    let first = hits.first().expect("a first result came back");
    assert_eq!(first.slug, "stress-module-7-42", "and it is the right one");
    assert_eq!(first.rank, MatchRank::ExactSlug);
    assert_eq!(
        first.kind,
        HitKind::Node {
            kind: NodeKind::Module
        }
    );
    assert!(
        first.breadcrumb.starts_with("Stack › "),
        "the row draws the breadcrumb path: {}",
        first.breadcrumb
    );

    // Reported in microseconds, not whole milliseconds. The budget is 100 ms
    // and this query costs a small fraction of one, so at millisecond
    // resolution a regression to forty milliseconds and a healthy run both
    // print `0` and a later reader learns nothing about the margin they are
    // spending. The comparison below is nanosecond-precise either way; it is
    // the message that has to stay informative.
    //
    // Printed rather than only asserted, matching fixtures.rs's load-budget
    // test and lint.rs's lint-budget test — so `cargo test -- --nocapture`
    // reports the number, and Wave 9's `pnpm bench:search` can read it off
    // this run rather than re-timing the query itself.
    println!("stress-2000 search in {} us", elapsed.as_micros());
    assert!(
        elapsed.as_micros() < 100_000,
        "PRD section 14.7 gives search 100 ms to a first result over \
         fixtures/stress-2000/, and this query took {} µs over {} indexed \
         entries, returning {} hits",
        elapsed.as_micros(),
        index.entry_count(),
        hits.len()
    );
}

#[test]
fn the_stress_index_really_searches_rather_than_answering_from_one_lucky_row() {
    let outcome = load_project(&fixture("stress-2000")).unwrap();
    let index = GraphIndex::build(&outcome.graph);
    assert_eq!(index.entry_count(), STRESS_ENTRIES);

    // A query no entry can satisfy comes back empty, so a hit is a match and
    // not the index handing back whatever it had.
    assert!(index.search("zzzz-no-such-node", DEFAULT_LIMIT).is_empty());

    // A broad query matches far more than the limit, so the limit is doing
    // work rather than the index happening to hold few matches. No node is
    // slugged `stress-module-1`, so every one of these is a partial match.
    let broad = index.search("stress-module-1", DEFAULT_LIMIT);
    assert_eq!(broad.len(), DEFAULT_LIMIT, "the limit truncated the hits");
    assert!(
        broad.iter().all(|hit| hit.rank == MatchRank::SlugSubstring),
        "a query that is nobody's slug matches on the slug substring alone"
    );

    // And where an exact slug does exist among the partial matches, it leads.
    let mixed = index.search("stress-module-1-1", DEFAULT_LIMIT);
    assert!(
        mixed.len() > 1,
        "1-10 through 1-19 match this as a substring"
    );
    assert_eq!(mixed[0].slug, "stress-module-1-1");
    assert_eq!(
        mixed[0].rank,
        MatchRank::ExactSlug,
        "the exact slug outranks the partial matches"
    );
    assert!(
        mixed[1..]
            .iter()
            .all(|hit| hit.rank == MatchRank::SlugSubstring),
        "and everything under it matched less well"
    );
}

#[test]
fn the_index_spans_every_collection_the_wireframe_fixture_holds() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let index = GraphIndex::build(graph);

    let expected = graph.node_count()
        + graph.rules().count()
        + graph.libraries().libraries.len()
        + graph.screens().count()
        + graph.flows().count()
        + graph.decisions().count();
    assert_eq!(index.entry_count(), expected);

    // One hit from each collection PRD section 12.16 names, to prove the
    // whole list is reachable and not just the node collection.
    for (query, kind) in [
        (
            "auth-service",
            HitKind::Node {
                kind: NodeKind::Service,
            },
        ),
        (
            "token-verifier",
            HitKind::Node {
                kind: NodeKind::Module,
            },
        ),
        (
            "verify-signature",
            HitKind::Node {
                kind: NodeKind::ContractMethod,
            },
        ),
        (
            "expired-token-is-rejected",
            HitKind::Node {
                kind: NodeKind::TestCase,
            },
        ),
        ("no-unwrap", HitKind::Rule),
        ("jose", HitKind::Library),
        ("login-form", HitKind::Screen),
        ("first-run-signup", HitKind::Flow),
        ("DEC-TEC-AUTH-004", HitKind::Decision),
    ] {
        let hits = index.search(query, DEFAULT_LIMIT);
        let first = hits
            .first()
            .unwrap_or_else(|| panic!("{query} found nothing"));
        assert_eq!(first.kind, kind, "{query} came back as the wrong kind");
    }
}

#[test]
fn a_facet_hit_draws_the_breadcrumb_to_its_module() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let index = GraphIndex::build(&outcome.graph);

    let hits = index.search("cold-start-p95", DEFAULT_LIMIT);
    let first = hits.first().expect("the budget facet is in the fixture");
    assert_eq!(first.breadcrumb, "› Token Verifier");

    let hits = index.search("crypto-primitives", DEFAULT_LIMIT);
    let first = hits.first().expect("the module is in the fixture");
    assert_eq!(first.breadcrumb, "Stack › Auth Service");
}

#[test]
fn a_marker_token_finds_the_test_case_that_carries_it() {
    let outcome = load_project(&fixture("saas-backend")).unwrap();
    let graph = &outcome.graph;
    let index = GraphIndex::build(graph);

    let marker = graph
        .nodes()
        .filter(|n| *n.kind() == NodeKind::TestCase)
        .find_map(|n| n.test_case().ok().and_then(|t| t.impl_ref))
        .expect("the fixture links test cases to code");

    let hits = index.search(&marker, DEFAULT_LIMIT);
    assert!(!hits.is_empty(), "the marker token {marker} found nothing");
    assert_eq!(hits[0].rank, MatchRank::ExactMarker);
}
