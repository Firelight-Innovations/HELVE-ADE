//! The decision node of PRD section 5.9, and the append-only rule over it.
//!
//! The decision log moved inside Schematify: `FORGER-SPEC.md` section 1 put it
//! in a separate application, and decision SCH-SCO-003 supersedes that. What
//! came with it is the Veistra change rule, stricter than the rest of the
//! graph. A decision row is never edited in place and never removed. A change
//! adds a row and marks the prior one superseded, so the reasoning that was
//! live when a node was built stays readable afterwards.
//!
//! The slug is structured, `DEC-<AREA>-<TOPIC>-<NNN>`, and it is a slug rather
//! than an identifier. PRD section 3.1 bans a structured `id` and permits a
//! structured slug; section 3.3 keeps them apart in the interface too, where
//! `schematify://decision/<uuid>` is stored and `DEC-TEC-AUTH-004` is drawn.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::slug::Slug;

/// Whether a decision still stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DecisionStatus {
    /// The decision stands.
    #[serde(rename = "ACTIVE")]
    Active,
    /// A later decision replaced it. `superseded_by` names which.
    #[serde(rename = "SUPERSEDED")]
    Superseded,
}

/// One entry in the decision log.
///
/// Closed to unknown fields for the reason [`crate::Screen`] gives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    /// The UUIDv7 every reference stores.
    pub id: Uuid,
    /// Always `decision`, per PRD section 5.9.
    #[serde(default = "decision_kind")]
    pub kind: String,
    /// The structured, drawn name, such as `DEC-TEC-AUTH-004`.
    pub slug: Slug,
    /// What was decided, in one line.
    pub title: String,
    /// What the situation was beforehand.
    pub context: String,
    /// The decision itself.
    pub decision: String,
    /// What it costs.
    pub consequences: String,
    /// Whether it still stands.
    pub status: DecisionStatus,
    /// The decision this one replaces.
    #[serde(default)]
    pub supersedes: Option<Uuid>,
    /// The decision that replaced this one.
    #[serde(default)]
    pub superseded_by: Option<Uuid>,
    /// The date it was taken, as `YYYY-MM-DD`.
    pub date: String,
}

fn decision_kind() -> String {
    Decision::KIND.to_owned()
}

impl Decision {
    /// The word a decision file writes into its `kind` field.
    pub const KIND: &str = "decision";

    /// Whether this row breaks linter rule L07.
    ///
    /// A row marked superseded with no successor is a dead end: it tells a
    /// reader the reasoning was replaced and gives them nowhere to go.
    #[must_use]
    pub fn is_superseded_without_successor(&self) -> bool {
        self.status == DecisionStatus::Superseded && self.superseded_by.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Decision {
        Decision {
            id: Uuid::from_u128(1),
            kind: Decision::KIND.to_owned(),
            slug: Slug::new("DEC-TEC-AUTH-004").unwrap(),
            title: "Verify signatures against a rotating key set".to_owned(),
            context: "The prior design pinned one signing key.".to_owned(),
            decision: "Schematify shall verify against the published key set.".to_owned(),
            consequences: "Key rotation adds a network fetch to the cold path.".to_owned(),
            status: DecisionStatus::Active,
            supersedes: None,
            superseded_by: None,
            date: "2026-08-19".to_owned(),
        }
    }

    #[test]
    fn a_decision_round_trips() {
        let decision = sample();
        let text = serde_json::to_string(&decision).unwrap();
        assert_eq!(serde_json::from_str::<Decision>(&text).unwrap(), decision);
    }

    #[test]
    fn the_status_is_written_in_the_upper_case_the_prd_draws() {
        let value = serde_json::to_value(sample()).unwrap();
        assert_eq!(value["status"], "ACTIVE");
        assert_eq!(value["slug"], "DEC-TEC-AUTH-004");
    }

    #[test]
    fn a_superseded_row_without_a_successor_is_flagged() {
        let mut decision = sample();
        decision.status = DecisionStatus::Superseded;
        assert!(decision.is_superseded_without_successor());
        decision.superseded_by = Some(Uuid::from_u128(2));
        assert!(!decision.is_superseded_without_successor());
    }

    #[test]
    fn an_active_row_is_never_flagged() {
        assert!(!sample().is_superseded_without_successor());
    }
}
