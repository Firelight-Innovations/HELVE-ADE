//! Journeyman's Rust half — the build side of the stack, downstream of what
//! Forger specifies.
//!
//! Deliberately a skeleton today: one placeholder method, honestly answered.
//! Journeyman was going to be a separate repository installed as a plugin;
//! that is reversed, for the reason `apps/README.md` gives for Home and Files
//! — what it will eventually need is already something this process owns, and
//! a child process would only ask the shell for it again.
//!
//! No state held here, like `design::call` and `tutorial::call`: a second
//! Journeyman in a second cluster resolves the same [`CallContext`] its own
//! cluster already worked out, so there is nowhere honest to keep a second
//! copy.

use crate::apps::CallContext;
use kaava_rpc::{RpcError, METHOD_NOT_FOUND};
use serde_json::{json, Value};
use tauri::AppHandle;

/// Everything Journeyman can say about itself today.
///
/// `project` mirrors what [`CallContext::resolve`] already worked out for this
/// cluster — the same fact `home/state` and `files/root` read off of it — so a
/// Journeyman pane opened beside a File Explorer in one cluster reports the
/// same project that Explorer is rooted at, and a pane in the next cluster
/// reports theirs. `None` is an ordinary state, not a failure: a cluster with
/// nothing open yet has nothing for Journeyman to say either.
///
/// `ready` is not a loading flag — it is the honest, permanent answer for a
/// build system that has not been written, and the frontend renders it as an
/// empty state rather than a fetch still in flight.
fn state(context: &CallContext) -> Result<Value, RpcError> {
    Ok(json!({
        "project": context.project.as_ref().map(|p| p.display().to_string()),
        "ready": false,
    }))
}

/// Route one `invoke` from the Journeyman app.
///
/// Delegates to [`dispatch`] rather than matching here directly. Every other
/// method this app will eventually grow — reading a Forger spec, watching a
/// build run — is going to need the `AppHandle` this signature carries; the one
/// method it has today does not, and `files.rs` already sets the precedent for
/// keeping what does not need Tauri's runtime out of the function that would
/// otherwise force every test of it to stand up a mock one.
pub fn call(
    _app: &AppHandle,
    context: &CallContext,
    method: &str,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    dispatch(context, method, params)
}

fn dispatch(
    context: &CallContext,
    method: &str,
    _params: Option<Value>,
) -> Result<Value, RpcError> {
    match method {
        "journeyman/state" => state(context),
        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn state_is_honest_about_not_being_built_with_no_project_open() {
        let value =
            dispatch(&CallContext::default(), "journeyman/state", None).expect("state never fails");
        assert_eq!(value["project"], Value::Null);
        assert_eq!(value["ready"], Value::Bool(false));
    }

    #[test]
    fn state_reports_the_calling_clusters_project() {
        let context = CallContext {
            cluster_id: Some("cluster-1".to_string()),
            project: Some(PathBuf::from("C:/example/project")),
        };
        let value = dispatch(&context, "journeyman/state", None).expect("state never fails");
        assert_eq!(value["project"], json!("C:/example/project"));
        assert_eq!(value["ready"], Value::Bool(false));
    }

    #[test]
    fn an_unknown_method_is_method_not_found_rather_than_a_panic() {
        let err = dispatch(&CallContext::default(), "journeyman/nonesuch", None)
            .expect_err("an unregistered method must not succeed");
        assert_eq!(err.code, METHOD_NOT_FOUND);
    }
}
