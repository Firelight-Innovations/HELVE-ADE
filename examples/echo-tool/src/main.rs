//! The reference tool core -- the smallest binary that satisfies
//! `docs/tool-protocol.md`. Every method here exists to exercise one thing
//! `helve-rpc` needs proven end-to-end:
//!
//! - `echo` proves params pass through untouched.
//! - `echo/upper` proves both success and a handler-generated error
//!   (`-32602`) round-trip correctly.
//! - `echo/notify` proves the notification path.
//! - `echo/die` proves a tool that vanishes mid-flight fails its pending
//!   call with `-32000` instead of hanging the caller forever. It isn't
//!   part of the protocol; it's a test seam, and it says so below.
//! - anything else proves `-32601`.

use helve_rpc::{serve, Handler, RpcError, INVALID_PARAMS, METHOD_NOT_FOUND};
use serde_json::{json, Value};

const USAGE: &str =
    "helve-echo-tool: this binary only speaks the Helve tool protocol; run it with --helve-rpc";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|a| a == "--helve-rpc") {
        eprintln!("{USAGE}");
        std::process::exit(1);
    }

    if let Err(e) = serve(Echo) {
        eprintln!("helve-echo-tool: serve failed: {e}");
        std::process::exit(1);
    }
}

struct Echo;

impl Handler for Echo {
    fn call(&mut self, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
        match method {
            "helve/hello" => {
                // Logged to stderr (stdout is protocol-only) so the
                // handshake is visible when a session is being debugged.
                eprintln!("helve-echo-tool: received handshake session {params:?}");
                Ok(json!({"id": "echo", "version": "0.1.0", "protocol": 1}))
            }

            "echo" => Ok(params.unwrap_or(Value::Null)),

            "echo/upper" => {
                let text = params
                    .as_ref()
                    .and_then(|p| p.get("text"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RpcError::new(INVALID_PARAMS, "echo/upper requires {\"text\": string}")
                    })?;
                Ok(json!({"text": text.to_uppercase()}))
            }

            "echo/notify" => {
                helve_rpc::notify("echo/notified", None)
                    .map_err(|e| RpcError::new(helve_rpc::INTERNAL_ERROR, e.to_string()))?;
                Ok(Value::Null)
            }

            // Not part of the protocol -- a hook the round-trip test uses to
            // simulate a crashed tool by exiting the process without ever
            // replying, so the host side's "EOF fails every pending call"
            // behavior has something real to trigger it. `std::process::exit`
            // rather than a panic: a panic would still let `main`'s stack
            // unwind and (depending on panic settings) print a backtrace,
            // which is a worse stand-in for "the process just vanished."
            "echo/die" => std::process::exit(1),

            _ => Err(RpcError::new(
                METHOD_NOT_FOUND,
                format!("no such method: {method}"),
            )),
        }
    }
}
