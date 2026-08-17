//! Loading and validating `helve-tool.toml`, the per-tool run manifest.
//!
//! See `docs/tool-protocol.md` section 1 for the spec this implements. The
//! short version: every tool checkout carries one of these files, and it says
//! how to run the tool — its id, its frontend bundle, its core binary. Unknown
//! keys are a hard error rather than a warning, because a typo'd key that's
//! silently ignored is a bug that only shows up at runtime, and a couple of
//! the fields (`dist`, `bin`) are load-bearing for path safety: a tool is
//! third-party code, and nothing here should let its manifest point outside
//! its own checkout.

// Published contract — see the note in crates/helve-rpc/src/lib.rs.
#![warn(missing_docs)]
#![warn(unreachable_pub)]

use semver::Version;
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

/// A parsed and validated `helve-tool.toml`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolManifest {
    /// Who the tool is. The only section with a second source of truth: the
    /// `[[tool]]` entry in `helve.toml` has to agree with it.
    pub tool: ToolSection,
    /// Where the tool window points its iframe.
    pub frontend: FrontendSection,
    /// How to start the tool's core process.
    pub core: CoreSection,
}

/// `[tool]` — required. Identity, independent of how the tool runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolSection {
    /// Must match `^[a-z][a-z0-9-]*$`, and must equal both the `[[tool]]` id
    /// in `helve.toml` and the id the core returns from `helve/hello` — the
    /// host rejects the tool if the three disagree.
    pub id: String,
    /// Semver; anything else fails the parse. Nothing compares it against the
    /// version `helve.toml` pins. The pin decides what gets checked out, this
    /// is only what the checkout claims to be.
    pub version: Version,
}

/// `[frontend]` — required. Both keys describe the same UI, one built and one
/// live; which is used depends on the build of the shell, not on the manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontendSection {
    /// Built bundle, relative to the checkout root.
    pub dist: PathBuf,
    /// The tool's own dev server, consulted only by a dev build of the shell.
    pub dev_url: Option<String>,
}

/// `[core]` — required. The child process the shell speaks JSON-RPC to over
/// standard streams.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreSection {
    /// Relative to the checkout root. Never includes a platform extension —
    /// see `resolve_bin`.
    pub bin: PathBuf,
    /// Passed to the binary verbatim on spawn. Defaults to `["--helve-rpc"]`
    /// when the key is absent, which is the flag the protocol expects; set it
    /// only if the binary enters RPC mode some other way.
    pub args: Vec<String>,
}

/// Why a `helve-tool.toml` was rejected.
///
/// Every variant names the offending key and its value: the manifest is
/// written by a tool author who is not looking at this code, so the `Display`
/// text is meant to be surfaced as-is.
#[derive(Debug, Error)]
pub enum ManifestError {
    /// The file could not be read at all. A checkout with no manifest is not
    /// a tool, so this is an error rather than an empty default.
    #[error("could not read {path}: {source}")]
    Io {
        /// The full path tried, so the message names a file rather than a
        /// checkout whose layout the reader then has to guess.
        path: PathBuf,
        /// Separates "not cloned yet" from a permission or I/O failure the
        /// author has to go and fix.
        #[source]
        source: std::io::Error,
    },

    /// Malformed TOML, a missing required key, or an unknown one — the schema
    /// is `deny_unknown_fields`, so a typo'd key arrives here instead of being
    /// dropped.
    // Boxed because `toml::de::Error` carries a copy of the offending
    // document for its span-highlighting `Display` impl, which makes it much
    // larger than the other variants; boxing keeps `ManifestError` itself
    // cheap to move regardless of which variant it is.
    #[error("invalid helve-tool.toml: {0}")]
    Toml(Box<toml::de::Error>),

    /// `tool.id` is not `^[a-z][a-z0-9-]*$`. Ids end up as directory names and
    /// URL authorities, so the shape is checked before anything consumes one.
    #[error("invalid tool id {id:?}: must match ^[a-z][a-z0-9-]*$")]
    InvalidId {
        /// The id exactly as written, so the author can see the character.
        id: String,
    },

    /// `tool.version` is not semver. Checked at load rather than at first use,
    /// while the file that has to change is still the obvious thing to blame.
    #[error("invalid version {version:?}: {source}")]
    InvalidVersion {
        /// The string as written; there is no parsed value to report.
        version: String,
        /// What `semver` objected to, which is more use than "not semver".
        #[source]
        source: semver::Error,
    },

    /// A path key is rooted. Joined onto the checkout root such a path would
    /// discard the root entirely, which is the escape this crate exists for.
    #[error("{field} must be a relative path, but {path:?} is rooted")]
    PathNotRelative {
        /// The dotted key: `frontend.dist` or `core.bin`. `&'static str`
        /// because the validator only ever names keys it knows at compile time.
        field: &'static str,
        /// The value as the manifest wrote it, not as resolved.
        path: String,
    },

    /// A path key contains a `..` component anywhere in it. Rejected outright
    /// rather than normalized: a path that tried to leave is not one to guess at.
    #[error("{field} escapes the checkout root via a '..' component: {path:?}")]
    PathEscapesRoot {
        /// The dotted key that held the escaping path.
        field: &'static str,
        /// The value as written, `..` included, so the escape is visible.
        path: String,
    },

    /// A path key resolves to the checkout root itself. Legal as a path, but a
    /// `dist` of `""` would serve the whole checkout, `.git` and sources included.
    #[error("{field} must name something inside the checkout, but {path:?} is the checkout root")]
    PathIsRoot {
        /// The dotted key that named nothing.
        field: &'static str,
        /// The value as written — in practice `""`, `"."` or `"./"`.
        path: String,
    },

    /// Nothing exists at `core.bin`. Raised by `resolve_bin` against a real
    /// checkout, not by parsing; the usual cause is a tool that isn't built yet.
    #[error("core binary not found at {bin} or {bin_exe}")]
    BinNotFound {
        /// The absolute path from `core.bin`, tried first.
        bin: PathBuf,
        /// The same path with `.exe` appended, tried second. Both are named so
        /// the message doesn't look wrong on the platform that needs a suffix.
        bin_exe: PathBuf,
    },
}

impl ToolManifest {
    /// Read and validate the manifest at `<checkout_root>/helve-tool.toml`.
    pub fn load(checkout_root: &Path) -> Result<Self, ManifestError> {
        let path = checkout_root.join("helve-tool.toml");
        let raw = std::fs::read_to_string(&path).map_err(|source| ManifestError::Io {
            path: path.clone(),
            source,
        })?;
        Self::parse(&raw)
    }

    /// Parse and validate a manifest already in memory — the path taken by
    /// tests, and by any caller that already has the bytes (e.g. read as
    /// part of a bundle rather than off a standalone file).
    pub fn parse(source: &str) -> Result<Self, ManifestError> {
        let raw: RawManifest =
            toml::from_str(source).map_err(|err| ManifestError::Toml(Box::new(err)))?;

        validate_id(&raw.tool.id)?;
        let version =
            Version::parse(&raw.tool.version).map_err(|source| ManifestError::InvalidVersion {
                version: raw.tool.version.clone(),
                source,
            })?;

        let dist = validate_relative_path("frontend.dist", &raw.frontend.dist)?;
        let bin = validate_relative_path("core.bin", &raw.core.bin)?;

        Ok(ToolManifest {
            tool: ToolSection {
                id: raw.tool.id,
                version,
            },
            frontend: FrontendSection {
                dist,
                dev_url: raw.frontend.dev_url,
            },
            core: CoreSection {
                bin,
                args: raw.core.args,
            },
        })
    }

    /// The tool binary's absolute path inside a checkout, `.exe` resolved.
    ///
    /// Tries `bin` as written first, then `bin` with `.exe` appended. Both
    /// are tried on every platform, not just Windows: a cross-compiled
    /// artifact (building a Windows tool's binary on a Linux CI box, say) is
    /// a real case, and the cost of the extra check is one `exists()` call.
    pub fn resolve_bin(&self, checkout_root: &Path) -> Result<PathBuf, ManifestError> {
        let bin = checkout_root.join(&self.core.bin);
        if bin.is_file() {
            return Ok(bin);
        }

        // `set_extension` would *replace* an existing extension rather than
        // append one (`foo.bin` -> `foo.exe`), which is wrong here — `bin` is
        // conventionally extensionless, but appending onto the raw
        // `OsString` is correct either way.
        let mut exe_name = bin.clone().into_os_string();
        exe_name.push(".exe");
        let bin_exe = PathBuf::from(exe_name);
        if bin_exe.is_file() {
            return Ok(bin_exe);
        }

        Err(ManifestError::BinNotFound { bin, bin_exe })
    }

    /// The built frontend's absolute path inside a checkout.
    pub fn resolve_dist(&self, checkout_root: &Path) -> PathBuf {
        checkout_root.join(&self.frontend.dist)
    }
}

/// `id` matches `^[a-z][a-z0-9-]*$`. Hand-rolled rather than pulling in a
/// regex crate for one five-line check.
fn validate_id(id: &str) -> Result<(), ManifestError> {
    let mut chars = id.chars();
    let starts_ok = matches!(chars.next(), Some(c) if c.is_ascii_lowercase());
    let rest_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');

    if starts_ok && rest_ok {
        Ok(())
    } else {
        Err(ManifestError::InvalidId { id: id.to_string() })
    }
}

/// Reject anything that could put a resolved path outside the checkout root:
/// an absolute path, or a path containing a `..` component anywhere in it.
///
/// This is a security boundary rather than a style rule — `helve-tool.toml`
/// is authored by third-party tool code, and `dist`/`bin` end up joined onto
/// a trusted root and then read or executed.
fn validate_relative_path(field: &'static str, raw: &str) -> Result<PathBuf, ManifestError> {
    let path = Path::new(raw);

    // `Path::is_absolute` is platform-relative in a way that's a trap for a
    // security check: on Windows, `/etc/passwd` is `has_root() == true` but
    // `is_absolute() == false` (it's rooted but has no drive letter), so a
    // manifest built with forward slashes could sneak past an `is_absolute`
    // check on this platform. Looking at the first component directly treats
    // both a Unix-style root and a Windows drive prefix as rooted, regardless
    // of which platform we're running on.
    let is_rooted = matches!(
        path.components().next(),
        Some(Component::RootDir) | Some(Component::Prefix(_))
    );
    if is_rooted {
        return Err(ManifestError::PathNotRelative {
            field,
            path: raw.to_string(),
        });
    }

    if path.components().any(|c| c == Component::ParentDir) {
        return Err(ManifestError::PathEscapesRoot {
            field,
            path: raw.to_string(),
        });
    }

    // `""`, `"."` and `"./"` all stay inside the checkout, so the two checks
    // above pass them — but they resolve to the checkout root *itself*, which
    // is its own problem. A `dist` of `""` would point the scheme handler at
    // the whole checkout and serve `.git`, the tool's source, and anything
    // else sitting there. Requiring at least one real path segment closes
    // that without affecting any legitimate value.
    if !path.components().any(|c| matches!(c, Component::Normal(_))) {
        return Err(ManifestError::PathIsRoot {
            field,
            path: raw.to_string(),
        });
    }

    Ok(path.to_path_buf())
}

fn default_args() -> Vec<String> {
    vec!["--helve-rpc".to_string()]
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RawManifest {
    tool: RawTool,
    frontend: RawFrontend,
    core: RawCore,
    // `[permissions]` is reserved space: legal for the table to be present,
    // legal for it to hold anything, ignored either way. `toml::Value` (not
    // a `deny_unknown_fields` struct like its siblings) is what makes the
    // *contents* permissive while the section still has to parse as a table.
    #[serde(default)]
    #[allow(dead_code)] // kept only so an extra top-level key can't sneak in unnoticed
    permissions: Option<toml::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RawTool {
    id: String,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RawFrontend {
    dist: String,
    #[serde(default)]
    dev_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
struct RawCore {
    bin: String,
    #[serde(default = "default_args")]
    args: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reference tool's real manifest. Schema and example must not drift,
    /// so this is checked field by field rather than just "parses OK".
    const REFERENCE: &str = r#"
        [tool]
        id      = "echo"
        version = "0.1.0"

        [frontend]
        dist    = "ui/dist"
        dev-url = "http://localhost:5174"

        [core]
        bin  = "target/debug/helve-echo-tool"
        args = ["--helve-rpc"]
    "#;

    #[test]
    fn parses_reference_manifest() {
        let manifest = ToolManifest::parse(REFERENCE).expect("reference manifest should parse");

        assert_eq!(manifest.tool.id, "echo");
        assert_eq!(manifest.tool.version, Version::new(0, 1, 0));
        assert_eq!(manifest.frontend.dist, PathBuf::from("ui/dist"));
        assert_eq!(
            manifest.frontend.dev_url.as_deref(),
            Some("http://localhost:5174")
        );
        assert_eq!(
            manifest.core.bin,
            PathBuf::from("target/debug/helve-echo-tool")
        );
        assert_eq!(manifest.core.args, vec!["--helve-rpc".to_string()]);
    }

    #[test]
    fn args_default_when_absent() {
        let toml = r#"
            [tool]
            id = "echo"
            version = "0.1.0"

            [frontend]
            dist = "ui/dist"

            [core]
            bin = "target/debug/helve-echo-tool"
        "#;

        let manifest = ToolManifest::parse(toml).unwrap();
        assert_eq!(manifest.core.args, vec!["--helve-rpc".to_string()]);
        assert_eq!(manifest.frontend.dev_url, None);
    }

    #[test]
    fn permissions_section_is_optional_and_permissive() {
        let absent = r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "target/debug/helve-echo-tool"
        "#;
        assert!(ToolManifest::parse(absent).is_ok());

        let present = r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "target/debug/helve-echo-tool"
            [permissions]
            some-future-key = true
            another = ["a", "b"]
        "#;
        assert!(ToolManifest::parse(present).is_ok());
    }

    #[test]
    fn rejects_unknown_top_level_key() {
        let toml = r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "target/debug/helve-echo-tool"
            [nonsense]
            key = 1
        "#;

        assert!(matches!(
            ToolManifest::parse(toml),
            Err(ManifestError::Toml(_))
        ));
    }

    #[test]
    fn rejects_unknown_key_in_known_section() {
        let toml = r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            typo = "oops"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "target/debug/helve-echo-tool"
        "#;

        assert!(matches!(
            ToolManifest::parse(toml),
            Err(ManifestError::Toml(_))
        ));
    }

    #[test]
    fn rejects_invalid_id() {
        for bad in ["Echo", "1echo", "ec ho", "ec_ho", ""] {
            let toml = format!(
                r#"
                [tool]
                id = "{bad}"
                version = "0.1.0"
                [frontend]
                dist = "ui/dist"
                [core]
                bin = "target/debug/helve-echo-tool"
                "#
            );

            match ToolManifest::parse(&toml) {
                Err(ManifestError::InvalidId { id }) => assert_eq!(id, bad),
                other => panic!("expected InvalidId for {bad:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn rejects_invalid_version() {
        let toml = r#"
            [tool]
            id = "echo"
            version = "not-semver"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "target/debug/helve-echo-tool"
        "#;

        match ToolManifest::parse(toml) {
            Err(ManifestError::InvalidVersion { version, .. }) => {
                assert_eq!(version, "not-semver")
            }
            other => panic!("expected InvalidVersion, got {other:?}"),
        }
    }

    #[test]
    fn rejects_absolute_dist_path() {
        for absolute in ["/etc/passwd", "C:\\Windows\\System32"] {
            let toml = format!(
                r#"
                [tool]
                id = "echo"
                version = "0.1.0"
                [frontend]
                dist = "{}"
                [core]
                bin = "target/debug/helve-echo-tool"
                "#,
                absolute.replace('\\', "\\\\")
            );

            match ToolManifest::parse(&toml) {
                Err(ManifestError::PathNotRelative { field, .. }) => {
                    assert_eq!(field, "frontend.dist")
                }
                other => panic!("expected PathNotRelative for {absolute:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn rejects_dotdot_in_bin_path() {
        let toml = r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "../../etc/passwd"
        "#;

        match ToolManifest::parse(toml) {
            Err(ManifestError::PathEscapesRoot { field, .. }) => assert_eq!(field, "core.bin"),
            other => panic!("expected PathEscapesRoot, got {other:?}"),
        }
    }

    #[test]
    fn rejects_dotdot_buried_mid_path() {
        // A leading segment can look innocent while a later `..` still walks
        // back out of the checkout, so every component has to be checked —
        // not just whether the string starts with "..".
        let toml = r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            [frontend]
            dist = "ui/../../secrets"
            [core]
            bin = "target/debug/helve-echo-tool"
        "#;

        assert!(matches!(
            ToolManifest::parse(toml),
            Err(ManifestError::PathEscapesRoot { .. })
        ));
    }

    #[test]
    fn rejects_paths_that_resolve_to_the_checkout_root() {
        // These don't escape the checkout, so the rooted and `..` checks let
        // them through — but they'd hand out the whole checkout, which is the
        // same class of mistake with a different shape.
        for empty in ["", ".", "./"] {
            let toml = format!(
                r#"
                [tool]
                id = "echo"
                version = "0.1.0"
                [frontend]
                dist = "{empty}"
                [core]
                bin = "target/debug/helve-echo-tool"
                "#
            );

            match ToolManifest::parse(&toml) {
                Err(ManifestError::PathIsRoot { field, .. }) => {
                    assert_eq!(field, "frontend.dist")
                }
                other => panic!("expected PathIsRoot for {empty:?}, got {other:?}"),
            }
        }
    }

    /// A scratch directory under the OS temp dir, unique per test. `Drop`
    /// cleans it up so a failed assertion doesn't leak files across runs.
    struct TempCheckout(PathBuf);

    impl TempCheckout {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "helve-tool-manifest-test-{}-{}-{name}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            TempCheckout(dir)
        }
    }

    impl Drop for TempCheckout {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn manifest_with_bin(bin: &str) -> ToolManifest {
        let toml = format!(
            r#"
            [tool]
            id = "echo"
            version = "0.1.0"
            [frontend]
            dist = "ui/dist"
            [core]
            bin = "{bin}"
            "#
        );
        ToolManifest::parse(&toml).unwrap()
    }

    #[test]
    fn resolve_bin_finds_plain_binary() {
        let checkout = TempCheckout::new("plain");
        std::fs::write(checkout.0.join("tool-bin"), b"").unwrap();

        let manifest = manifest_with_bin("tool-bin");
        let resolved = manifest.resolve_bin(&checkout.0).unwrap();

        assert_eq!(resolved, checkout.0.join("tool-bin"));
    }

    #[test]
    fn resolve_bin_falls_back_to_exe_suffix() {
        let checkout = TempCheckout::new("exe-suffix");
        std::fs::write(checkout.0.join("tool-bin.exe"), b"").unwrap();

        let manifest = manifest_with_bin("tool-bin");
        let resolved = manifest.resolve_bin(&checkout.0).unwrap();

        assert_eq!(resolved, checkout.0.join("tool-bin.exe"));
    }

    #[test]
    fn resolve_bin_errors_naming_both_paths_tried() {
        let checkout = TempCheckout::new("missing");

        let manifest = manifest_with_bin("tool-bin");
        match manifest.resolve_bin(&checkout.0) {
            Err(ManifestError::BinNotFound { bin, bin_exe }) => {
                assert_eq!(bin, checkout.0.join("tool-bin"));
                assert_eq!(bin_exe, checkout.0.join("tool-bin.exe"));
            }
            other => panic!("expected BinNotFound, got {other:?}"),
        }
    }

    #[test]
    fn resolve_dist_joins_checkout_root() {
        let manifest = ToolManifest::parse(REFERENCE).unwrap();
        let resolved = manifest.resolve_dist(Path::new("/checkout"));
        assert_eq!(resolved, Path::new("/checkout/ui/dist"));
    }
}
