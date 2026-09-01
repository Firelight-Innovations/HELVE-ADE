//! Everything OpenKaava remembers about a person, and what keeps it across an
//! install.
//!
//! Eight JSON files and a directory of plugin checkouts sit under
//! `%APPDATA%\<identifier>\`. None of them is the repository's, none belongs to
//! a project, and until the rename that produced this module nobody had to
//! think about the path they share. This module is the part of that path that
//! is decided here rather than by Tauri:
//!
//!   * [`identity`] pins the bundle identifier every one of them hangs off,
//!     and names the identifiers it has replaced.
//!   * [`adopt`] moves the directory a replaced identifier left behind onto the
//!     current one, once, at the start of the launch that first notices.
//!
//! `docs/dev/user-data.md` is the design note — what is at risk, what is
//! precious and what is merely reconstructible, and the alternatives that were
//! rejected on the way here.

pub mod adopt;
pub mod identity;
