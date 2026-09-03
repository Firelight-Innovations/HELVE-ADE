//! End-to-end tests that spawn the real `kaava` binary, per
//! `SCHEMATIFY-PRD.md` section 9.3 and Wave 9's acceptance condition: "A
//! duplicate marker token produces an error and exit code 1." `CARGO_BIN_EXE_
//! <name>` is a cargo-provided environment variable naming the just-built
//! binary for an integration test — no extra dependency needed to find or
//! run it.

use std::fs;
use std::path::Path;
use std::process::Command;

fn kaava_bin() -> &'static str {
    env!("CARGO_BIN_EXE_kaava")
}

// A test fixture helper, not itself a `#[test]` fn, so clippy.toml's
// `allow-unwrap-in-tests` does not reach it automatically.
#[allow(clippy::unwrap_used)]
fn write_node(nodes_dir: &Path, id: &str, slug: &str, kind: &str, lifecycle: &str) {
    let content = format!(
        r#"{{
            "id": "{id}",
            "slug": "{slug}",
            "kind": "{kind}",
            "title": "Title",
            "description": "Description",
            "lifecycle": "{lifecycle}",
            "authored_by": "human",
            "created": "2026-08-25T00:00:00Z",
            "superseded_by": null
        }}"#
    );
    fs::write(nodes_dir.join(format!("{id}.json")), content).unwrap();
}

#[test]
fn duplicate_marker_token_exits_1() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let nodes_dir = root.join(".kaava").join("nodes");
    fs::create_dir_all(&nodes_dir).unwrap();

    let id = "0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8";
    write_node(
        &nodes_dir,
        id,
        "thing.run",
        "contract-method",
        "implemented",
    );

    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/a.rs"), format!("// @kaava:{id} thing.run\n")).unwrap();
    fs::write(root.join("src/b.rs"), format!("// @kaava:{id} thing.run\n")).unwrap();

    let output = Command::new(kaava_bin())
        .arg("reconcile")
        .arg("--root")
        .arg(root)
        .output()
        .expect("kaava reconcile should run");

    assert_eq!(
        output.status.code(),
        Some(1),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let written = fs::read_to_string(root.join("runs").join(id).join("reconcile.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&written).unwrap();
    assert_eq!(value["outcome"], "duplicate");
}

#[test]
fn clean_project_exits_0() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let nodes_dir = root.join(".kaava").join("nodes");
    fs::create_dir_all(&nodes_dir).unwrap();

    let id = "0192f4a2-4c3d-7890-a1b2-c3d4e5f6a7b8";
    write_node(
        &nodes_dir,
        id,
        "thing.run",
        "contract-method",
        "implemented",
    );
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/a.rs"), format!("// @kaava:{id} thing.run\n")).unwrap();

    let output = Command::new(kaava_bin())
        .arg("reconcile")
        .arg("--root")
        .arg(root)
        .output()
        .expect("kaava reconcile should run");

    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn missing_project_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    let output = Command::new(kaava_bin())
        .arg("reconcile")
        .arg("--root")
        .arg(root)
        .output()
        .expect("kaava reconcile should run");

    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn json_format_writes_a_parseable_report_to_out() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let nodes_dir = root.join(".kaava").join("nodes");
    fs::create_dir_all(&nodes_dir).unwrap();
    let id = "0192f4a3-4c3d-7890-a1b2-c3d4e5f6a7b8";
    write_node(
        &nodes_dir,
        id,
        "thing.run",
        "contract-method",
        "implemented",
    );
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/a.rs"), format!("// @kaava:{id} thing.run\n")).unwrap();

    let out_path = root.join("report.json");
    let status = Command::new(kaava_bin())
        .arg("reconcile")
        .arg("--root")
        .arg(root)
        .arg("--out")
        .arg(&out_path)
        .arg("--format")
        .arg("json")
        .status()
        .expect("kaava reconcile should run");

    assert_eq!(status.code(), Some(0));
    let content = fs::read_to_string(&out_path).unwrap();
    let value: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(value["summary"]["matched"], 1);
}
