//! The product layer: the screen of PRD section 5.7 and the flow of 5.8.
//!
//! Schematify holds no visual design. A screen carries a name, a purpose, a
//! state list, acceptance conditions, and a link out to a design artifact; the
//! pixels live in Claude Design. That boundary is why `design_ref` is a plain
//! string holding an external URL rather than a `schematify://` reference: it
//! points outside this graph on purpose, and typing it as a Schematify
//! reference would promise a resolver that cannot exist.
//!
//! A screen is backed by modules and a flow is a sequence of screens, so the
//! product layer joins the technical one at exactly two places and nowhere
//! else.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::slug::Slug;
use crate::uri::Uri;

/// One product screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Screen {
    /// The UUIDv7 every reference stores.
    pub id: Uuid,
    /// The name, unique across the screen collection.
    pub slug: Slug,
    /// The name drawn on the screen entry.
    pub title: String,
    /// What the screen is for.
    pub purpose: String,
    /// The states the screen can be in.
    #[serde(default)]
    pub states: Vec<String>,
    /// What has to be true for the screen to be done.
    #[serde(default)]
    pub acceptance: Vec<String>,
    /// A link to the external design artifact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design_ref: Option<String>,
    /// The modules that back this screen.
    #[serde(default)]
    pub backed_by: Vec<Uri>,
}

/// One step of a flow: a screen, and what happens on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlowStep {
    /// The screen this step happens on.
    pub screen: Uri,
    /// What the person does.
    pub action: String,
}

/// One product flow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Flow {
    /// The UUIDv7 every reference stores.
    pub id: Uuid,
    /// The name, unique across the flow collection.
    pub slug: Slug,
    /// The name drawn on the flow entry.
    pub title: String,
    /// What starts the flow.
    pub trigger: String,
    /// The steps, in order.
    #[serde(default)]
    pub steps: Vec<FlowStep>,
    /// Where the person ends up.
    pub outcome: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::uri::UriKind;

    #[test]
    fn a_screen_round_trips() {
        let screen = Screen {
            id: Uuid::from_u128(1),
            slug: Slug::new("login-form").unwrap(),
            title: "Login form".to_owned(),
            purpose: "Collects credentials and starts a session.".to_owned(),
            states: vec!["empty".to_owned(), "locked".to_owned()],
            acceptance: vec!["A locked account shall show the recovery path.".to_owned()],
            design_ref: Some("https://claude.ai/design/p/x?file=y".to_owned()),
            backed_by: vec![Uri::node(Uuid::from_u128(2))],
        };
        let text = serde_json::to_string(&screen).unwrap();
        assert_eq!(serde_json::from_str::<Screen>(&text).unwrap(), screen);
    }

    #[test]
    fn a_flow_round_trips_with_its_steps() {
        let flow = Flow {
            id: Uuid::from_u128(1),
            slug: Slug::new("first-run-signup").unwrap(),
            title: "First-run signup".to_owned(),
            trigger: "A visitor opens the product with no account.".to_owned(),
            steps: vec![FlowStep {
                screen: Uri::screen(Uuid::from_u128(2)),
                action: "The visitor enters an email address.".to_owned(),
            }],
            outcome: "The visitor holds an active session.".to_owned(),
        };
        let text = serde_json::to_string(&flow).unwrap();
        let back: Flow = serde_json::from_str(&text).unwrap();
        assert_eq!(back, flow);
        assert_eq!(back.steps[0].screen.kind, UriKind::Screen);
    }

    #[test]
    fn a_screen_with_no_design_reference_omits_the_field() {
        let screen = Screen {
            id: Uuid::from_u128(1),
            slug: Slug::new("empty-state").unwrap(),
            title: "Empty state".to_owned(),
            purpose: "Nothing yet.".to_owned(),
            states: Vec::new(),
            acceptance: Vec::new(),
            design_ref: None,
            backed_by: Vec::new(),
        };
        let value = serde_json::to_value(&screen).unwrap();
        assert!(!value.as_object().unwrap().contains_key("design_ref"));
    }
}
