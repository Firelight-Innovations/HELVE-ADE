//! The eight lifecycle states of PRD section 7, and the rules over them.
//!
//! Everything here is a pure function over the graph. Enforcement happens at
//! the Tauri command boundary in wave 10, and the rules live here so the wave
//! that enforces them does not also get to define them. That split is what
//! makes the human-only gate testable without a window.
//!
//! Three rules carry the weight:
//!
//! - The transition table below is closed. No transition outside it is legal.
//! - [`Lifecycle::Accepted`] is reachable by a person alone. An agent that
//!   asks for it is refused, and the dashboard states the guarantee: no agent
//!   row in the log can read `reviewed` to `accepted`.
//! - A contract change drops every dependent from `accepted` to `stale`, and a
//!   human re-review is the only thing that resolves it.

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::graph::Graph;
use crate::node::{Node, NodeKind};

/// Where a node sits on the review path.
///
/// Six states sit on the path, and `stale` and `deprecated` sit outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    /// Being written. Nothing downstream should read it yet.
    Draft,
    /// Complete enough to hand out.
    Specified,
    /// Handed to an agent.
    Assigned,
    /// Every declared test is linked to code.
    Implemented,
    /// A reviewer has it open.
    Reviewed,
    /// A reviewer accepted it.
    Accepted,
    /// Accepted, then an upstream contract changed under it.
    Stale,
    /// Superseded. Nothing is ever deleted, so this is where a node retires.
    Deprecated,
}

impl Lifecycle {
    /// The word this state writes into JSON and draws on a node face.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Specified => "specified",
            Self::Assigned => "assigned",
            Self::Implemented => "implemented",
            Self::Reviewed => "reviewed",
            Self::Accepted => "accepted",
            Self::Stale => "stale",
            Self::Deprecated => "deprecated",
        }
    }

    /// Every state, in the order PRD section 7.1 draws them.
    #[must_use]
    pub fn all() -> [Self; 8] {
        [
            Self::Draft,
            Self::Specified,
            Self::Assigned,
            Self::Implemented,
            Self::Reviewed,
            Self::Accepted,
            Self::Stale,
            Self::Deprecated,
        ]
    }
}

impl fmt::Display for Lifecycle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Who is asking.
///
/// `system` appears on one transition alone, the staleness drop, which no one
/// requests. `authored_by` on a node uses `human` and `agent` only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Actor {
    /// A person, holding a human token.
    Human,
    /// A coding agent, holding an agent token.
    Agent,
    /// Schematify itself, reacting to a change.
    System,
}

impl Actor {
    /// The word this actor writes into JSON and draws in an audit row.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Agent => "agent",
            Self::System => "system",
        }
    }
}

impl fmt::Display for Actor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One row of the PRD section 7.2 table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransitionRule {
    /// The state the node is in. `None` means any state, which is the `any` row.
    pub from: Option<Lifecycle>,
    /// The state the node moves to.
    pub to: Lifecycle,
    /// Who may make the move.
    pub actor: Actor,
    /// What causes it.
    pub trigger: &'static str,
}

/// The transition table of PRD section 7.2, in the order it is written.
///
/// The `any` row sits last, so a lookup that finds an explicit row prefers it.
/// Today no explicit row targets `deprecated`, and the ordering keeps that
/// true if one is ever added.
const TRANSITIONS: &[TransitionRule] = &[
    rule(Lifecycle::Draft, Lifecycle::Specified, Actor::Human, "The author completes the node"),
    rule(Lifecycle::Specified, Lifecycle::Assigned, Actor::Human, "The author hands the node to an agent"),
    rule(Lifecycle::Assigned, Lifecycle::Implemented, Actor::Agent, "The agent links every declared test"),
    rule(Lifecycle::Assigned, Lifecycle::Specified, Actor::Human, "The author withdraws the assignment"),
    rule(Lifecycle::Implemented, Lifecycle::Reviewed, Actor::Human, "The reviewer opens the node"),
    rule(Lifecycle::Implemented, Lifecycle::Specified, Actor::Human, "The reviewer returns the node before review"),
    rule(Lifecycle::Reviewed, Lifecycle::Accepted, Actor::Human, "The reviewer accepts the node"),
    rule(Lifecycle::Reviewed, Lifecycle::Specified, Actor::Human, "The reviewer returns the node with a reason"),
    rule(Lifecycle::Accepted, Lifecycle::Stale, Actor::System, "An upstream contract changes"),
    rule(Lifecycle::Stale, Lifecycle::Accepted, Actor::Human, "The reviewer re-reviews the node"),
    rule(Lifecycle::Stale, Lifecycle::Specified, Actor::Human, "The reviewer returns the node with a reason"),
    TransitionRule {
        from: None,
        to: Lifecycle::Deprecated,
        actor: Actor::Human,
        trigger: "The author supersedes the node",
    },
];

const fn rule(
    from: Lifecycle,
    to: Lifecycle,
    actor: Actor,
    trigger: &'static str,
) -> TransitionRule {
    TransitionRule {
        from: Some(from),
        to,
        actor,
        trigger,
    }
}

/// The whole transition table, for a surface that wants to draw it.
#[must_use]
pub fn transition_table() -> &'static [TransitionRule] {
    TRANSITIONS
}

/// Every state reachable from one state, with the actor each move needs.
#[must_use]
pub fn transitions_from(from: Lifecycle) -> Vec<TransitionRule> {
    TRANSITIONS
        .iter()
        .filter(|r| r.from.is_none_or(|f| f == from) && r.to != from)
        .copied()
        .collect()
}

/// Check one transition against the table and the actor.
///
/// # Errors
///
/// Returns [`LifecycleError::HumanOnly`] when an agent asks for a transition a
/// person owns, which is PRD section 7.3, and
/// [`LifecycleError::IllegalTransition`] when the table holds no such move.
/// The two are separate because the first is a permission failure a caller
/// reports to a person and the second is a bug.
pub fn check_transition(
    from: Lifecycle,
    to: Lifecycle,
    actor: Actor,
) -> Result<&'static TransitionRule, LifecycleError> {
    let explicit = TRANSITIONS.iter().find(|r| r.to == to && r.from == Some(from));
    let wildcard = TRANSITIONS.iter().find(|r| r.to == to && r.from.is_none());

    let Some(rule) = explicit.or(wildcard) else {
        return Err(LifecycleError::IllegalTransition { from, to });
    };

    if rule.actor == actor {
        return Ok(rule);
    }
    if rule.actor == Actor::Human && actor == Actor::Agent {
        return Err(LifecycleError::HumanOnly { from, to });
    }
    Err(LifecycleError::WrongActor {
        from,
        to,
        required: rule.actor,
        offered: actor,
    })
}

/// One row of `runs/<node-uuid>/audit.json`.
///
/// PRD section 7.2 appends one of these on every transition, and PRD section
/// 6.3 makes that append and the node write a single action the CI path gate
/// lets through.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditRow {
    /// The node that moved.
    pub node: Uuid,
    /// When, as an RFC 3339 timestamp.
    pub at: String,
    /// The state it left.
    pub from: Lifecycle,
    /// The state it entered.
    pub to: Lifecycle,
    /// Whether a person, an agent, or Schematify made the move.
    pub actor: Actor,
    /// The name drawn beside the actor, such as `m.ross` or `claude-sdd`.
    pub actor_name: String,
    /// Why.
    pub reason: String,
}

/// Whether an edit to a node changed its contract, per PRD section 7.4.
///
/// A contract change is a change to `signature`, `params`, `returns` or
/// `errors` on a `contract-method`, or to `exports` on a service. Nothing else
/// counts: a retitled method or an amended `semantics` paragraph does not
/// invalidate a downstream review, and treating it as if it did would train
/// reviewers to clear staleness without reading.
#[must_use]
pub fn contract_fields_changed(before: &Node, after: &Node) -> bool {
    match after.kind() {
        NodeKind::ContractMethod => ["signature", "params", "returns", "errors"]
            .iter()
            .any(|field| before.fields.get(*field) != after.fields.get(*field)),
        NodeKind::Service => before.fields.get("exports") != after.fields.get("exports"),
        _ => false,
    }
}

/// Which nodes a contract change drops from `accepted` to `stale`.
///
/// Direct dependents alone. The rule in PRD section 7.4 names the nodes with a
/// `depends_on` edge into the changed node, and a node that goes stale has had
/// no contract change of its own to propagate, so there is nothing to walk on
/// to. A transitive reading would mark a whole subtree stale on one signature
/// edit and make the state meaningless.
#[must_use]
pub fn stale_cascade(graph: &Graph, changed: Uuid) -> Vec<Uuid> {
    let mut owners = vec![changed];
    if let Some(node) = graph.node(changed) {
        // A facet's contract belongs to the module that holds it, and the
        // dependency edges are drawn between modules rather than between
        // facets, so the dependents of a changed method are the dependents of
        // its module.
        if node.kind().is_facet() {
            if let Some(parent) = node.envelope.parent {
                owners.push(parent);
            }
        }
    }

    let mut stale: Vec<Uuid> = owners
        .iter()
        .flat_map(|owner| graph.dependents(*owner))
        .filter(|id| {
            graph
                .node(*id)
                .is_some_and(|n| n.envelope.lifecycle == Lifecycle::Accepted)
        })
        .collect();
    stale.sort_unstable();
    stale.dedup();
    stale
}

/// Why a transition was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LifecycleError {
    /// The table holds no such move.
    #[error("illegal transition {from} to {to}: no such row in the lifecycle table")]
    IllegalTransition {
        /// The state the node is in.
        from: Lifecycle,
        /// The state that was asked for.
        to: Lifecycle,
    },

    /// PRD section 7.3: an agent asked for a transition a person owns.
    #[error("transition {from} to {to} is human-only: an agent token cannot make it")]
    HumanOnly {
        /// The state the node is in.
        from: Lifecycle,
        /// The state that was asked for.
        to: Lifecycle,
    },

    /// The move is legal, and not for this actor.
    #[error("transition {from} to {to} needs a {required} actor, not a {offered} one")]
    WrongActor {
        /// The state the node is in.
        from: Lifecycle,
        /// The state that was asked for.
        to: Lifecycle,
        /// Who the table says may make it.
        required: Actor,
        /// Who asked.
        offered: Actor,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every legal move, exactly as PRD section 7.2 writes them.
    const LEGAL: &[(Lifecycle, Lifecycle, Actor)] = &[
        (Lifecycle::Draft, Lifecycle::Specified, Actor::Human),
        (Lifecycle::Specified, Lifecycle::Assigned, Actor::Human),
        (Lifecycle::Assigned, Lifecycle::Implemented, Actor::Agent),
        (Lifecycle::Assigned, Lifecycle::Specified, Actor::Human),
        (Lifecycle::Implemented, Lifecycle::Reviewed, Actor::Human),
        (Lifecycle::Implemented, Lifecycle::Specified, Actor::Human),
        (Lifecycle::Reviewed, Lifecycle::Accepted, Actor::Human),
        (Lifecycle::Reviewed, Lifecycle::Specified, Actor::Human),
        (Lifecycle::Accepted, Lifecycle::Stale, Actor::System),
        (Lifecycle::Stale, Lifecycle::Accepted, Actor::Human),
        (Lifecycle::Stale, Lifecycle::Specified, Actor::Human),
    ];

    fn is_legal(from: Lifecycle, to: Lifecycle) -> bool {
        to == Lifecycle::Deprecated || LEGAL.iter().any(|(f, t, _)| *f == from && *t == to)
    }

    #[test]
    fn every_legal_transition_in_the_table_passes() {
        for (from, to, actor) in LEGAL {
            check_transition(*from, *to, *actor)
                .unwrap_or_else(|e| panic!("{from:?} to {to:?} should pass: {e}"));
        }
    }

    #[test]
    fn any_state_deprecates_by_a_human() {
        for from in Lifecycle::all() {
            if from == Lifecycle::Deprecated {
                continue;
            }
            check_transition(from, Lifecycle::Deprecated, Actor::Human).unwrap();
        }
    }

    #[test]
    fn every_illegal_transition_is_refused() {
        for from in Lifecycle::all() {
            for to in Lifecycle::all() {
                if from == to || is_legal(from, to) {
                    continue;
                }
                for actor in [Actor::Human, Actor::Agent, Actor::System] {
                    let result = check_transition(from, to, actor);
                    assert!(
                        matches!(result, Err(LifecycleError::IllegalTransition { .. })),
                        "{from:?} to {to:?} by {actor:?} should be illegal, got {result:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn an_agent_cannot_reach_accepted() {
        let err = check_transition(Lifecycle::Reviewed, Lifecycle::Accepted, Actor::Agent).unwrap_err();
        assert!(matches!(err, LifecycleError::HumanOnly { .. }));
        let from_stale =
            check_transition(Lifecycle::Stale, Lifecycle::Accepted, Actor::Agent).unwrap_err();
        assert!(matches!(from_stale, LifecycleError::HumanOnly { .. }));
    }

    #[test]
    fn an_agent_cannot_deprecate_and_cannot_withdraw_an_assignment() {
        for to in [Lifecycle::Deprecated, Lifecycle::Specified] {
            let err = check_transition(Lifecycle::Assigned, to, Actor::Agent).unwrap_err();
            assert!(matches!(err, LifecycleError::HumanOnly { .. }), "{to:?}");
        }
    }

    #[test]
    fn a_human_cannot_make_the_two_moves_a_human_does_not_own() {
        let implement =
            check_transition(Lifecycle::Assigned, Lifecycle::Implemented, Actor::Human).unwrap_err();
        assert!(matches!(implement, LifecycleError::WrongActor { .. }));
        let stale =
            check_transition(Lifecycle::Accepted, Lifecycle::Stale, Actor::Human).unwrap_err();
        assert!(matches!(stale, LifecycleError::WrongActor { .. }));
    }

    #[test]
    fn the_table_lists_every_row_of_the_prd() {
        assert_eq!(transition_table().len(), LEGAL.len() + 1);
        let from_reviewed = transitions_from(Lifecycle::Reviewed);
        let targets: Vec<Lifecycle> = from_reviewed.iter().map(|r| r.to).collect();
        assert!(targets.contains(&Lifecycle::Accepted));
        assert!(targets.contains(&Lifecycle::Specified));
        assert!(targets.contains(&Lifecycle::Deprecated));
        assert_eq!(targets.len(), 3);
    }

    #[test]
    fn a_state_writes_its_own_word() {
        assert_eq!(Lifecycle::Accepted.as_str(), "accepted");
        assert_eq!(
            serde_json::to_string(&Lifecycle::Deprecated).unwrap(),
            "\"deprecated\""
        );
        assert_eq!(serde_json::to_string(&Actor::Agent).unwrap(), "\"agent\"");
    }

    #[test]
    fn an_audit_row_round_trips() {
        let row = AuditRow {
            node: Uuid::from_u128(1),
            at: "2026-08-25T14:02:00Z".to_owned(),
            from: Lifecycle::Reviewed,
            to: Lifecycle::Accepted,
            actor: Actor::Human,
            actor_name: "m.ross".to_owned(),
            reason: "Result type resolves the ambiguity.".to_owned(),
        };
        let text = serde_json::to_string(&row).unwrap();
        assert_eq!(serde_json::from_str::<AuditRow>(&text).unwrap(), row);
    }
}
