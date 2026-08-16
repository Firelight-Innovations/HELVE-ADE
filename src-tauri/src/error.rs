//! One error type for everything the orchestrator can fail at.
//!
//! Rust has no exceptions: a function that can fail returns `Result<T, E>` and
//! the caller has to deal with both arms. `thiserror` just generates the
//! boilerplate (the `Display` impl and the `From` conversions) from the
//! `#[error(...)]` attributes below.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("could not locate helve.toml (looked in: {0})")]
    ManifestNotFound(String),

    #[error("failed to read {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("{path} is not valid TOML: {source}")]
    Toml {
        path: String,
        #[source]
        source: toml::de::Error,
    },

    #[error("tool `{id}` pins version `{version}`, which is not valid semver: {source}")]
    Version {
        id: String,
        version: String,
        #[source]
        source: semver::Error,
    },

    #[error("no tool with id `{0}` in the manifest")]
    UnknownTool(String),

    /// A project is a folder (see `project`), so the only way to fail to open
    /// one is for the path not to be a folder — deleted, moved, or a file that
    /// got dragged onto the window.
    #[error("{0} is not a folder, so it cannot be opened as a project")]
    NotAProject(String),

    /// Refused rather than overwritten. A manifest carries the project's stable
    /// id, and writing a second one over it would silently make it a different
    /// project as far as anything holding that id is concerned.
    #[error("{0} already exists — open the project instead of creating it")]
    AlreadyAProject(String),

    #[error("could not open the checkout for `{id}`: {source}")]
    Reveal {
        id: String,
        #[source]
        source: tauri_plugin_opener::Error,
    },

    // Flattened strings rather than a `#[source]`: what failed is either an
    // `io::Error` from the spawn or a non-zero exit code with stderr attached,
    // and neither is worth preserving structurally — the only consumer is a
    // frontend that prints the message.
    #[error("git {op} failed: {reason}")]
    Git { op: String, reason: String },

    #[error("could not create window `{label}`: {source}")]
    Window {
        label: String,
        #[source]
        source: tauri::Error,
    },

    /// `portable-pty` reports failures as `anyhow::Error`, which is not an
    /// error *type* we can hold as a `#[source]` without taking on anyhow as a
    /// dependency of our own. The message is all the frontend ever shows, so it
    /// is flattened to a string at the boundary instead.
    ///
    /// The field is `reason`, not `source`: `thiserror` treats a field called
    /// `source` as the underlying error and requires it to implement
    /// `std::error::Error`, which a `String` does not.
    #[error("terminal `{id}` failed: {reason}")]
    Pty { id: String, reason: String },

    /// A preset name that cannot be used: blank, or one of the compiled-in
    /// built-ins'. Carries the whole sentence rather than the offending name,
    /// because the two cases have nothing in common but the field they are shown
    /// under — the menu prints this verbatim beneath the name field, and a
    /// caller that had to assemble the sentence would be a second author of it.
    #[error("{0}")]
    PresetName(String),

    /// A preset id that names nothing. Not an impossible state: the menu was
    /// drawn from a list that `presets.json` could have been edited out from
    /// under, in this window or another one.
    #[error("no preset with id `{0}` — it may have been removed since the menu was opened")]
    UnknownPreset(String),

    /// Every cluster in the window has been closed, so there is no arrangement
    /// to save and nowhere to apply one. The menu disables both items for
    /// exactly this, the same way the Apps menu does; this is the backend
    /// refusing rather than trusting that it did.
    #[error("this window has no cluster to {0}")]
    NoCluster(&'static str),
}

/// Tauri sends a command's error across the IPC boundary into JavaScript, so the
/// error type has to be `Serialize`. We collapse the whole enum down to its
/// human-readable message — the frontend only ever displays it.
impl Serialize for AppError {
    // Spelled `std::result::Result` on purpose: the `Result<T>` alias below is
    // in scope for this whole module, so a bare `Result<S::Ok, S::Error>` here
    // would resolve to *that* — which takes one type parameter, not two.
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Shorthand so the rest of the crate can write `Result<Thing>` instead of
/// `std::result::Result<Thing, AppError>`.
pub type Result<T> = std::result::Result<T, AppError>;
