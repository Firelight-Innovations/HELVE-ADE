//! The DevTools Protocol, spoken to the webview this process is already running.
//!
//! WebView2 is Chromium, and `ICoreWebView2::CallDevToolsProtocolMethod` is the
//! same protocol Chrome exposes over `--remote-debugging-port` — reached through
//! the COM interface Tauri already holds, rather than over a socket. That
//! difference is the whole reason this module exists; the argument for it is in
//! `docs/design-notes/agent-ui-driving.md`.
//!
//! Everything here is transport. What the calls *mean* — which ones make a
//! click, what a snapshot is — belongs to `mcp::servers::ui`.

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

/// How long one call may take before we stop waiting for it.
///
/// Generous, because the answer comes back through the main thread and a shell
/// busy laying out a large tree can take a moment to get to it. Bounded, because
/// the caller is an HTTP request from an agent, and a hung tool is worse than a
/// failed one: the agent has nothing to read and no reason to stop waiting.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Never a target. The splash window has no shell in it, and picking it because
/// it happened to have focus during boot would answer a question about HELVE
/// with a screenshot of a progress bar.
const SPLASH: &str = "splash";

/// Why a call did not produce an answer.
///
/// Deliberately not a `tauri::Error` or a bare `String`: each of these means
/// something different to whoever reads it, and the tool layer turns them into
/// sentences a model can act on.
#[derive(Debug)]
pub enum Error {
    /// No window to act on, or none by that name.
    NoWindow(String),
    /// The call could not be made, or was made and came back a failure.
    ///
    /// One variant rather than two because the distinction is not one the caller
    /// can act on: either way nothing happened to the window, and either way the
    /// string is what says why.
    Refused(String),
    /// [`TIMEOUT`] elapsed with nothing back.
    TimedOut,
}

impl Error {
    pub fn message(&self) -> String {
        match self {
            Error::NoWindow(what) => what.clone(),
            Error::Refused(why) => why.clone(),
            Error::TimedOut => format!(
                "the webview did not answer within {}s — it may be blocked on a native dialog, \
                 which nothing here can dismiss",
                TIMEOUT.as_secs()
            ),
        }
    }
}

/// One DevTools Protocol call, and its result.
///
/// **Never call this from the main thread.** The work is posted there and this
/// blocks until it comes back, so the main thread waiting on itself is a
/// deadlock that lasts until [`TIMEOUT`]. Every caller today is an MCP tool,
/// which runs on a runtime worker.
pub fn call(
    app: &AppHandle,
    window: Option<&str>,
    method: &str,
    params: &Value,
) -> Result<Value, Error> {
    dispatch(&pick(app, window)?, method, params.to_string())
}

/// Which window a call acts on.
///
/// Named, else focused, else whichever sorts first — and never the splash. The
/// fallback is deterministic rather than arbitrary because an agent that takes
/// two screenshots in a row should get two of the same window, and a `HashMap`'s
/// iteration order would not promise that.
fn pick(app: &AppHandle, wanted: Option<&str>) -> Result<WebviewWindow, Error> {
    if let Some(label) = wanted {
        return app
            .get_webview_window(label)
            .ok_or_else(|| Error::NoWindow(format!("no window is labelled `{label}` right now")));
    }

    let mut open: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label != SPLASH)
        .map(|(_, window)| window)
        .collect();

    if let Some(focused) = open.iter().find(|w| w.is_focused().unwrap_or(false)) {
        return Ok(focused.clone());
    }

    open.sort_by(|a, b| a.label().cmp(b.label()));
    open.into_iter()
        .next()
        .ok_or_else(|| Error::NoWindow("no shell window is open".to_string()))
}

#[cfg(windows)]
fn dispatch(window: &WebviewWindow, method: &str, params: String) -> Result<Value, Error> {
    use std::sync::mpsc::{self, RecvTimeoutError};
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;

    let (tx, rx) = mpsc::channel();
    let wanted = method.to_string();

    // `with_webview` posts to the main thread, where the WebView2 COM objects
    // live and are the only place they may be touched. The closure returns
    // nothing, so both the failure to start the call and its eventual answer
    // come back the same way: down the channel.
    let posted = window.with_webview(move |webview| {
        let answer = tx.clone();
        let started = (|| -> windows_core::Result<()> {
            let core = unsafe { webview.controller().CoreWebView2() }?;
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |result, json| {
                    let _ = answer.send(result.map(|()| json));
                    Ok(())
                },
            ));

            unsafe {
                core.CallDevToolsProtocolMethod(
                    &HSTRING::from(wanted.as_str()),
                    &HSTRING::from(params.as_str()),
                    &handler,
                )
            }
        })();

        if let Err(e) = started {
            let _ = tx.send(Err(e));
        }
    });

    if let Err(e) = posted {
        return Err(Error::Refused(format!(
            "the window would not take the call: {e}"
        )));
    }

    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(json)) => serde_json::from_str(&json)
            .map_err(|e| Error::Refused(format!("`{method}` answered something unreadable: {e}"))),
        Ok(Err(e)) => Err(Error::Refused(format!("`{method}` was refused: {e}"))),
        Err(RecvTimeoutError::Timeout) => Err(Error::TimedOut),
        Err(RecvTimeoutError::Disconnected) => Err(Error::Refused(format!(
            "the window went away while `{method}` was in flight"
        ))),
    }
}

/// Nothing to talk to. WebView2 is what speaks this protocol, and it is the
/// Windows webview — so on any other platform every tool on the UI server fails
/// with this rather than the module being compiled out. A server that is missing
/// on one platform and present on another is a harder thing to explain to
/// somebody than a tool that says why it cannot run.
#[cfg(not(windows))]
fn dispatch(_window: &WebviewWindow, _method: &str, _params: String) -> Result<Value, Error> {
    Err(Error::Refused(
        "driving the UI needs WebView2, which only the Windows build has".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each variant has to say something different, because they are the whole
    /// of what a model gets back when a tool fails: "no window" and "the webview
    /// is stuck" call for opposite next moves.
    #[test]
    fn every_failure_explains_itself_differently() {
        let messages = [
            Error::NoWindow("no window is labelled `main` right now".to_string()).message(),
            Error::Refused("`Input.dispatchMouseEvent` was refused".to_string()).message(),
            Error::TimedOut.message(),
        ];

        for message in &messages {
            assert!(!message.trim().is_empty(), "a failure must say something");
        }

        let unique: std::collections::HashSet<&String> = messages.iter().collect();
        assert_eq!(unique.len(), messages.len(), "two failures read the same");
    }

    /// A timeout is the one failure whose cause is usually a native dialog, and
    /// that is not guessable from "it did not answer" — so the message names it.
    #[test]
    fn the_timeout_names_the_thing_that_usually_caused_it() {
        let message = Error::TimedOut.message();
        assert!(message.contains("dialog"), "unhelpful timeout: {message}");
        assert!(message.contains(&TIMEOUT.as_secs().to_string()));
    }
}
