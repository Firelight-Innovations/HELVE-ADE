//! Forger's Rust half — technical design software, specced out but not built.
//!
//! Forger was going to be a separate repository, installed as a tool the way
//! `helve.toml` names one. That plan is reversed: what it will show — the open
//! project, the stack this orchestrator already resolved — is exactly the kind
//! of thing `apps/README.md` says belongs to an app rather than a tool, and a
//! process boundary in front of code that would only ask the shell for facts
//! the shell already has is an IPC hop to talk to ourselves. So it is a module
//! here, registered like Home and Files, months before it has anything to say.
//!
//! Today it answers one method, honestly: `forger/state` reports the project
//! this cluster is pointed at (or the lack of one) and a `ready: false` flag the
//! frontend reads to draw its empty state. There is no design data yet because
//! there is no design surface yet — this is the skeleton the real thing gets
//! built inside, not a preview of it.

use crate::apps::CallContext;
use helve_rpc::{RpcError, METHOD_NOT_FOUND};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

/// What `forger/state` reports.
///
/// `project` mirrors what [`CallContext`] resolved rather than anything Forger
/// has read for itself — there is no Forger-specific data on disk yet, so the
/// one honest thing to say is *where* it would look once there is. `ready` is
/// the field the frontend keys its empty state off; it is `false` in every
/// build until a real design surface lands behind it, at which point it earns
/// a second value rather than being deleted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    project: Option<String>,
    ready: bool,
}

fn state(context: &CallContext) -> Result<Value, RpcError> {
    let state = State {
        project: context
            .project
            .as_ref()
            .map(|path| path.display().to_string()),
        ready: false,
    };

    serde_json::to_value(&state)
        .map_err(|e| RpcError::new(helve_rpc::INTERNAL_ERROR, format!("could not answer: {e}")))
}

/// The method match, kept separate from [`call`] so it can be tested without an
/// `AppHandle`. Forger reads nothing off the handle yet — everything it can say
/// today comes out of [`CallContext`] — so threading a live one through a test
/// would only be there to satisfy the type and not because anything used it.
/// The day a method needs the handle, that method's test gains one; this split
/// does not have to change.
fn dispatch(context: &CallContext, method: &str) -> Result<Value, RpcError> {
    match method {
        "forger/state" => state(context),
        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
}

/// Route one `invoke` from the Forger app. See [`dispatch`] for the actual
/// matching.
pub fn call(
    _app: &AppHandle,
    context: &CallContext,
    method: &str,
    _params: Option<Value>,
) -> Result<Value, RpcError> {
    dispatch(context, method)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn state_reports_the_resolved_project_and_is_honestly_not_ready() {
        let context = CallContext {
            cluster_id: Some("cluster-1".to_string()),
            project: Some(PathBuf::from("/repo")),
        };

        let value = dispatch(&context, "forger/state").expect("forger/state does not fail");
        assert_eq!(value["ready"], false);
        assert_eq!(value["project"], "/repo");
    }

    #[test]
    fn state_reports_no_project_as_null_rather_than_guessing() {
        let context = CallContext::default();
        let value =
            dispatch(&context, "forger/state").expect("forger/state does not fail with no project");
        assert!(value["project"].is_null());
    }

    #[test]
    fn an_unknown_method_is_method_not_found() {
        let context = CallContext::default();
        let err = dispatch(&context, "forger/nonesuch").expect_err("unknown method is refused");
        assert_eq!(err.code, METHOD_NOT_FOUND);
    }
}
