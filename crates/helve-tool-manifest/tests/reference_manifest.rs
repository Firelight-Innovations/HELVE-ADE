//! Parses the reference tool's real `helve-tool.toml` off disk.
//!
//! The unit tests in `lib.rs` assert against a copy of that document pasted
//! into the test file, which proves the parser agrees with itself but not
//! that it agrees with `examples/echo-tool`. Those two are written by
//! different hands and drift apart quietly: the schema gains a required key,
//! the example doesn't, and nothing notices until a tool repo copies the
//! example and fails to load. This test reads the actual file, so the example
//! and the schema can only ever be wrong together.

use helve_tool_manifest::ToolManifest;
use std::path::PathBuf;

fn echo_tool_checkout() -> PathBuf {
    // `CARGO_MANIFEST_DIR` is this crate's directory, so the example is two
    // levels up and back down. Resolved at compile time, which means moving
    // either directory breaks the build rather than the test at runtime.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/echo-tool")
}

#[test]
fn reference_tool_manifest_loads_from_disk() {
    let checkout = echo_tool_checkout();
    let manifest = ToolManifest::load(&checkout)
        .unwrap_or_else(|e| panic!("examples/echo-tool/helve-tool.toml should load: {e}"));

    // `id` has to match the `[[tool]]` entry the stack manifest would carry,
    // and the protocol says the host rejects a tool whose `helve/hello` reply
    // disagrees with this — so it is the one field with two sources of truth.
    assert_eq!(manifest.tool.id, "echo");
    assert_eq!(manifest.core.args, vec!["--helve-rpc".to_string()]);
    assert!(manifest.frontend.dev_url.is_some());
}

#[test]
fn reference_tool_frontend_path_stays_inside_the_checkout() {
    let checkout = echo_tool_checkout();
    let manifest = ToolManifest::load(&checkout).unwrap();

    // `load` already rejects an escaping path, so this is really asserting
    // that the example models the thing tool authors should copy.
    let dist = manifest.resolve_dist(&checkout);
    assert!(
        dist.starts_with(&checkout),
        "dist escaped: {}",
        dist.display()
    );
}
