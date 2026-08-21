//! Design Mode's Rust half: which page may be embedded, what may be put inside
//! it, and how a picture of part of it is taken.
//!
//! The app hosts an iframe pointed at a URL somebody types — their own dev
//! server, usually — and clicking an element in it hands the element's markup,
//! its computed styles and a cropped screenshot to a coding agent. That is new
//! ground for this shell. Every other frame it mounts is either its own build
//! (`apps::entry_url`) or a tool it resolved from a manifest; this is the first
//! that is neither, and the three methods here are the three things that
//! required Rust rather than a component.
//!
//! **`design/target` decides what may be loaded at all**, and it is a security
//! boundary rather than a convenience. See [`normalize`] and the `.localhost`
//! rule in it — a page reaching HELVE's own commands is one bad hostname away
//! without that check, and the reason is a detail of Tauri's origin test rather
//! than anything visible from here.
//!
//! **`design/arm` installs the probe** through `devtools::install_script`,
//! because same-origin policy means no code in the shell can reach into a frame
//! showing somebody else's origin. `design_probe.js` is what gets installed and
//! its own header covers what happens next.
//!
//! **`design/capture` crops a screenshot** out of the window with the DevTools
//! Protocol, from coordinates the app resolved. It holds no opinion about which
//! element those coordinates belong to.
//!
//! This module holds **no state**, like `files::call` and for the same reason:
//! a second Design Mode in a second cluster is a second frame with its own
//! probe, and anything remembered here would be shared between them by
//! accident. The script id from `design/arm` is handed to the caller and passed
//! back to `design/disarm`.

use crate::apps::CallContext;
use crate::devtools;
use helve_rpc::{RpcError, INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Url};

/// The probe, as browser code. See `design_probe.js` for why it is a file.
const PROBE: &str = include_str!("design_probe.js");

/// The largest screenshot worth sending back, in base64 characters.
///
/// A cropped element is normally a few kilobytes; this is the ceiling for one
/// that is the whole page. Refusing beyond it rather than downscaling, because
/// the caller can retry against a smaller element and a silently resampled
/// image is a wrong answer that looks like a right one.
const SCREENSHOT_LIMIT: usize = 6 * 1024 * 1024;

/// A URL the app is cleared to load, and the origin it resolved to.
///
/// The origin is returned separately because the app needs it for the address
/// bar and, more importantly, because nothing in the frontend should be
/// re-parsing a URL to find one. Rust decided; the frontend displays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub url: String,
    pub origin: String,
}

/// Why a typed address was refused.
///
/// An enum rather than a string so the reasons can be tested one at a time —
/// [`normalize`] is the only thing standing between an arbitrary string and an
/// iframe, and "it refuses bad input" is not a claim worth making without
/// naming which bad input.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Refusal {
    Empty,
    Unreadable,
    Scheme(String),
    NoHost,
    ReservedHost(String),
}

impl Refusal {
    fn message(&self) -> String {
        match self {
            Refusal::Empty => "type the address of a page to inspect".to_string(),
            Refusal::Unreadable => "that is not an address a browser could open".to_string(),
            Refusal::Scheme(scheme) => format!(
                "Design Mode opens http and https pages; `{scheme}:` is not one of them"
            ),
            Refusal::NoHost => "that address names no host to fetch it from".to_string(),
            Refusal::ReservedHost(host) => format!(
                "`{host}` is reserved — a name under `.localhost` can be mistaken for this \
                 application's own origin, which would hand the page HELVE's own permissions. \
                 Use `localhost` with a port instead."
            ),
        }
    }
}

/// Whether the text already names a scheme, as opposed to opening with a host
/// and a port.
///
/// This exists because the two are ambiguous and the ambiguity is dangerous in
/// one direction. `localhost:5173` parses perfectly well as a URL whose *scheme*
/// is `localhost`, which is how a person typing the most ordinary address this
/// feature has would get told their scheme is not supported. Prepending
/// `http://` whenever `://` is absent fixes that and breaks the other way:
/// `data:text/html,…` and `javascript:…` have no `//` either, and become
/// `http://data:…`, which fails to parse and is reported as a typo rather than
/// as the two schemes that would run script with this app frame's own origin.
///
/// The character straight after the colon settles it. A port is digits; no
/// scheme's body begins with one, because `//`, a path or a payload is what
/// follows a colon in every URL that has a real scheme.
fn states_a_scheme(typed: &str) -> bool {
    let Some((prefix, rest)) = typed.split_once(':') else {
        return false;
    };

    let starts_like_a_scheme = prefix
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
        && prefix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.');

    starts_like_a_scheme && !rest.starts_with(|c: char| c.is_ascii_digit())
}

/// Turn what somebody typed into a URL that is safe to put in a frame, or say
/// why it is not.
///
/// Three rules, and the third is the one that is not obvious.
///
/// **A scheme is added when one is missing**, because nobody types `http://`.
/// `localhost:5173` parses as a URL with scheme `localhost` otherwise, which is
/// a refusal for a thing the person got right.
///
/// **Only http and https are allowed.** `file:` reads the disk, `data:` and
/// `javascript:` inherit the embedding document's origin — which here is an
/// app frame, same-origin with the shell — and a custom scheme is somebody
/// else's protocol handler.
///
/// **A host under `.localhost` is refused.** Tauri decides whether an IPC
/// message may reach a command by asking whether its origin is the app's own,
/// and on Windows that test takes the first label of a `*.localhost` host and
/// looks it up among the registered custom protocols (`tauri::webview`'s
/// `is_local_url`). The port is not part of the test. So a page served from
/// `http://helve-tool.localhost:5173` answers that question *yes* and is
/// treated as local — with the full command surface behind it. Refusing the
/// whole suffix is broader than the hole and much easier to keep true than a
/// list of registered scheme names that grows.
fn normalize(raw: &str) -> Result<Target, Refusal> {
    let typed = raw.trim();
    if typed.is_empty() {
        return Err(Refusal::Empty);
    }

    let with_scheme = if states_a_scheme(typed) {
        typed.to_string()
    } else {
        format!("http://{typed}")
    };

    let url = Url::parse(&with_scheme).map_err(|_| Refusal::Unreadable)?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(Refusal::Scheme(url.scheme().to_string()));
    }

    let host = url.host_str().ok_or(Refusal::NoHost)?.to_ascii_lowercase();
    if host.ends_with(".localhost") {
        return Err(Refusal::ReservedHost(host));
    }

    Ok(Target {
        origin: url.origin().ascii_serialization(),
        url: url.to_string(),
    })
}

/// A rectangle to cut out of the window, in the top-level document's own CSS
/// pixels — which is not where the element was measured. The app walks the
/// frames between the two and hands over the result; see `useCapture`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Clip {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Read a clip out of a call's params, refusing anything that is not a real
/// rectangle.
///
/// `NaN` and infinities are checked for by name rather than trusted to compare
/// falsely: they arrive from JavaScript, where a subtraction between two rects
/// one of which was never laid out produces one, and the DevTools Protocol's
/// answer to a `NaN` in a clip is not one this code should have to know.
fn read_clip(params: Option<&Value>) -> Result<Clip, RpcError> {
    let number = |name: &str| -> Result<f64, RpcError> {
        params
            .and_then(|p| p.get(name))
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .ok_or_else(|| {
                RpcError::new(
                    INVALID_PARAMS,
                    format!("design/capture needs a finite `{name}`"),
                )
            })
    };

    let clip = Clip {
        x: number("x")?.max(0.0),
        y: number("y")?.max(0.0),
        width: number("width")?,
        height: number("height")?,
    };

    if clip.width < 1.0 || clip.height < 1.0 {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "that element has no area on screen to photograph",
        ));
    }

    Ok(clip)
}

/// Photograph one rectangle of the focused shell window.
///
/// **The focused window, not a named one.** `app_call` carries the cluster a
/// call came from but nothing maps a cluster to an operating system window, and
/// inventing that mapping is a change to the shell's own model rather than to
/// this app. The frontend closes the gap from its side instead: it refuses to
/// ask while `document.hasFocus()` is false, so the window being photographed
/// is the window the click happened in. A second HELVE window holding a second
/// Design Mode while this one has focus is the case that would otherwise be
/// answered with a picture of the wrong screen.
fn capture(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    let clip = read_clip(params)?;

    let shot = devtools::call(
        app,
        None,
        "Page.captureScreenshot",
        &json!({
            "format": "png",
            "captureBeyondViewport": false,
            "fromSurface": true,
            "clip": {
                "x": clip.x,
                "y": clip.y,
                "width": clip.width,
                "height": clip.height,
                "scale": 1.0,
            },
        }),
    )
    .map_err(|e| RpcError::new(INTERNAL_ERROR, e.message()))?;

    let data = shot
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new(INTERNAL_ERROR, "the window returned no image"))?;

    if data.len() > SCREENSHOT_LIMIT {
        return Err(RpcError::new(
            INVALID_PARAMS,
            "that element is too large to photograph — pick something smaller inside it",
        ));
    }

    Ok(json!({
        "dataUrl": format!("data:image/png;base64,{data}"),
        "width": clip.width,
        "height": clip.height,
    }))
}

/// Put the probe in front of every document the window loads from here on, and
/// hand back what removes it again.
///
/// `replaces` is the id of a previous install, dropped first. The app passes
/// its own last one, so re-arming after a navigation does not leave a second
/// copy of the probe behind — which would be harmless (the probe is idempotent)
/// but would accumulate for as long as the window lives.
fn arm(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    if let Some(previous) = params.and_then(|p| p.get("replaces")).and_then(Value::as_str) {
        // A removal that fails is not worth failing the arm over: the id may be
        // from a window that has since closed, and the outcome either way is
        // that the caller gets a working probe.
        let _ = devtools::remove_script(app, None, previous);
    }

    let id = devtools::install_script(app, None, PROBE)
        .map_err(|e| RpcError::new(INTERNAL_ERROR, e.message()))?;

    Ok(json!({ "scriptId": id }))
}

fn disarm(app: &AppHandle, params: Option<&Value>) -> Result<Value, RpcError> {
    let id = params
        .and_then(|p| p.get("scriptId"))
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new(INVALID_PARAMS, "design/disarm needs the scriptId to drop"))?;

    devtools::remove_script(app, None, id).map_err(|e| RpcError::new(INTERNAL_ERROR, e.message()))?;
    Ok(Value::Null)
}

fn target(params: Option<&Value>) -> Result<Value, RpcError> {
    let raw = params
        .and_then(|p| p.get("url"))
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new(INVALID_PARAMS, "design/target needs a url"))?;

    let resolved = normalize(raw).map_err(|why| RpcError::new(INVALID_PARAMS, why.message()))?;

    serde_json::to_value(&resolved)
        .map_err(|e| RpcError::new(INTERNAL_ERROR, format!("could not answer: {e}")))
}

/// Route one `invoke` from the Design Mode app.
///
/// The `CallContext` is ignored, as Tutorials' is: what is on screen here is a
/// URL somebody typed, not anything about the project a cluster is pointed at.
pub fn call(
    app: &AppHandle,
    _context: &CallContext,
    method: &str,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    match method {
        "design/target" => target(params.as_ref()),
        "design/arm" => arm(app, params.as_ref()),
        "design/disarm" => disarm(app, params.as_ref()),
        "design/capture" => capture(app, params.as_ref()),
        _ => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("no such method: {method}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_host_and_port_gets_a_scheme() {
        let target = normalize("localhost:5173").expect("a dev server address is ordinary input");
        assert_eq!(target.url, "http://localhost:5173/");
        assert_eq!(target.origin, "http://localhost:5173");
    }

    #[test]
    fn surrounding_whitespace_is_not_the_users_problem() {
        assert_eq!(
            normalize("  http://127.0.0.1:3000/  ").map(|t| t.url),
            Ok("http://127.0.0.1:3000/".to_string())
        );
    }

    #[test]
    fn https_is_kept_rather_than_downgraded() {
        let target = normalize("https://example.com/path").expect("https is allowed");
        assert_eq!(target.origin, "https://example.com");
    }

    /// The three schemes that would each be a different way of running code
    /// with the shell's own privileges, and one that is merely not a page.
    #[test]
    fn only_http_schemes_are_loadable() {
        for raw in [
            "file:///C:/Windows/System32/drivers/etc/hosts",
            "javascript://x/%0aalert(1)",
            "data:text/html,<h1>hi</h1>",
            "helve-tool://home/index.html",
        ] {
            assert!(
                matches!(normalize(raw), Err(Refusal::Scheme(_))),
                "{raw} should have been refused for its scheme"
            );
        }
    }

    /// The whole reason [`normalize`] exists. Tauri reads the first label of a
    /// `*.localhost` host as a custom protocol name and treats the page as
    /// local if it matches one — so this must never resolve, whatever the port.
    #[test]
    fn a_host_under_localhost_is_refused() {
        for raw in [
            "http://helve-tool.localhost:5173",
            "http://tauri.localhost",
            "https://ipc.localhost/anything",
            "http://SOMETHING.LocalHost:1234",
        ] {
            assert!(
                matches!(normalize(raw), Err(Refusal::ReservedHost(_))),
                "{raw} should have been refused as a reserved host"
            );
        }
    }

    /// Plain `localhost` is the address this feature exists to point at, and
    /// the rule above must not have taken it with the rest.
    #[test]
    fn plain_localhost_still_works() {
        assert!(normalize("http://localhost:1234").is_ok());
    }

    /// The bug this function was written for, kept as a test because both
    /// halves of it are one-character decisions: `localhost:5173` must not read
    /// as a scheme, and `data:` must.
    #[test]
    fn a_port_is_not_a_scheme_and_a_scheme_is_not_a_port() {
        assert!(!states_a_scheme("localhost:5173"));
        assert!(!states_a_scheme("127.0.0.1:3000"));
        assert!(!states_a_scheme("example.com"));
        assert!(states_a_scheme("http://localhost:5173"));
        assert!(states_a_scheme("data:text/html,x"));
        assert!(states_a_scheme("javascript:alert(1)"));
        assert!(states_a_scheme("file:///c:/x"));
    }

    #[test]
    fn nothing_typed_says_so_rather_than_failing_to_parse() {
        assert_eq!(normalize("   "), Err(Refusal::Empty));
    }

    /// Every refusal is read by somebody who has just typed something and been
    /// told no, so each has to say a different thing about what to do next.
    #[test]
    fn every_refusal_explains_itself_differently() {
        let messages = [
            Refusal::Empty.message(),
            Refusal::Unreadable.message(),
            Refusal::Scheme("file".to_string()).message(),
            Refusal::NoHost.message(),
            Refusal::ReservedHost("x.localhost".to_string()).message(),
        ];
        let unique: std::collections::HashSet<&String> = messages.iter().collect();
        assert_eq!(unique.len(), messages.len(), "two refusals read the same");
        for message in &messages {
            assert!(!message.trim().is_empty());
        }
    }

    #[test]
    fn a_clip_needs_four_finite_numbers() {
        let ok = read_clip(Some(&json!({"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0})));
        assert!(ok.is_ok());

        for missing in ["x", "y", "width", "height"] {
            let mut params = json!({"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0});
            if let Some(object) = params.as_object_mut() {
                object.remove(missing);
            }
            assert!(
                read_clip(Some(&params)).is_err(),
                "a clip without `{missing}` should be refused"
            );
        }
    }

    /// A zero-area element is a real thing to click — a collapsed wrapper, a
    /// hidden input — and the DevTools Protocol's answer to a zero-width clip
    /// is not one this code should be discovering at runtime.
    #[test]
    fn a_clip_with_no_area_is_refused() {
        let flat = read_clip(Some(&json!({"x": 0.0, "y": 0.0, "width": 0.0, "height": 10.0})));
        assert!(flat.is_err());
    }

    #[test]
    fn a_negative_origin_is_clamped_rather_than_refused() {
        // An element scrolled above the viewport reports a negative `y`, and
        // the useful answer is the part of it that is on screen.
        let clip = read_clip(Some(&json!({"x": -30.0, "y": -8.0, "width": 20.0, "height": 20.0})))
            .expect("a partly offscreen element is still worth photographing");
        assert_eq!(clip.x, 0.0);
        assert_eq!(clip.y, 0.0);
    }

    /// The probe is compiled in, and an empty one would arm a frame with
    /// nothing in it and report success.
    #[test]
    fn the_probe_is_present_and_guards_its_sender() {
        assert!(PROBE.len() > 1000, "the probe did not make it into the binary");
        assert!(
            PROBE.contains("event.source !== window.parent"),
            "the probe must only obey the frame that embedded it"
        );
        assert!(
            PROBE.contains("if (window.parent === window) return;"),
            "the probe must never arm in the shell's own top frame"
        );
    }
}
