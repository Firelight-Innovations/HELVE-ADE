//! Seeing and driving the running interface, for the agent working on it.
//!
//! The debug server next door answers what OpenKaava *believes* — its layout tree,
//! its failures, how boot went. This one answers what is actually on screen, and
//! can act on it: a screenshot, a list of what can be clicked, and real mouse
//! and keyboard input into the window.
//!
//! **This is the one server that writes.** Everything else OpenKaava hosts is a
//! read, deliberately, so that a leaked token costs knowledge and not control.
//! A tool that clicks cannot be that, which is why this server is `dev_only`,
//! starts switched off even once developer mode reveals it, and says so on the
//! row that draws it.
//!
//! Why the protocol reaches the webview through COM rather than a debug port,
//! and what that buys: `docs/design-notes/agent-ui-driving.md`.
//!
//! **Prefer [`super::agent`]**, which hosts these six by delegation next to the
//! shell reads and a line into any app's Rust half. This module stays
//! registered because the capability is its, its tests are what hold this code
//! to account, and a client wanting only input needs no twelve tools.

use crate::devtools;
use crate::mcp::{McpServer, McpTool, ToolAnswer};
use kaava_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS};
use serde_json::{json, Value};
use tauri::AppHandle;

pub static SERVER: McpServer = McpServer {
    id: "ui",
    name: "UI",
    description: "See and drive the running window: screenshots, a list of what can be clicked, \
                  and real mouse and keyboard input.",
    tools: TOOLS,
    call,
    dev_only: true,
};

/// The most characters one `type_text` will send.
///
/// A cap rather than a rejection of anything longer: each character is a pair of
/// protocol round trips, so a model that pastes a file into a text box would
/// otherwise sit through thousands of them and time out with nothing typed.
const MAX_TEXT: usize = 2000;

/// What `snapshot` looks at when it is not told otherwise.
const INTERACTIVE: &str = "button,a,input,textarea,select,[role=button],[role=menuitem],\
                           [role=tab],[contenteditable=true],[tabindex]";

/// Named keys, and the virtual key code each needs to register.
///
/// A printable character travels as `text` alone. These do not: the page reads
/// them from the key code, and one dispatched without it arrives as nothing at
/// all — no error, no keystroke, which is the worst of both.
const KEYS: &[(&str, u32, &str)] = &[
    ("Enter", 13, "\r"),
    ("Tab", 9, ""),
    ("Escape", 27, ""),
    ("Backspace", 8, ""),
    ("Delete", 46, ""),
    ("ArrowUp", 38, ""),
    ("ArrowDown", 40, ""),
    ("ArrowLeft", 37, ""),
    ("ArrowRight", 39, ""),
];

static TOOLS: &[McpTool] = &TOOL_LIST;

/// The same six tools, as a const array the `agent` server can index.
///
/// A `const` beside the `static` rather than instead of it: `McpServer.tools`
/// needs a `&'static [McpTool]`, and a const array cannot be borrowed for one
/// without a static to anchor it. Naming the array is what lets
/// [`super::agent`] build its twelve-tool list out of these six and `debug`'s
/// three without a second copy of any description.
pub(super) const TOOL_LIST: [McpTool; 6] = [
    McpTool {
        name: "screenshot",
        description: "A PNG of the window as it is drawn right now, app content included. The \
                      one tool that answers what something looks like rather than what it is.",
        schema: window_only,
    },
    McpTool {
        name: "snapshot",
        description: "Every visible interactive element, each with a ref (`e0`, `e1`), a label \
                      and a position. Walks into app iframes, so app content is listed too. Refs \
                      are renumbered every call — take a fresh snapshot before clicking.",
        schema: snapshot_schema,
    },
    McpTool {
        name: "click",
        description: "Click a ref from the last snapshot, or any CSS selector. Dispatches real \
                      pointer events at the element's centre, so menus, drag handles and \
                      focus-driven behaviour react the way they do for a person.",
        schema: target_schema,
    },
    McpTool {
        name: "type_text",
        description: "Type into whatever has focus, one keystroke at a time. Click the field \
                      first; this does not choose one.",
        schema: text_schema,
    },
    McpTool {
        name: "press_key",
        description: "Press one named key: Enter, Tab, Escape, Backspace, Delete, or an arrow.",
        schema: key_schema,
    },
    McpTool {
        name: "eval",
        description: "Run JavaScript in the shell and return its result. The escape hatch for \
                      what the tools above do not cover. Note this reaches the whole backend \
                      through window.__TAURI__, so it can do considerably more than click.",
        schema: eval_schema,
    },
];

/// Every tool takes an optional window, and most take nothing else.
fn window_only() -> Value {
    json!({
        "type": "object",
        "properties": { "window": window_property() },
        "additionalProperties": false,
    })
}

fn window_property() -> Value {
    json!({
        "type": "string",
        "description": "Which window, by label. Defaults to the focused one. `shell_snapshot` \
                        on the debug server lists them.",
    })
}

fn snapshot_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "window": window_property(),
            "selector": {
                "type": "string",
                "description": "A CSS selector to list instead of the interactive default. Use \
                                it to narrow a long list, not to find one element.",
            },
        },
        "additionalProperties": false,
    })
}

fn target_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "window": window_property(),
            "target": {
                "type": "string",
                "description": "A ref from the last snapshot, like `e12`, or a CSS selector.",
            },
        },
        "required": ["target"],
        "additionalProperties": false,
    })
}

fn text_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "window": window_property(),
            "text": { "type": "string", "description": "What to type." },
        },
        "required": ["text"],
        "additionalProperties": false,
    })
}

fn key_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "window": window_property(),
            "key": {
                "type": "string",
                "enum": KEYS.iter().map(|(name, _, _)| *name).collect::<Vec<&str>>(),
            },
        },
        "required": ["key"],
        "additionalProperties": false,
    })
}

fn eval_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "window": window_property(),
            "expression": {
                "type": "string",
                "description": "A JavaScript expression. A promise is awaited before the result \
                                is returned.",
            },
        },
        "required": ["expression"],
        "additionalProperties": false,
    })
}

/// An unknown tool cannot arrive here — `Registry::call` checks the name against
/// `TOOLS` first — so the final arm is a genuine impossibility.
///
/// `pub(super)` so [`super::agent`] can hand its six borrowed tool names
/// straight through. Delegating rather than moving these handlers into the
/// unified server keeps this module's own tests testing the code that runs.
pub(super) fn call(
    app: &AppHandle,
    tool: &str,
    params: Option<Value>,
) -> Result<ToolAnswer, RpcError> {
    let params = params.unwrap_or(Value::Null);
    let window = params.get("window").and_then(Value::as_str);

    match tool {
        "screenshot" => screenshot(app, window),
        "snapshot" => {
            snapshot(app, window, params.get("selector").and_then(Value::as_str)).map(Into::into)
        }
        "click" => click(app, window, required(&params, "target")?).map(Into::into),
        "type_text" => type_text(app, window, required(&params, "text")?).map(Into::into),
        "press_key" => press_key(app, window, required(&params, "key")?).map(Into::into),
        "eval" => evaluate(app, window, required(&params, "expression")?).map(Into::into),
        other => Err(RpcError::new(
            kaava_rpc::METHOD_NOT_FOUND,
            format!("the UI server has no tool named `{other}`"),
        )),
    }
}

/// A string parameter the schema marks required, refused by name if it is not
/// there. The schema should have caught it; not every client enforces one.
fn required<'a>(params: &'a Value, name: &str) -> Result<&'a str, RpcError> {
    params
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new(INVALID_PARAMS, format!("`{name}` is required, as a string")))
}

fn screenshot(app: &AppHandle, window: Option<&str>) -> Result<ToolAnswer, RpcError> {
    let shot = protocol(
        app,
        window,
        "Page.captureScreenshot",
        &json!({ "format": "png" }),
    )?;

    let data = shot
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new(INTERNAL_ERROR, "the capture came back with no image"))?;

    Ok(ToolAnswer::Image {
        mime: "image/png".to_string(),
        data: data.to_string(),
    })
}

/// What can be clicked, and where each thing is.
///
/// The positions are in the top-level window's coordinates, iframe offsets
/// already added, so a row can be handed to `click` without any further
/// arithmetic — and so `click` and `snapshot` cannot disagree about where
/// something is.
fn snapshot(
    app: &AppHandle,
    window: Option<&str>,
    selector: Option<&str>,
) -> Result<Value, RpcError> {
    let argument = selector.map_or(Value::Null, |s| Value::String(s.to_string()));
    let rows = in_page(app, window, SNAPSHOT_BODY, &argument)?;
    let count = rows.as_array().map_or(0, Vec::len);

    Ok(json!({
        "elements": rows,
        "count": count,
        "selector": selector.unwrap_or(INTERACTIVE),
        // Said out loud because refs look stable and are not. A model that keeps
        // one across two snapshots clicks whatever now holds that index.
        "note": "Refs are renumbered by every snapshot. Take a fresh one before clicking.",
    }))
}

fn click(app: &AppHandle, window: Option<&str>, target: &str) -> Result<Value, RpcError> {
    let found = in_page(app, window, LOCATE_BODY, &Value::String(target.to_string()))?;

    let (Some(x), Some(y)) = (
        found.get("x").and_then(Value::as_i64),
        found.get("y").and_then(Value::as_i64),
    ) else {
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!(
                "nothing matched `{target}`. Refs go stale on every snapshot — take a fresh one, \
                 or pass a CSS selector."
            ),
        ));
    };

    // Move, press, release. `el.click()` would be one call instead of three and
    // would skip both the pointer events OpenKaava's menus and drag handles listen
    // for and the focus change a real press causes.
    protocol(
        app,
        window,
        "Input.dispatchMouseEvent",
        &json!({ "type": "mouseMoved", "x": x, "y": y }),
    )?;

    for phase in ["mousePressed", "mouseReleased"] {
        protocol(
            app,
            window,
            "Input.dispatchMouseEvent",
            &json!({
                "type": phase,
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
            }),
        )?;
    }

    Ok(json!({
        "clicked": target,
        "label": found.get("label").cloned().unwrap_or(Value::Null),
        "at": { "x": x, "y": y },
    }))
}

fn type_text(app: &AppHandle, window: Option<&str>, text: &str) -> Result<Value, RpcError> {
    let sent: String = text.chars().take(MAX_TEXT).collect();

    for character in sent.chars() {
        let text = character.to_string();
        for phase in ["keyDown", "keyUp"] {
            protocol(
                app,
                window,
                "Input.dispatchKeyEvent",
                &json!({ "type": phase, "text": text }),
            )?;
        }
    }

    Ok(json!({
        "typed": sent.chars().count(),
        "truncated": text.chars().count() > sent.chars().count(),
    }))
}

fn press_key(app: &AppHandle, window: Option<&str>, name: &str) -> Result<Value, RpcError> {
    let Some((key, code, text)) = KEYS.iter().find(|(known, _, _)| *known == name) else {
        let known: Vec<&str> = KEYS.iter().map(|(name, _, _)| *name).collect();
        return Err(RpcError::new(
            INVALID_PARAMS,
            format!("no key named `{name}`. Known: {}", known.join(", ")),
        ));
    };

    for phase in ["keyDown", "keyUp"] {
        let mut event = json!({
            "type": phase,
            "key": key,
            "windowsVirtualKeyCode": code,
            "nativeVirtualKeyCode": code,
        });

        // Only on the way down, and only for a key that produces a character.
        // Enter with `text` on the way up types a second newline.
        if !text.is_empty() && phase == "keyDown" {
            event["text"] = Value::String((*text).to_string());
        }

        protocol(app, window, "Input.dispatchKeyEvent", &event)?;
    }

    Ok(json!({ "pressed": key }))
}

/// Run an expression in the page and hand back what it produced.
fn evaluate(app: &AppHandle, window: Option<&str>, expression: &str) -> Result<Value, RpcError> {
    let answered = protocol(
        app,
        window,
        "Runtime.evaluate",
        &json!({
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
        }),
    )?;

    if let Some(thrown) = answered.get("exceptionDetails") {
        let text = thrown
            .pointer("/exception/description")
            .or_else(|| thrown.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("the page threw, without saying what");
        return Err(RpcError::new(INTERNAL_ERROR, text.to_string()));
    }

    Ok(answered
        .pointer("/result/value")
        .cloned()
        .unwrap_or(Value::Null))
}

/// Run one of the bodies below in the page and parse the JSON it returns.
///
/// The scripts hand back a string rather than an object because CDP's own
/// serialisation of a deep object is lossy in ways that are hard to see — a
/// `JSON.stringify` on the page's side is one format both ends already agree
/// about.
fn in_page(
    app: &AppHandle,
    window: Option<&str>,
    body: &str,
    argument: &Value,
) -> Result<Value, RpcError> {
    let produced = evaluate(app, window, &script(body, argument))?;

    let Some(text) = produced.as_str() else {
        return Err(RpcError::new(
            INTERNAL_ERROR,
            "the page did not answer with JSON",
        ));
    };

    serde_json::from_str(text).map_err(|e| {
        RpcError::new(
            INTERNAL_ERROR,
            format!("the page's answer was not JSON: {e}"),
        )
    })
}

/// One protocol call, with its failure turned into something a model can act on.
fn protocol(
    app: &AppHandle,
    window: Option<&str>,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    devtools::call(app, window, method, params)
        .map_err(|e| RpcError::new(INTERNAL_ERROR, e.message()))
}

/// Wrap a body in the helpers it needs and the argument it was given.
///
/// The argument is JSON-encoded rather than pasted in, so a selector containing
/// a quote is a selector rather than a syntax error.
fn script(body: &str, argument: &Value) -> String {
    let mut js = String::from("(() => {\n");
    js.push_str(HELPERS);
    js.push_str("const argument = ");
    js.push_str(&argument.to_string());
    js.push_str(";\n");
    js.push_str(body);
    js.push_str("\n})()");
    js
}

/// Three things every body needs: reaching into app iframes, deciding what
/// counts as visible, and naming an element.
///
/// Apps mount as iframes on `tauri.localhost`, the same origin as the shell, so
/// `contentDocument` reads straight through and an agent sees app content rather
/// than the frame around it. The `try` is for a frame that is not ours.
const HELPERS: &str = r#"
const docs = () => {
  const out = [{ doc: document, dx: 0, dy: 0 }];
  for (const frame of document.querySelectorAll('iframe')) {
    let inner = null;
    try { inner = frame.contentDocument; } catch { inner = null; }
    if (!inner) continue;
    const box = frame.getBoundingClientRect();
    out.push({ doc: inner, dx: box.x, dy: box.y });
  }
  return out;
};
const shown = (el, doc) => {
  const style = (doc.defaultView || window).getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};
const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || '')
  .replace(/\s+/g, ' ').trim().slice(0, 80);
const middle = (el, dx, dy) => {
  const box = el.getBoundingClientRect();
  return { x: Math.round(dx + box.x + box.width / 2), y: Math.round(dy + box.y + box.height / 2) };
};
"#;

/// Refs are kept in an array on `window`, never as attributes on the elements.
///
/// A tool that marks up the DOM changes the thing it is there to observe, and a
/// stray `data-` attribute surviving into a screenshot or somebody's CSS selector
/// sends them chasing a bug that belongs to the tooling.
const SNAPSHOT_BODY: &str = r#"
const chosen = argument || 'button,a,input,textarea,select,[role=button],[role=menuitem],[role=tab],[contenteditable=true],[tabindex]';
const refs = [];
const rows = [];
for (const { doc, dx, dy } of docs()) {
  let matched = [];
  try { matched = doc.querySelectorAll(chosen); } catch { matched = []; }
  for (const el of matched) {
    if (!shown(el, doc)) continue;
    const at = middle(el, dx, dy);
    rows.push({
      ref: 'e' + refs.length,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      label: name(el),
      frame: (dx === 0 && dy === 0) ? 'shell' : 'app',
      x: at.x,
      y: at.y,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    });
    refs.push(el);
  }
}
window.__kaavaDebugRefs = refs;
return JSON.stringify(rows);
"#;

/// A ref, else a CSS selector, and the element is scrolled into view before its
/// position is read — a click at the coordinates of something off screen lands
/// on whatever is there instead.
const LOCATE_BODY: &str = r#"
const kept = window.__kaavaDebugRefs || [];
let el = /^e\d+$/.test(argument) ? kept[Number(argument.slice(1))] : null;
let dx = 0, dy = 0;
if (el) {
  for (const entry of docs()) {
    if (entry.doc.contains(el)) { dx = entry.dx; dy = entry.dy; break; }
  }
} else {
  for (const entry of docs()) {
    let found = null;
    try { found = entry.doc.querySelector(argument); } catch { found = null; }
    if (found) { el = found; dx = entry.dx; dy = entry.dy; break; }
  }
}
if (!el) return JSON.stringify({});
el.scrollIntoView({ block: 'center', inline: 'center' });
const at = middle(el, dx, dy);
return JSON.stringify({ x: at.x, y: at.y, label: name(el) });
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_server_is_developer_only_and_says_what_it_does() {
        assert!(
            SERVER.dev_only,
            "the one server that can click must not be visible by default"
        );
        assert!(!SERVER.description.trim().is_empty());
    }

    #[test]
    fn the_server_declares_exactly_the_six_tools() {
        let names: Vec<&str> = SERVER.tools.iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            vec![
                "screenshot",
                "snapshot",
                "click",
                "type_text",
                "press_key",
                "eval"
            ]
        );
    }

    /// The listener hands `rmcp` a map for `inputSchema`, so a schema that were
    /// an array or a string would have nowhere to go.
    #[test]
    fn every_schema_is_an_object() {
        for tool in SERVER.tools {
            assert!(
                (tool.schema)().is_object(),
                "schema for {:?} must be a JSON object",
                tool.name
            );
        }
    }

    /// Every tool acts on a window, and every one of them has to accept the same
    /// way of naming it — a tool that quietly ignored `window` would act on the
    /// wrong one and report success.
    #[test]
    fn every_tool_accepts_a_window() {
        for tool in SERVER.tools {
            let schema = (tool.schema)();
            assert!(
                schema.pointer("/properties/window").is_some(),
                "{:?} does not take a window",
                tool.name
            );
        }
    }

    /// The enum is what a client draws its choices from, so it has to be the
    /// same list `press_key` will actually accept.
    #[test]
    fn the_key_schema_offers_exactly_the_keys_that_work() {
        let schema = key_schema();
        let offered: Vec<&str> = schema
            .pointer("/properties/key/enum")
            .and_then(Value::as_array)
            .expect("the key parameter offers an enum")
            .iter()
            .filter_map(Value::as_str)
            .collect();

        let known: Vec<&str> = KEYS.iter().map(|(name, _, _)| *name).collect();
        assert_eq!(offered, known);
    }

    /// Enter is the one key that carries text, and it must carry it only on the
    /// way down — dispatched on both edges it types two newlines.
    #[test]
    fn only_enter_carries_text() {
        for (name, _, text) in KEYS {
            let carries = !text.is_empty();
            assert_eq!(carries, *name == "Enter", "{name} disagrees about text");
        }
    }

    /// A missing required parameter is refused by name. The schema should have
    /// caught it, but not every client enforces one, and "`target` is required"
    /// is a fixable message where a panic is not.
    #[test]
    fn a_missing_required_parameter_is_named_rather_than_guessed() {
        let error = required(&json!({}), "target").expect_err("this must fail");
        assert_eq!(error.code, INVALID_PARAMS);
        assert!(error.message.contains("target"), "{}", error.message);

        let numeric = json!({ "target": 12 });
        assert!(
            required(&numeric, "target").is_err(),
            "a number is not a target"
        );
    }

    /// The argument is encoded, not pasted. A selector holding a quote has to
    /// arrive as a selector rather than as a syntax error halfway down a script.
    #[test]
    fn a_hostile_argument_is_encoded_rather_than_interpolated() {
        let nasty = Value::String("input[value='\"]; alert(1); //']".to_string());
        let js = script(LOCATE_BODY, &nasty);

        assert!(js.contains("const argument = \""), "{js}");
        assert!(
            !js.contains("; alert(1); //']\n"),
            "the argument escaped its literal"
        );
        assert!(js.contains("window.__kaavaDebugRefs"));
    }

    /// `null` is what "no selector" becomes, and the body has to read it as
    /// falsy so the default list is used. Any other encoding silently matches
    /// nothing.
    #[test]
    fn an_absent_selector_becomes_a_falsy_argument() {
        let js = script(SNAPSHOT_BODY, &Value::Null);
        assert!(js.contains("const argument = null;"), "{js}");
    }

    /// The default list lives in two places by necessity: the JS that applies it
    /// and the Rust that reports which one was used. This is what keeps the
    /// answer honest about what was actually looked at.
    #[test]
    fn the_reported_default_selector_is_the_one_the_page_applies() {
        assert!(SNAPSHOT_BODY.contains(INTERACTIVE), "{INTERACTIVE}");
    }
}
