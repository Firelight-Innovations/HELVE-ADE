//! Wire format: JSON-RPC 2.0, one object per line, newline-delimited.
//!
//! See `docs/tool-protocol.md` section 2 for the prose spec this mirrors.
//! Everything here is transport-agnostic -- it knows how to turn a line of
//! text into a typed message and back, and nothing about processes, pipes,
//! or pending calls. `host.rs` and `tool.rs` own those.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;

/// The literal `"jsonrpc"` value every message on the wire carries.
const JSONRPC_VERSION: &str = "2.0";

// Standard JSON-RPC codes, plus the Helve range the host generates itself
// (never sent by a tool). Keeping these as constants rather than inlining
// the numbers is what lets a test assert `err.code == METHOD_NOT_FOUND`
// instead of a bare `-32601` that means nothing without the spec open.
pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;
pub const TOOL_EXITED: i32 = -32000;
pub const TIMED_OUT: i32 = -32001;
pub const HANDSHAKE_FAILED: i32 = -32002;

/// A JSON-RPC error object. Doubles as the `Err` variant for `Handler::call`
/// and `ToolProcess::call` -- a handler that fails just builds one of these
/// directly instead of the crate having a separate "handler error" type that
/// would need converting at the wire boundary anyway.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, thiserror::Error)]
#[error("{message} (code {code})")]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data(code: i32, message: impl Into<String>, data: Value) -> Self {
        Self {
            code,
            message: message.into(),
            data: Some(data),
        }
    }
}

/// Host->tool or tool->host request. `id` is allocated by whichever side
/// sends it; the two directions never need to agree on a single counter
/// because a response is only ever matched against the pending table of the
/// side that sent the request it answers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Request {
    pub fn new(id: u64, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            method: method.into(),
            params,
        }
    }
}

/// Reply to a `Request`. Carries exactly one of `result` / `error`, never
/// both and never neither -- `into_result` is the one place that invariant
/// gets collapsed into a normal `Result`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn ok(id: u64, result: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: u64, error: RpcError) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: Some(error),
        }
    }

    pub fn into_result(self) -> Result<Value, RpcError> {
        match self.error {
            Some(err) => Err(err),
            None => Ok(self.result.unwrap_or(Value::Null)),
        }
    }
}

/// An unsolicited push, no reply expected. This is the only message shape
/// in the protocol without an `id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Notification {
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            method: method.into(),
            params,
        }
    }
}

/// What a decoded line turns out to be. A reader gets one of these back and
/// dispatches on it; see `host.rs`'s reader thread and `tool.rs`'s `serve`.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Request(Request),
    Response(Response),
    Notification(Notification),
}

/// Every field optional so one struct can catch all three message shapes;
/// `decode_line` below is what turns the field pattern into a specific type.
/// Deliberately not `#[serde(deny_unknown_fields)]` -- an extra field from a
/// future protocol version should be ignored here, not rejected.
#[derive(Debug, Deserialize)]
struct RawMessage {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    // Not just `#[serde(default)]`: serde's stock `Option<T>` deserializer
    // treats a JSON `null` the same as a missing key, both becoming `None`.
    // That's wrong here specifically -- `{"result":null}` (a real, present
    // result of `null`, which is exactly what `helve/shutdown` and
    // `echo/notify` reply with) would otherwise collapse into "no result",
    // which is indistinguishable below from "no error either" and gets
    // rejected as an invalid response. `deserialize_present` keeps the
    // key-present-vs-absent distinction serde's default throws away.
    #[serde(default, deserialize_with = "deserialize_present")]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

/// Deserialize a field that is present (any JSON value, including `null`)
/// as `Some`, leaving `#[serde(default)]` to supply `None` when the key is
/// absent entirely. Paired with `#[serde(default, deserialize_with = ...)]`
/// on the field itself.
fn deserialize_present<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

/// Decode one line of the wire format.
///
/// This classifies by field presence (`method` => request/notification,
/// bare `id` => response) rather than as a serde `#[serde(untagged)]` enum.
/// Untagged enums pick the first variant that deserializes without error,
/// which is fragile here: a `Response` with an extra `method` field slipped
/// in by a buggy tool would silently match `Request` instead of getting
/// caught. Matching on the fields directly makes the "what shape is this"
/// decision explicit instead of an artifact of variant declaration order.
pub fn decode_line(line: &str) -> Result<Incoming, RpcError> {
    let raw: RawMessage = serde_json::from_str(line)
        .map_err(|e| RpcError::new(PARSE_ERROR, format!("invalid JSON: {e}")))?;

    match (raw.method, raw.id) {
        (Some(method), Some(id)) => Ok(Incoming::Request(Request::new(id, method, raw.params))),
        (Some(method), None) => Ok(Incoming::Notification(Notification::new(
            method, raw.params,
        ))),
        (None, Some(id)) => match (raw.result, raw.error) {
            (Some(_), Some(_)) => Err(RpcError::new(
                INVALID_REQUEST,
                "response carries both result and error",
            )),
            (None, None) => Err(RpcError::new(
                INVALID_REQUEST,
                "response carries neither result nor error",
            )),
            (result, error) => Ok(Incoming::Response(Response {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id,
                result,
                error,
            })),
        },
        (None, None) => Err(RpcError::new(
            INVALID_REQUEST,
            "message has neither method nor id",
        )),
    }
}

/// Serialize `msg` as one line and flush. The flush is not a nicety: a
/// buffered reply that never makes it past the process boundary looks
/// exactly like a hung tool from the other end of the pipe, and is much
/// harder to tell apart from an actual hang than this one extra syscall.
pub fn write_message<T: Serialize, W: Write>(writer: &mut W, msg: &T) -> std::io::Result<()> {
    let json = serde_json::to_string(msg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    writeln!(writer, "{json}")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn encoded<T: Serialize>(msg: &T) -> String {
        let mut buf = Vec::new();
        write_message(&mut buf, msg).unwrap();
        let text = String::from_utf8(buf).unwrap();
        assert!(
            text.ends_with('\n'),
            "write_message must terminate with \\n"
        );
        text.trim_end().to_string()
    }

    #[test]
    fn request_round_trips() {
        let req = Request::new(1, "echo", Some(json!({"text": "hi"})));
        match decode_line(&encoded(&req)).unwrap() {
            Incoming::Request(decoded) => {
                assert_eq!(decoded.id, 1);
                assert_eq!(decoded.method, "echo");
                assert_eq!(decoded.params, Some(json!({"text": "hi"})));
            }
            other => panic!("expected Request, got {other:?}"),
        }
    }

    #[test]
    fn success_response_round_trips() {
        let resp = Response::ok(7, json!({"text": "hi"}));
        match decode_line(&encoded(&resp)).unwrap() {
            Incoming::Response(decoded) => {
                assert_eq!(decoded.id, 7);
                assert_eq!(decoded.into_result().unwrap(), json!({"text": "hi"}));
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn error_response_round_trips() {
        let resp = Response::err(7, RpcError::new(METHOD_NOT_FOUND, "no such method: nope"));
        match decode_line(&encoded(&resp)).unwrap() {
            Incoming::Response(decoded) => {
                let err = decoded.into_result().unwrap_err();
                assert_eq!(err.code, METHOD_NOT_FOUND);
                assert_eq!(err.message, "no such method: nope");
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn notification_round_trips() {
        let notif = Notification::new("file/changed", Some(json!({"path": "a.txt"})));
        match decode_line(&encoded(&notif)).unwrap() {
            Incoming::Notification(decoded) => {
                assert_eq!(decoded.method, "file/changed");
                assert_eq!(decoded.params, Some(json!({"path": "a.txt"})));
            }
            other => panic!("expected Notification, got {other:?}"),
        }
    }

    #[test]
    fn malformed_line_is_a_parse_error() {
        let err = decode_line("not json at all").unwrap_err();
        assert_eq!(err.code, PARSE_ERROR);
    }

    #[test]
    fn a_shape_that_is_valid_json_but_no_valid_message_is_an_invalid_request() {
        // Neither a method nor an id: valid JSON, but not any of the three
        // message shapes the protocol defines.
        let err = decode_line(r#"{"jsonrpc":"2.0","foo":"bar"}"#).unwrap_err();
        assert_eq!(err.code, INVALID_REQUEST);
    }

    #[test]
    fn a_null_result_is_a_present_success_not_a_missing_one() {
        // Regression test for the serde `Option<T>` gotcha `deserialize_present`
        // works around: `helve/shutdown` and `echo/notify` both reply with a
        // real `result: null`, which must decode as `Ok(Value::Null)`, not
        // get rejected as "neither result nor error".
        let resp = Response::ok(1, Value::Null);
        match decode_line(&encoded(&resp)).unwrap() {
            Incoming::Response(decoded) => {
                assert_eq!(decoded.into_result().unwrap(), Value::Null);
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    #[test]
    fn response_decodes_regardless_of_whether_anything_is_waiting_on_its_id() {
        // The codec has no notion of a pending-call table -- that lives on
        // `ToolProcess`. A response naming an id nobody sent is well-formed
        // at this layer; it's the caller's job to notice nobody claims it.
        let line = r#"{"jsonrpc":"2.0","id":999,"result":null}"#;
        match decode_line(line).unwrap() {
            Incoming::Response(decoded) => {
                assert_eq!(decoded.id, 999);
                assert_eq!(decoded.into_result().unwrap(), Value::Null);
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }
}
