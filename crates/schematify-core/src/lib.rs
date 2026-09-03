//! The Schematify design graph, as data.
//!
//! Schematify holds one software project's plan as typed JSON on disk, one
//! node per file, with no index. This crate is that model and nothing above
//! it: the schemas of PRD section 5, the identity scheme of section 3, the
//! storage layout of section 6, the loader of section 6.4, and the lifecycle
//! rules of section 7 as pure functions. No Tauri command lives here, and
//! wave 2 wires the commands to these types.
//!
//! **A node is an envelope plus an open map.** The tagged-enum alternative
//! was tried and rejected: PRD section 11.2 lets a user register a node kind
//! this crate has never heard of, and a closed enum turns that file into a
//! parse failure at load. `node.rs` carries the rest of that argument.
//!
//! **No count is ever stored.** PRD section 0.4 is a storage rule as much as
//! a drawing rule, so `facet_count` is [`Graph::facet_count`] and not a field.

// A published library surface, which `src-tauri` is not. The root Cargo.toml
// says why these two sit here rather than in [workspace.lints].
#![warn(missing_docs)]
#![warn(unreachable_pub)]

mod atomic;
mod brief;
mod decision;
mod edge;
mod error;
mod graph;
mod id;
mod layout;
mod lifecycle;
mod load;
#[cfg(test)]
mod load_tests;
mod node;
mod product;
mod registry;
mod run;
mod slug;
mod store;
mod uri;

pub use atomic::{write_json_atomic, AtomicWriteError};
pub use brief::{ProjectBrief, SuccessMetric};
pub use decision::{Decision, DecisionStatus};
pub use edge::{Edge, EdgeKind, EdgeTier};
pub use error::{CoreError, Result};
pub use graph::Graph;
pub use id::{id_timestamp_ms, mint_id, IdMinter};
pub use layout::{Layout, Placement};
pub use lifecycle::{
    check_transition, contract_fields_changed, stale_cascade, transition_table, transitions_from,
    Actor, AuditRow, Lifecycle, LifecycleError, TransitionRule,
};
pub use load::{load_project, LoadOutcome, Quarantine, QuarantineReason, ReadProblem, Report};
pub use node::{
    BudgetFields, BudgetTier, CommentFields, ContractMethodFields, DocAudience, DocBlockFields,
    ExternalDepFields, GroupFields, Layer, ModuleFields, Node, NodeEnvelope, NodeKind, Probe,
    ServiceFields, TestCaseFields, TestStatus,
};
pub use product::{Flow, FlowStep, Screen};
pub use registry::{LibraryEntry, LibraryRegistry, Rule, Severity};
pub use run::{
    BudgetResult, LinterResult, ReconcileResult, RunArtifact, TestResult, RUN_SCHEMA_VERSION,
};
pub use slug::{Slug, SlugError, SlugIndex, SlugScope};
pub use store::{allowed_together, layer_of, Store, WriteLayer};
pub use uri::{Uri, UriError, UriKind};

// Every identifier in this crate is a `uuid::Uuid`, and a caller that holds a
// node cannot avoid naming the type. Re-exporting it means a consumer depends
// on the version this crate resolved rather than declaring its own and
// discovering at a type error that the two do not match.
pub use uuid::Uuid;
