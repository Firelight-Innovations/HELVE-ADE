//! The MCP servers this build hosts.
//!
//! One module each, owning its tool descriptors, schemas and handler, and
//! declaring a single `pub static SERVER` for [`seed`] to register.
//!
//! ## Before adding one
//!
//! **If the harness can already do it, it does not get a server.** No file
//! reading, writing or listing, no search, no git. Every agent worth pointing at
//! OpenKaava arrives with those, and a second worse copy costs a permission surface
//! and a pile of tool descriptions competing for the model's attention.
//!
//! What earns a server is something that exists only inside OpenKaava and has no
//! filesystem equivalent — Schematify's design model is the first real case, because
//! an agent cannot read a graph's *boundaries* by opening a file. [`debug`] is
//! the second, [`design`] the third and [`ui`] the fourth. Each module's own doc
//! says which fact about it earns its place, and — for the two that write —
//! which fact decides its gate, because "it writes" is not on its own one.

pub mod debug;
pub mod design;
pub mod echo;
pub mod ui;

use super::Registry;

/// Register every server this build hosts, in the order settings lists them.
///
/// The echo server is registered unconditionally, release included, because a
/// feature whose whole surface is compiled out cannot be verified by the person
/// who most needs to verify it. Now that real servers have landed this is the
/// line that should grow a `cfg` — left alone so that switching echo off is its
/// own decision rather than a side effect of adding something beside it.
///
/// `debug` is likewise unconditional, and for a reason that will outlast echo's:
/// the builds worth debugging include the release one. A shipped OpenKaava that
/// misbehaves on a machine none of us have is exactly the case where reading its
/// layout and its failures is worth the most, and a server compiled out of that
/// build cannot answer.
///
/// `design` ships for the ordinary user rather than for us — the comments it
/// serves are theirs, left in a release build — which is why it is the one write
/// surface with no gate. `ui` ships too and is the one that can click; what makes
/// that safe is not a `cfg` but `dev_only`, a gate the tests below can hold to
/// account where a missing module cannot.
pub fn seed(registry: &Registry) {
    registry.register(&echo::SERVER);
    registry.register(&debug::SERVER);
    registry.register(&design::SERVER);
    registry.register(&ui::SERVER);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeding_registers_every_server_this_build_hosts() {
        let registry = Registry::default();
        seed(&registry);

        let ids: Vec<String> = registry.list(true).into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["echo", "debug", "design", "ui"]);
    }

    /// Every ordinary server is usable the moment OpenKaava starts. The one that
    /// can click is not, and no amount of the rest being convenient is a reason
    /// to make it so.
    #[test]
    fn an_ordinary_server_starts_on_and_the_developer_only_one_starts_off() {
        let registry = Registry::default();
        seed(&registry);

        for server in registry.list(true) {
            assert_eq!(
                server.enabled, !server.dev_only,
                "{} starts in the wrong state",
                server.id
            );
        }
    }

    /// With developer mode off, the shipped build looks exactly as it did before
    /// the UI server existed. This is the assertion that would fail if a future
    /// change leaked it into the ordinary list.
    ///
    /// `design` is in this list and is meant to be: it is the one write surface
    /// an ordinary user is supposed to have, for the reasons in its module doc.
    #[test]
    fn a_default_install_sees_every_server_except_the_one_that_can_click() {
        let registry = Registry::default();
        seed(&registry);

        let ids: Vec<String> = registry.list(false).into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["echo", "debug", "design"]);
        assert_eq!(registry.enabled_ids(false), vec!["echo", "debug", "design"]);
    }

    /// The id reaches two places a typo would not be caught in: a URL path and a
    /// key in the user's own `.mcp.json`.
    #[test]
    fn each_server_gets_a_namespaced_key_and_route() {
        let registry = Registry::default();
        seed(&registry);

        for server in registry.list(true) {
            assert_eq!(server.config_key, format!("kaava-{}", server.id));
            assert_eq!(server.path, format!("/mcp/{}", server.id));
        }
    }

    /// Seeding twice is what a re-seed after a settings change would do, and it
    /// must not double the list.
    #[test]
    fn seeding_is_idempotent() {
        let registry = Registry::default();
        seed(&registry);
        seed(&registry);

        assert_eq!(registry.list(true).len(), 4);
    }

    /// Held against the servers this build actually registers, not against a
    /// fixture. `registry.rs` has the same check over its own test doubles,
    /// which proves the rule and not the shipped set — and the shipped set is
    /// the one where an id becomes a URL path (`/mcp/<id>`) and a `.mcp.json`
    /// key (`kaava-<id>`). The same rule `kaava-tool-manifest` holds tool ids
    /// to, for the same reason.
    #[test]
    fn every_registered_server_id_is_url_safe() {
        let registry = Registry::default();
        seed(&registry);

        for server in registry.list(true) {
            let mut chars = server.id.chars();
            assert!(
                matches!(chars.next(), Some(c) if c.is_ascii_lowercase()),
                "server id {:?} must start with a lowercase letter",
                server.id
            );
            assert!(
                chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "server id {:?} must match ^[a-z][a-z0-9-]*$",
                server.id
            );
        }
    }
}
