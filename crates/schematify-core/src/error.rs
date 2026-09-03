//! The one error type this crate returns across its public surface.
//!
//! STANDARDS.md section 5 asks for one enum per bounded domain rather than one
//! per module, and for a message that names the value that failed. The
//! narrower errors below - a bad slug, a bad URI, an illegal transition - keep
//! their own types because a caller acts on them differently, and each of them
//! converts into this one so a command handler in wave 2 has a single
//! `Result` to return.

use std::path::PathBuf;

use crate::atomic::AtomicWriteError;
use crate::lifecycle::LifecycleError;
use crate::slug::SlugError;
use crate::uri::UriError;

/// The result alias every fallible function in this crate returns.
pub type Result<T> = std::result::Result<T, CoreError>;

/// Everything that can go wrong inside the design graph.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    /// A file could not be read or written.
    #[error("cannot access {path}")]
    Io {
        /// The file the operation named.
        path: PathBuf,
        /// The underlying cause.
        #[source]
        source: std::io::Error,
    },

    /// A file held JSON this crate could not turn into the schema it expected.
    #[error("cannot parse {path} as {schema}")]
    Parse {
        /// The file that failed.
        path: PathBuf,
        /// The schema the reader was applying, such as `node` or `edge`.
        schema: &'static str,
        /// The underlying cause.
        #[source]
        source: serde_json::Error,
    },

    /// A project directory holds no `.kaava/` tree.
    #[error("no .kaava directory under {root}")]
    NoProject {
        /// The directory that was searched.
        root: PathBuf,
    },

    /// A run artifact carried a `schema` value this build does not know.
    #[error("unknown run schema {found:?}: this build reads {expected:?}")]
    UnknownRunSchema {
        /// The value read from the file.
        found: String,
        /// The value this build accepts.
        expected: &'static str,
    },

    /// PRD section 6.6: a node with an inbound edge is never deleted.
    #[error("cannot delete node {id}: {inbound} inbound references, deprecate it instead")]
    DeleteRefused {
        /// The node the caller asked to remove.
        id: uuid::Uuid,
        /// How many live references point at it.
        inbound: usize,
    },

    /// PRD section 6.3's pair came apart: the node file was written, the
    /// audit append failed, and the rollback of the node file failed too.
    ///
    /// The node on disk is one transition ahead of its own history and no
    /// automatic repair is possible, so this names both failures rather than
    /// reporting whichever one happened to be last.
    #[error("torn lifecycle write on {id}: the audit failed ({audit}) and the rollback failed ({rollback})")]
    TransitionTornWrite {
        /// The node whose files disagree.
        id: uuid::Uuid,
        /// Why the audit append failed.
        audit: String,
        /// Why the node file could not be put back.
        rollback: String,
    },

    /// A slug collided inside its scope, or was not a legal slug.
    #[error(transparent)]
    Slug(#[from] SlugError),

    /// A `schematify://` reference did not parse.
    #[error(transparent)]
    Uri(#[from] UriError),

    /// A lifecycle transition was illegal, or the actor was not allowed it.
    #[error(transparent)]
    Lifecycle(#[from] LifecycleError),

    /// An atomic write failed partway.
    #[error(transparent)]
    AtomicWrite(#[from] AtomicWriteError),
}
