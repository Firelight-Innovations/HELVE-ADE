//! Loader tests, kept beside `load.rs` rather than inside it.
//!
//! They live in their own file because the comment-density check caps how much
//! of one file may be prose, and `load.rs` is already at its budget with the
//! reasoning that belongs on the code. The module is private and compiled only
//! under `cfg(test)`, so nothing about the crate's surface changes.

use std::fs;
use std::path::Path;

use uuid::Uuid;

use crate::atomic::write_json_atomic;
use crate::decision::{Decision, DecisionStatus};
use crate::edge::{Edge, EdgeKind};
use crate::error::CoreError;
use crate::lifecycle::{Actor, Lifecycle};
use crate::load::{load_project, QuarantineReason};
use crate::node::{Authorship, ExternalDepFields, ModuleFields, Node, NodeEnvelope, NodeKind};
use crate::product::{Flow, FlowStep, Screen};
use crate::registry::{LibraryEntry, LibraryRegistry};
use crate::run::{RunArtifact, RUN_SCHEMA_VERSION};
use crate::slug::{Slug, SlugScope};
use crate::store::Store;
use crate::uri::Uri;

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

fn project() -> (tempfile::TempDir, Store) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(directory.path());
    store.init().unwrap();
    (directory, store)
}

#[test]
fn a_directory_with_no_kaava_tree_is_the_one_error_the_loader_returns() {
    let directory = tempfile::tempdir().unwrap();
    let error = load_project(directory.path()).unwrap_err();
    assert!(matches!(error, CoreError::NoProject { .. }));
}

#[test]
fn an_empty_project_loads_clean() {
    let (directory, _store) = project();
    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.graph.node_count(), 0);
    assert!(outcome.report.is_clean());
}

#[test]
fn a_project_round_trips_through_the_store_and_the_loader() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "auth-service", NodeKind::Service, None))
        .unwrap();
    store
        .write_node(&node(2, "token-verifier", NodeKind::Module, Some(1)))
        .unwrap();
    store
        .write_edge(&Edge::new(
            Uuid::from_u128(10),
            EdgeKind::DependsOn,
            Uuid::from_u128(2),
            Uuid::from_u128(1),
            "2026-08-25T00:00:00Z",
        ))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );
    assert_eq!(outcome.graph.node_count(), 2);
    assert_eq!(
        outcome.graph.children(Uuid::from_u128(1)),
        [Uuid::from_u128(2)]
    );
    assert_eq!(
        outcome.graph.dependents(Uuid::from_u128(1)),
        [Uuid::from_u128(2)]
    );
    assert_eq!(
        outcome
            .report
            .slug_owner(SlugScope::ProjectRoot, "auth-service"),
        Some(Uuid::from_u128(1))
    );
}

#[test]
fn a_dangling_parent_quarantines_the_child_and_does_not_crash() {
    let (directory, store) = project();
    store
        .write_node(&node(2, "token-verifier", NodeKind::Module, Some(999)))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.report.quarantined.len(), 1);
    let record = &outcome.report.quarantined[0];
    assert_eq!(record.subject, Uuid::from_u128(2));
    assert_eq!(record.field, "parent");
    assert_eq!(record.reason, QuarantineReason::MissingParent);
    assert!(outcome.graph.is_quarantined(Uuid::from_u128(2)));
    assert!(outcome.graph.node(Uuid::from_u128(2)).is_some());
}

#[test]
fn a_dangling_edge_endpoint_quarantines_the_edge() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "a", NodeKind::Module, None))
        .unwrap();
    store
        .write_edge(&Edge::new(
            Uuid::from_u128(10),
            EdgeKind::DependsOn,
            Uuid::from_u128(1),
            Uuid::from_u128(404),
            "2026-08-25T00:00:00Z",
        ))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.report.quarantined.len(), 1);
    assert_eq!(
        outcome.report.quarantined[0].reason,
        QuarantineReason::MissingEndpoint
    );
    assert!(outcome.graph.is_quarantined(Uuid::from_u128(10)));
}

#[test]
fn every_kind_of_dangling_reference_is_reported_rather_than_dropped() {
    let (directory, store) = project();

    let mut module = node(1, "token-verifier", NodeKind::Module, None);
    module.envelope.decisions = vec![Uri::decision(Uuid::from_u128(900))];
    module.envelope.superseded_by = Some(Uuid::from_u128(901));
    let module = module
        .with_fields(&ModuleFields {
            allowed_libraries: vec![Uuid::from_u128(902)],
            ui_refs: vec![Uri::screen(Uuid::from_u128(903))],
        })
        .unwrap();
    store.write_node(&module).unwrap();

    let dep = node(2, "jose-use", NodeKind::ExternalDep, Some(1))
        .with_fields(&ExternalDepFields {
            registry_ref: Uuid::from_u128(904),
            usage_note: None,
        })
        .unwrap();
    store.write_node(&dep).unwrap();

    store
        .write_screen(&Screen {
            id: Uuid::from_u128(3),
            kind: Screen::KIND.to_owned(),
            slug: Slug::new("login-form").unwrap(),
            title: "Login form".to_owned(),
            purpose: "Collects credentials.".to_owned(),
            states: Vec::new(),
            acceptance: Vec::new(),
            design_ref: None,
            backed_by: vec![Uri::node(Uuid::from_u128(905))],
        })
        .unwrap();

    store
        .write_flow(&Flow {
            id: Uuid::from_u128(4),
            kind: Flow::KIND.to_owned(),
            slug: Slug::new("first-run").unwrap(),
            title: "First run".to_owned(),
            trigger: "A visitor arrives.".to_owned(),
            steps: vec![FlowStep {
                screen: Uri::screen(Uuid::from_u128(906)),
                action: "They sign up.".to_owned(),
            }],
            outcome: "They hold a session.".to_owned(),
        })
        .unwrap();

    store
        .write_decision(&Decision {
            id: Uuid::from_u128(5),
            kind: Decision::KIND.to_owned(),
            slug: Slug::new("DEC-TEC-AUTH-004").unwrap(),
            title: "A decision".to_owned(),
            context: "Context.".to_owned(),
            decision: "Decided.".to_owned(),
            consequences: "Consequences.".to_owned(),
            status: DecisionStatus::Superseded,
            supersedes: None,
            superseded_by: Some(Uuid::from_u128(907)),
            date: "2026-08-19".to_owned(),
        })
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    let reasons: Vec<QuarantineReason> = outcome
        .report
        .quarantined
        .iter()
        .map(|q| q.reason)
        .collect();

    for expected in [
        QuarantineReason::MissingDecision,
        QuarantineReason::MissingSuccessor,
        QuarantineReason::MissingLibrary,
        QuarantineReason::MissingScreen,
        QuarantineReason::MissingNode,
        QuarantineReason::MissingFlowScreen,
    ] {
        assert!(reasons.contains(&expected), "{expected:?} not reported");
    }
    assert_eq!(outcome.graph.node_count(), 2);
}

#[test]
fn a_references_ui_edge_resolves_its_target_against_the_screens() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "token-verifier", NodeKind::Module, None))
        .unwrap();
    store
        .write_screen(&Screen {
            id: Uuid::from_u128(2),
            kind: Screen::KIND.to_owned(),
            slug: Slug::new("login-form").unwrap(),
            title: "Login form".to_owned(),
            purpose: "Collects credentials.".to_owned(),
            states: Vec::new(),
            acceptance: Vec::new(),
            design_ref: None,
            backed_by: Vec::new(),
        })
        .unwrap();
    store
        .write_edge(&Edge::new(
            Uuid::from_u128(10),
            EdgeKind::ReferencesUi,
            Uuid::from_u128(1),
            Uuid::from_u128(2),
            "2026-08-25T00:00:00Z",
        ))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );
}

#[test]
fn a_slug_collision_inside_one_scope_is_reported_and_the_graph_still_loads() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "cache", NodeKind::Service, None))
        .unwrap();
    store
        .write_node(&node(2, "cache", NodeKind::Service, None))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.report.slug_collisions.len(), 1);
    assert_eq!(outcome.graph.node_count(), 2);
}

#[test]
fn the_same_slug_under_two_parents_is_not_a_collision() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "auth-service", NodeKind::Service, None))
        .unwrap();
    store
        .write_node(&node(2, "billing-service", NodeKind::Service, None))
        .unwrap();
    store
        .write_node(&node(3, "cache", NodeKind::Module, Some(1)))
        .unwrap();
    store
        .write_node(&node(4, "cache", NodeKind::Module, Some(2)))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert!(outcome.report.slug_collisions.is_empty());
}

#[test]
fn a_file_that_is_not_json_is_reported_and_the_rest_of_the_project_loads() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "auth-service", NodeKind::Service, None))
        .unwrap();
    fs::write(
        store.kaava_dir().join("nodes").join("broken.json"),
        "{ not json",
    )
    .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.report.unreadable.len(), 1);
    assert_eq!(outcome.graph.node_count(), 1);
}

#[test]
fn a_run_and_its_audit_history_load_beside_the_node() {
    let (directory, store) = project();
    let mut value = node(1, "token-verifier", NodeKind::Module, None);
    value.envelope.lifecycle = Lifecycle::Reviewed;
    store.write_node(&value).unwrap();
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
    store
        .write_run(
            Uuid::from_u128(1),
            &RunArtifact {
                schema: RUN_SCHEMA_VERSION.to_owned(),
                run: 1184,
                at: "2026-08-25T14:02:00Z".to_owned(),
                commit: "4f2c9ab".to_owned(),
                workflow: "ci/verify.yml".to_owned(),
                budgets: Vec::new(),
                tests: Vec::new(),
                linter: None,
                reconcile: None,
            },
        )
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.graph.runs(Uuid::from_u128(1)).len(), 1);
    assert_eq!(outcome.graph.audit(Uuid::from_u128(1)).len(), 1);
    assert!(
        outcome.report.is_clean(),
        "{:?}",
        outcome.report.quarantined
    );
}

#[test]
fn a_run_with_an_unknown_schema_is_quarantined_rather_than_read() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "token-verifier", NodeKind::Module, None))
        .unwrap();
    let path = store.run_path(Uuid::from_u128(1), 9);
    write_json_atomic(
        &path,
        &serde_json::json!({
            "schema": "kaava-bench-v9",
            "run": 9,
            "at": "2026-08-25T00:00:00Z",
            "commit": "abc",
            "workflow": "ci/verify.yml"
        }),
    )
    .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert!(outcome.graph.runs(Uuid::from_u128(1)).is_empty());
    let record = outcome
        .report
        .quarantined
        .iter()
        .find(|q| q.reason == QuarantineReason::UnknownRunSchema)
        .unwrap();
    assert_eq!(record.reference, "kaava-bench-v9");
}

#[test]
fn the_registry_and_the_brief_load_from_their_own_files() {
    let (directory, store) = project();
    store
        .write_libraries(&LibraryRegistry {
            libraries: vec![LibraryEntry {
                id: Uuid::from_u128(50),
                name: "jose".to_owned(),
                version: "5.2.4".to_owned(),
                license: "MIT".to_owned(),
                rationale: None,
                decision: None,
            }],
        })
        .unwrap();
    write_json_atomic(
        &store.brief_path(),
        &crate::brief::ProjectBrief {
            product_name: "saas-backend".to_owned(),
            problem: "A problem.".to_owned(),
            ..Default::default()
        },
    )
    .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert!(outcome.graph.libraries().contains(Uuid::from_u128(50)));
    assert_eq!(
        outcome.graph.brief().map(|b| b.product_name.as_str()),
        Some("saas-backend")
    );
}

#[test]
fn a_quarantine_reason_carries_the_words_a_problems_row_draws() {
    assert_eq!(
        QuarantineReason::MissingParent.as_str(),
        "containment parent does not exist"
    );
    assert!(!QuarantineReason::UnknownRunSchema.as_str().is_empty());
}

#[test]
fn the_loader_reads_a_project_written_anywhere_on_disk() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "a", NodeKind::Service, None))
        .unwrap();
    let elsewhere: &Path = directory.path();
    assert_eq!(load_project(elsewhere).unwrap().graph.node_count(), 1);
}

#[test]
fn two_files_claiming_one_identifier_are_both_reported() {
    let (directory, store) = project();
    let first = store.kaava_dir().join("nodes").join("aaa.json");
    let second = store.kaava_dir().join("nodes").join("zzz.json");
    let mut a = node(1, "first-file", NodeKind::Service, None);
    a.envelope.title = "First file".to_owned();
    let mut b = node(1, "second-file", NodeKind::Service, None);
    b.envelope.title = "Second file".to_owned();
    write_json_atomic(&first, &a).unwrap();
    write_json_atomic(&second, &b).unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.graph.node_count(), 1);
    assert_eq!(outcome.report.id_collisions.len(), 1);
    let collision = &outcome.report.id_collisions[0];
    assert_eq!(collision.id, Uuid::from_u128(1));
    assert!(collision.kept.ends_with("aaa.json"));
    assert!(collision.discarded.ends_with("zzz.json"));
    assert!(!outcome.report.is_clean());
}

#[test]
fn the_surviving_file_of_a_collision_is_the_same_on_every_load() {
    let (directory, store) = project();
    for name in ["b", "c", "a", "d"] {
        let mut value = node(1, "same-id", NodeKind::Service, None);
        value.envelope.title = name.to_owned();
        write_json_atomic(
            &store.kaava_dir().join("nodes").join(format!("{name}.json")),
            &value,
        )
        .unwrap();
    }
    for _ in 0..5 {
        let outcome = load_project(directory.path()).unwrap();
        assert_eq!(
            outcome
                .graph
                .node(Uuid::from_u128(1))
                .unwrap()
                .envelope
                .title,
            "a"
        );
        assert_eq!(outcome.report.id_collisions.len(), 3);
    }
}

#[test]
fn a_filename_that_disagrees_with_its_identifier_is_reported() {
    let (directory, store) = project();
    let path = store.kaava_dir().join("nodes").join("token-verifier.json");
    write_json_atomic(&path, &node(1, "token-verifier", NodeKind::Module, None)).unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.graph.node_count(), 1, "the node still loads");
    assert_eq!(outcome.report.misnamed.len(), 1);
    assert_eq!(outcome.report.misnamed[0].id, Uuid::from_u128(1));
    assert!(outcome.report.misnamed[0]
        .file
        .ends_with("token-verifier.json"));
}

#[test]
fn a_quarantine_row_names_the_file_the_reference_was_read_from() {
    let (directory, store) = project();
    let path = store.kaava_dir().join("nodes").join("odd-name.json");
    write_json_atomic(&path, &node(2, "orphan", NodeKind::Module, Some(999))).unwrap();

    let outcome = load_project(directory.path()).unwrap();
    let record = &outcome.report.quarantined[0];
    assert_eq!(record.file, path, "the real path, not a synthesized one");
    assert!(record.file.exists());
}

#[test]
fn a_facet_under_a_group_is_scoped_to_its_module_root() {
    let (directory, store) = project();
    store
        .write_node(&node(1, "token-verifier", NodeKind::Module, None))
        .unwrap();
    store
        .write_node(&node(2, "token-pipeline", NodeKind::Group, Some(1)))
        .unwrap();
    store
        .write_node(&node(3, "verify", NodeKind::ContractMethod, Some(2)))
        .unwrap();
    // Directly under the module, so it collides with the one under the group
    // only if both are scoped to the module root, which is what section 3.2
    // asks for.
    store
        .write_node(&node(4, "verify", NodeKind::ContractMethod, Some(1)))
        .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(
        outcome.report.slug_collisions.len(),
        1,
        "two methods named verify inside one module collide"
    );
    assert_eq!(
        outcome
            .report
            .slug_owner(SlugScope::ModuleRoot(Uuid::from_u128(1)), "verify"),
        Some(Uuid::from_u128(3))
    );
}

#[test]
fn a_closed_schema_refuses_a_field_it_does_not_model() {
    let (directory, store) = project();
    write_json_atomic(
        &store.kaava_dir().join("screens").join("s.json"),
        &serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "kind": "screen",
            "slug": "login-form",
            "title": "Login form",
            "purpose": "Collects credentials.",
            "invented_by_a_later_wave": "this must not be dropped"
        }),
    )
    .unwrap();

    let outcome = load_project(directory.path()).unwrap();
    assert_eq!(outcome.report.unreadable.len(), 1);
    assert_eq!(outcome.graph.screens().count(), 0);
}

#[test]
fn the_three_product_schemas_carry_their_kind() {
    let (directory, store) = project();
    store
        .write_screen(&Screen {
            id: Uuid::from_u128(1),
            kind: Screen::KIND.to_owned(),
            slug: Slug::new("login-form").unwrap(),
            title: "Login form".to_owned(),
            purpose: "Collects credentials.".to_owned(),
            states: Vec::new(),
            acceptance: Vec::new(),
            design_ref: None,
            backed_by: Vec::new(),
        })
        .unwrap();

    let text = std::fs::read_to_string(store.screen_path(Uuid::from_u128(1))).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["kind"], "screen");
    assert_eq!(
        load_project(directory.path())
            .unwrap()
            .graph
            .screens()
            .count(),
        1
    );
}
