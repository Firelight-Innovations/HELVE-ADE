//! JSON-RPC over newline-delimited JSON on the standard streams -- transport
//! A of `docs/tool-protocol.md`. This crate is both halves of that pipe:
//! the host side that spawns a tool process and calls into it
//! ([`ToolProcess`]), and the tool side that answers on stdin/stdout
//! ([`serve`]). A tool binary and the orchestrator that spawns it both
//! depend on this crate, so the wire format only has one implementation to
//! drift out of sync with the spec.

mod codec;
mod host;
mod tool;

pub use codec::{
    Incoming, Notification, Request, Response, RpcError, HANDSHAKE_FAILED, INTERNAL_ERROR,
    INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR, TIMED_OUT, TOOL_EXITED,
};
pub use host::{SpawnError, ToolProcess, DEFAULT_TIMEOUT};
pub use tool::{notify, serve, Handler};
