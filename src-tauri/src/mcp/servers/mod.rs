//! The MCP servers this build hosts.
//!
//! One module each, owning its tool descriptors, schemas and handler, and
//! declaring a single `pub static SERVER` for [`seed`] to register.
//!
//! ## Before adding one
//!
//! **If the harness can already do it, it does not get a server.** No file
//! reading, writing or listing, no search, no git. Every agent worth pointing at
//! HELVE arrives with those, and a second worse copy costs a permission surface
//! and a pile of tool descriptions competing for the model's attention against
//! its own.
//!
//! What earns a server is something that exists only inside HELVE and has no
//! filesystem equivalent — Forger's design model is the first real case, because
//! an agent cannot read a spec's *boundaries* by opening a file.

pub mod echo;

use super::Registry;

/// Register every server this build hosts, in the order settings lists them.
///
/// The echo server is registered unconditionally, release included, because a
/// feature whose whole surface is compiled out cannot be verified by the person
/// who most needs to verify it. Once a real server lands, this is the line that
/// should grow a `cfg` rather than shipping a diagnostic tool forever.
pub fn seed(registry: &Registry) {
    registry.register(&echo::SERVER);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeding_registers_the_echo_server_switched_on() {
        let registry = Registry::default();
        seed(&registry);

        let listed = registry.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "echo");
        assert!(listed[0].enabled);
        assert_eq!(listed[0].config_key, "helve-echo");
        assert_eq!(listed[0].path, "/mcp/echo");
    }

    /// Seeding twice is what a re-seed after a settings change would do, and it
    /// must not double the list.
    #[test]
    fn seeding_is_idempotent() {
        let registry = Registry::default();
        seed(&registry);
        seed(&registry);

        assert_eq!(registry.list().len(), 1);
    }

    /// Held against the servers this build actually registers, not against a
    /// fixture. `registry.rs` has the same check over its own test doubles,
    /// which proves the rule and not the shipped set — and the shipped set is
    /// the one where an id becomes a URL path (`/mcp/<id>`) and a `.mcp.json`
    /// key (`helve-<id>`). The same rule `helve-tool-manifest` holds tool ids
    /// to, for the same reason.
    #[test]
    fn every_registered_server_id_is_url_safe() {
        let registry = Registry::default();
        seed(&registry);

        for server in registry.list() {
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
