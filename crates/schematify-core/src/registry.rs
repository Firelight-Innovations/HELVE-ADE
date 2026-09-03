//! The rule registry and the library registry of PRD sections 5.10 and 10.
//!
//! These two are registries rather than nodes, and they behave differently
//! from each other on disk. A rule is one file per entry like everything else.
//! The library registry is one file holding an array, and it is the stated
//! exception to the one-node-per-file rule: PRD section 10.3 derives the whole
//! tech-stack view from it, and a derivation that has to open two hundred
//! files to answer "which modules use jose" is a derivation nobody runs.
//!
//! License enforcement runs at design time, which is what makes the registry
//! worth a file of its own. A GPL dependency is a blocked add while somebody
//! is drawing, rather than a legal finding after a release.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::lifecycle::AuditRow;
use crate::slug::Slug;

/// What a rule violation costs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The build stops.
    Error,
    /// The build continues and says so.
    Warning,
    /// A person looks at it.
    Review,
}

/// One code standard an agent follows on the target project.
///
/// Closed to unknown fields for the reason [`crate::Screen`] gives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    /// The UUIDv7 every reference stores.
    pub id: Uuid,
    /// The name, unique across the rule registry.
    pub slug: Slug,
    /// The rule, in one sentence.
    pub statement: String,
    /// The command that enforces it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// The marker token that locates its implementation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<String>,
    /// What a violation costs.
    pub severity: Severity,
    /// This rule's own history.
    #[serde(default)]
    pub audit: Vec<AuditRow>,
}

/// One approved external library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LibraryEntry {
    /// The UUIDv7 a module's `allowed_libraries` array stores.
    pub id: Uuid,
    /// The package name, as the ecosystem spells it.
    pub name: String,
    /// The pinned version.
    pub version: String,
    /// The license, as an SPDX identifier.
    pub license: String,
    /// Why this library is approved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    /// The decision that approved it.
    #[serde(default)]
    pub decision: Option<Uuid>,
}

/// The whole of `registry/libraries.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LibraryRegistry {
    /// Every approved library, in one global list.
    #[serde(default)]
    pub libraries: Vec<LibraryEntry>,
}

impl LibraryRegistry {
    /// Look up one entry by identifier.
    #[must_use]
    pub fn get(&self, id: Uuid) -> Option<&LibraryEntry> {
        self.libraries.iter().find(|entry| entry.id == id)
    }

    /// Whether an identifier names an approved library.
    ///
    /// Linter rule L04 is this question asked of every entry in every module's
    /// `allowed_libraries` array.
    #[must_use]
    pub fn contains(&self, id: Uuid) -> bool {
        self.get(id).is_some()
    }

    /// Look up one entry by package name.
    #[must_use]
    pub fn by_name(&self, name: &str) -> Option<&LibraryEntry> {
        self.libraries.iter().find(|entry| entry.name == name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::{Actor, Lifecycle};

    fn library() -> LibraryEntry {
        LibraryEntry {
            id: Uuid::from_u128(1),
            name: "jose".to_owned(),
            version: "5.2.4".to_owned(),
            license: "MIT".to_owned(),
            rationale: Some("JWT verification without a hand-rolled parser.".to_owned()),
            decision: Some(Uuid::from_u128(2)),
        }
    }

    #[test]
    fn a_rule_round_trips_with_its_audit_history() {
        let rule = Rule {
            id: Uuid::from_u128(1),
            slug: Slug::new("no-unwrap").unwrap(),
            statement: "No unwrap on anything that touches the filesystem.".to_owned(),
            command: Some("cargo clippy".to_owned()),
            marker: Some("@kaava:0192f4a1".to_owned()),
            severity: Severity::Error,
            audit: vec![AuditRow {
                node: Uuid::from_u128(1),
                at: "2026-08-25T00:00:00Z".to_owned(),
                from: Lifecycle::Draft,
                to: Lifecycle::Specified,
                actor: Actor::Human,
                actor_name: "m.ross".to_owned(),
                reason: "Written up.".to_owned(),
            }],
        };
        let text = serde_json::to_string(&rule).unwrap();
        assert_eq!(serde_json::from_str::<Rule>(&text).unwrap(), rule);
    }

    #[test]
    fn the_registry_round_trips_as_one_object_holding_an_array() {
        let registry = LibraryRegistry {
            libraries: vec![library()],
        };
        let value = serde_json::to_value(&registry).unwrap();
        assert!(value["libraries"].is_array());
        let text = serde_json::to_string(&registry).unwrap();
        assert_eq!(
            serde_json::from_str::<LibraryRegistry>(&text).unwrap(),
            registry
        );
    }

    #[test]
    fn the_registry_answers_the_question_rule_l04_asks() {
        let registry = LibraryRegistry {
            libraries: vec![library()],
        };
        assert!(registry.contains(Uuid::from_u128(1)));
        assert!(!registry.contains(Uuid::from_u128(99)));
        assert_eq!(
            registry.by_name("jose").map(|e| e.version.as_str()),
            Some("5.2.4")
        );
        assert!(registry.by_name("left-pad").is_none());
    }

    #[test]
    fn an_empty_registry_parses_from_an_empty_object() {
        let registry: LibraryRegistry = serde_json::from_str("{}").unwrap();
        assert!(registry.libraries.is_empty());
    }

    #[test]
    fn every_severity_writes_its_word() {
        assert_eq!(
            serde_json::to_string(&Severity::Error).unwrap(),
            "\"error\""
        );
        assert_eq!(
            serde_json::to_string(&Severity::Warning).unwrap(),
            "\"warning\""
        );
        assert_eq!(
            serde_json::to_string(&Severity::Review).unwrap(),
            "\"review\""
        );
    }
}
