# Agent UI driving

How an agent sees and clicks HELVE's actual interface, and why the obvious
approaches did not work.

## scripts/helve-ui.mjs

### Why not a browser

The first attempt served the frontend to Chrome. That gives a DOM, and nothing
else: every `invoke` fails, so there is no stack, no apps, no terminals and no
project — the shell mounts over an empty backend. What it shows is a layout, not
the software. The `?fake=1` fixture that once answered those calls was 3930 lines
of second backend and was deleted for being one.

This drives the WebView2 that HELVE already runs, so what is on screen is the
real shell over the real Rust. Nothing is simulated and nothing is served twice.

### Why CDP, and why it needs no debug build

WebView2 is Chromium, and `--remote-debugging-port` opens the same DevTools
Protocol endpoint desktop Edge exposes. The flag arrives through
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, an environment variable the WebView2
loader reads at process start — **outside Tauri entirely**.

That is the load-bearing property. The debug channel is not compiled in, not
feature-gated, and not present in the shipped binary: it exists only for a
process someone deliberately launched with that variable set. So the usual rule
about never shipping a debug channel in release is satisfied without a separate
build, and the binary an agent drives is the same one a user runs.

Two alternatives were rejected. `additionalBrowserArgs` in `tauri.conf.json` is
compile-time, and per Tauri's own docs it *replaces* wry's default
`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` rather than
appending to it, so using it means re-adding those by hand; two open Tauri issues
also report it causing blank windows. The HKLM registry policy works but applies
to every future launch of the named executable, which is a standing debug channel
on someone's daily driver.

### Why a separate identifier

`tauri-plugin-single-instance` builds its mutex name as `{identifier}-sim`, so a
second launch under the same identifier relays its argv to the first process and
exits. An agent launching HELVE would therefore be swallowed by a HELVE the user
already had open — and, worse, the surviving process is the user's, so anything
that then "cleans up its own instance" kills their window.

`pnpm ui:build` overrides `identifier` to `com.firelightinnovations.helve.agent`.
Every store also resolves its path through `app_config_dir()`, which derives from
the same field, so that single override buys both a second process and a private
`%APPDATA%` tree. The agent instance cannot collide with the user's and cannot
corrupt their layout, project list or settings.

### What CDP turned out to give

Verified against a running build rather than assumed:

- **Screenshots** of the composited window, including app iframe content.
- **DOM across frames.** Apps mount as iframes on `tauri.localhost`, which is the
  same origin as the shell, so `contentDocument` reads straight through. An agent
  sees app content, not just the shell around it. This was the open question; it
  could easily have gone the other way.
- **Real input.** `Input.dispatchMouseEvent` at an element's centre, rather than
  a synthetic `el.click()`. HELVE's menus and drag handles listen for pointer
  events and for focus moving, and a dispatched DOM click skips both.
- **The whole backend, incidentally.** `withGlobalTauri` is on and `csp` is null,
  so `Runtime.evaluate` can call `window.__TAURI__.core.invoke(...)`. Anything
  holding the debug port has every `#[tauri::command]` available to it. That is
  the real reason the port must never be open on a build a user is running.

### Refs, and not stamping the DOM

`snapshot` numbers elements `e0`, `e1`, … and keeps them in an array on `window`
rather than writing `data-` attributes onto the app's own elements. A tool that
marks up the DOM changes the thing it is meant to be observing, and a stray
attribute surviving into a screenshot or a CSS selector sends someone chasing a
bug that belongs to the tooling.

Refs are renumbered by every `snapshot`, so a stale ref from two snapshots ago
points somewhere arbitrary. `click` also accepts a plain CSS selector for cases
where that matters.

### The TEMP trap

`WEBVIEW2_USER_DATA_FOLDER` is anchored to the target directory, not to `TEMP`.
Run from Git Bash, `TEMP` holds a POSIX path; WebView2 handed `/tmp\...` fails to
create its environment and takes the whole app down during startup, with nothing
on stderr to say why — the process simply is not there a second later. That cost
a debugging pass, and it is the kind of failure that looks like "the app is
broken" rather than "the path was wrong".

A private profile is needed regardless: two instances sharing one user-data
folder make the second join the first's browser-process group, which silently
ignores its browser arguments — including the debug port.

## Relationship to the MCP debug server

`pnpm probe` (see `agent-debugging.md`) and `pnpm ui` answer different questions
and neither replaces the other. The probe reads Rust-side truth — the state the
backend holds and the failures it recorded — and works against any running HELVE
with no special launch. `pnpm ui` sees pixels and the DOM, and needs an instance
launched with the debug port.

The probe's ring buffer also keeps failures from *before* the tool connected,
which CDP cannot: `Runtime.consoleAPICalled` only delivers what happens while a
client is attached.
