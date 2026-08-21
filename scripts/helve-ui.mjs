/**
 * Drive HELVE's UI from outside it: screenshot, read, click, type.
 *
 * Usage (see `pnpm ui help` for the full list):
 *   pnpm ui launch                 start an agent-owned HELVE with a debug port
 *   pnpm ui shot [file.png]        screenshot the window
 *   pnpm ui snapshot               every interactive element, with a ref to click
 *   pnpm ui click e12              click a ref from the last snapshot
 *   pnpm ui type "hello"           type into whatever has focus
 *   pnpm ui key Enter              press one key
 *   pnpm ui eval "document.title"  run JS in the shell and print the result
 *   pnpm ui console                console messages since the page loaded
 *   pnpm ui close                  stop the agent instance
 *
 * This talks Chrome DevTools Protocol to the WebView2 the app already runs, so
 * it sees the real shell with the real Rust backend under it — not a browser
 * serving the frontend alone. `docs/design-notes/agent-ui-driving.md` has why
 * that distinction sank the previous attempt.
 */

import { writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

/** Where the debug port listens. Not 1420 or 1430 — those are Vite's, and this is not Vite. */
const PORT = Number(process.env.HELVE_UI_PORT ?? 9222);

/**
 * A separate app identity, so an agent's HELVE and Braden's can run at once.
 *
 * `tauri-plugin-single-instance` keys its mutex on `{identifier}-sim`, and every
 * store resolves its path through `app_config_dir()`, which derives from the
 * same field. One override therefore buys both a second process and a private
 * `%APPDATA%` tree — see `docs/design-notes/agent-ui-driving.md`.
 */
const IDENTIFIER = "com.firelightinnovations.helve.agent";

/**
 * The built binary, honouring `CARGO_TARGET_DIR`.
 *
 * Worktree agents share one warm target directory rather than each paying for a
 * cold Tauri build, so the binary is routinely nowhere near `process.cwd()`.
 */
const TARGET_DIR = process.env.CARGO_TARGET_DIR ?? join(process.cwd(), "target");
const EXE = join(TARGET_DIR, "release", "helve-orchestrator.exe");

/**
 * WebView2's profile for the agent instance, kept beside the binary.
 *
 * Deliberately not derived from `TEMP`: run from Git Bash, that variable holds a
 * POSIX path, and WebView2 given `/tmp\...` fails to create its environment and
 * takes the whole app down at startup with nothing on stderr to say why — the
 * process simply is not there a second later.
 */
const PROFILE_DIR = join(TARGET_DIR, "helve-agent-webview2");

function die(message) {
  process.stderr.write(`helve-ui: ${message}\n`);
  process.exit(1);
}

function note(message) {
  process.stderr.write(`helve-ui: ${message}\n`);
}

/* --- the CDP connection ----------------------------------------------------- */

/**
 * Attach to the page target.
 *
 * A WebView2 app can hold several targets — every detached HELVE window is one —
 * so `--window` picks by title when there is more than one.
 */
async function attach(titleMatch) {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    die(`nothing is listening on ${PORT}. Run \`pnpm ui launch\` first.`);
  }

  const pages = targets.filter((t) => t.type === "page");
  if (pages.length === 0) die("HELVE is running but has no page target yet; try again in a moment");

  const page = titleMatch
    ? pages.find((p) => p.title.includes(titleMatch) || p.url.includes(titleMatch))
    : pages[0];
  if (!page) die(`no window matching ${JSON.stringify(titleMatch)}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let id = 0;

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("the debug socket refused a connection")));
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  return { ws, send, events, close: () => ws.close() };
}

/**
 * Evaluate JS in the page and return its value.
 *
 * An exception comes back as a thrown `Error` rather than as `undefined`, so a
 * selector typo reads as a failure instead of as an empty result.
 */
async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const reply = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });

  const details = reply.result?.exceptionDetails;
  if (details) throw new Error(details.exception?.description ?? details.text);

  return reply.result?.result?.value;
}

/* --- the page-side helpers -------------------------------------------------- */

/**
 * Injected once per command, and idempotent.
 *
 * Refs are held in an array on `window` rather than written onto elements as
 * attributes. Stamping the app's own DOM to make it clickable would mean this
 * tool changing the thing it is supposed to be observing, and a stray attribute
 * surviving in a screenshot or a CSS selector is a real way to send someone
 * chasing a bug that is ours.
 *
 * Same-origin iframes are walked into. HELVE mounts every app as an iframe on
 * `tauri.localhost`, so an agent that stopped at the frame boundary would see
 * the shell and none of the actual app content.
 */
const PAGE_HELPERS = `
window.__helveUi = window.__helveUi || {};
window.__helveUi.refs = window.__helveUi.refs || [];

window.__helveUi.docs = function () {
  const out = [{ doc: document, offset: { x: 0, y: 0 } }];
  for (const frame of document.querySelectorAll('iframe')) {
    let inner = null;
    try { inner = frame.contentDocument; } catch { inner = null; }
    if (!inner) continue;
    const box = frame.getBoundingClientRect();
    out.push({ doc: inner, offset: { x: box.x, y: box.y } });
  }
  return out;
};

window.__helveUi.visible = function (el, doc) {
  const style = (doc.defaultView || window).getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};

window.__helveUi.label = function (el) {
  const text = (el.getAttribute('aria-label') || el.innerText || el.value || '')
    .replace(/\\s+/g, ' ')
    .trim();
  return text.slice(0, 80);
};

window.__helveUi.snapshot = function (selector) {
  const chosen = selector || 'button,a,input,textarea,select,[role=button],[role=menuitem],[role=tab],[contenteditable=true],[tabindex]';
  window.__helveUi.refs = [];
  const rows = [];

  for (const { doc, offset } of window.__helveUi.docs()) {
    for (const el of doc.querySelectorAll(chosen)) {
      if (!window.__helveUi.visible(el, doc)) continue;
      const box = el.getBoundingClientRect();
      const ref = 'e' + window.__helveUi.refs.length;
      window.__helveUi.refs.push(el);
      rows.push({
        ref,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        label: window.__helveUi.label(el),
        frame: offset.x === 0 && offset.y === 0 ? 'shell' : 'app',
        x: Math.round(offset.x + box.x + box.width / 2),
        y: Math.round(offset.y + box.y + box.height / 2),
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      });
    }
  }
  return rows;
};

window.__helveUi.locate = function (ref) {
  const byRef = /^e\\d+$/.test(ref) ? window.__helveUi.refs[Number(ref.slice(1))] : null;
  let el = byRef;
  let offset = { x: 0, y: 0 };

  if (!el) {
    for (const entry of window.__helveUi.docs()) {
      const found = entry.doc.querySelector(ref);
      if (found) { el = found; offset = entry.offset; break; }
    }
  } else {
    for (const entry of window.__helveUi.docs()) {
      if (entry.doc.contains(el)) { offset = entry.offset; break; }
    }
  }

  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const box = el.getBoundingClientRect();
  return {
    x: Math.round(offset.x + box.x + box.width / 2),
    y: Math.round(offset.y + box.y + box.height / 2),
    label: window.__helveUi.label(el),
  };
};
`;

/* --- the commands ----------------------------------------------------------- */

async function shot(cdp, file) {
  const reply = await cdp.send("Page.captureScreenshot", { format: "png" });
  if (!reply.result?.data) die("the screenshot came back empty; is the window minimized?");

  const bytes = Buffer.from(reply.result.data, "base64");
  writeFileSync(file, bytes);
  note(`wrote ${file} (${bytes.length} bytes)`);
}

async function snapshot(cdp, selector) {
  await evaluate(cdp, PAGE_HELPERS);
  const argument = selector ? JSON.stringify(selector) : "null";
  const rows = await evaluate(cdp, `JSON.stringify(window.__helveUi.snapshot(${argument}))`);
  const parsed = JSON.parse(rows);

  if (parsed.length === 0) {
    note("nothing interactive matched. The window may still be booting.");
    return;
  }

  for (const row of parsed) {
    const kind = row.role || row.tag;
    const flags = row.disabled ? " [disabled]" : "";
    process.stdout.write(
      `${row.ref.padEnd(5)} ${row.frame.padEnd(5)} ${kind.padEnd(10)} ` +
        `(${String(row.x).padStart(4)},${String(row.y).padStart(4)}) ${row.label}${flags}\n`,
    );
  }
}

/**
 * A real mouse event at the element's centre, not a synthetic `el.click()`.
 *
 * The difference matters here: HELVE's menus and drag handles listen for
 * pointer events and for focus moving, and a dispatched DOM click skips both.
 * Clicking where the element actually is exercises the same path a person does.
 */
async function click(cdp, target) {
  await evaluate(cdp, PAGE_HELPERS);
  const found = await evaluate(
    cdp,
    `JSON.stringify(window.__helveUi.locate(${JSON.stringify(target)}))`,
  );
  const at = JSON.parse(found ?? "null");
  if (!at)
    die(`no element for ${JSON.stringify(target)}. Run \`pnpm ui snapshot\` for current refs.`);

  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: at.x,
      y: at.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
  }

  note(`clicked ${target} — ${at.label || "(no label)"} at ${at.x},${at.y}`);
}

async function type(cdp, text) {
  for (const char of text) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: char });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", text: char });
  }
  note(`typed ${text.length} characters`);
}

/**
 * Named keys that need a `windowsVirtualKeyCode` to register.
 *
 * A printable character can go through as `text` alone, but Enter, Tab, Escape
 * and the arrows are read from the key code, and arrive as nothing without one.
 */
const KEYS = {
  Enter: { code: 13, key: "Enter", text: "\r" },
  Tab: { code: 9, key: "Tab" },
  Escape: { code: 27, key: "Escape" },
  Backspace: { code: 8, key: "Backspace" },
  Delete: { code: 46, key: "Delete" },
  ArrowUp: { code: 38, key: "ArrowUp" },
  ArrowDown: { code: 40, key: "ArrowDown" },
  ArrowLeft: { code: 37, key: "ArrowLeft" },
  ArrowRight: { code: 39, key: "ArrowRight" },
};

async function key(cdp, name) {
  const spec = KEYS[name];
  if (!spec) die(`unknown key ${JSON.stringify(name)}. Known: ${Object.keys(KEYS).join(", ")}`);

  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: spec.key,
      windowsVirtualKeyCode: spec.code,
      nativeVirtualKeyCode: spec.code,
      ...(spec.text && type === "keyDown" ? { text: spec.text } : {}),
    });
  }
  note(`pressed ${name}`);
}

/**
 * Console messages, collected by enabling the domain and reloading nothing.
 *
 * Only what arrives while this command is connected can be seen — CDP has no
 * backlog. For failures that happened earlier, `pnpm probe recent_errors` reads
 * the ring buffer the app keeps for exactly that reason.
 */
async function consoleTail(cdp, seconds) {
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  note(`listening for ${seconds}s…`);
  await new Promise((r) => setTimeout(r, seconds * 1000));

  const lines = cdp.events
    .filter((e) => e.method === "Runtime.consoleAPICalled" || e.method === "Log.entryAdded")
    .map((e) =>
      e.method === "Log.entryAdded"
        ? `${e.params.entry.level}: ${e.params.entry.text}`
        : `${e.params.type}: ${e.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`,
    );

  if (lines.length === 0) note("nothing was logged in that window");
  for (const line of lines) process.stdout.write(`${line}\n`);
}

/**
 * Start an agent-owned HELVE with the debug port open.
 *
 * The port comes from an environment variable read by the WebView2 loader, not
 * from anything compiled in — so the shipped binary carries no debug channel
 * unless someone deliberately hands it one at launch.
 */
function launch() {
  if (!existsSync(EXE)) {
    die(
      `no binary at ${EXE}.\n` +
        `           Build one with \`pnpm ui:build\`, which sets the agent identifier so this\n` +
        `           instance can run beside a HELVE you started yourself.`,
    );
  }

  const child = spawn(EXE, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      // A private profile. Sharing WebView2's user-data folder between two
      // instances makes the second join the first's browser-process group,
      // which silently ignores these arguments.
      WEBVIEW2_USER_DATA_FOLDER: PROFILE_DIR,
    },
  });
  child.unref();
  note(`launched ${EXE} with a debug port on ${PORT} (identifier ${IDENTIFIER})`);
  note("give it a few seconds, then: pnpm ui shot");
}

const HELP = `helve-ui — drive HELVE's UI over the WebView2 debug port

  launch                 start an agent-owned HELVE with the debug port open
  shot [file]            screenshot to file (default helve-ui.png)
  snapshot [selector]    interactive elements, each with a ref and a position
  click <ref|selector>   click a ref from the last snapshot, or any CSS selector
  type <text>            type into whatever has focus
  key <name>             ${Object.keys(KEYS).join(", ")}
  eval <js>              run JS in the shell and print the result
  console [seconds]      console output while listening (default 5)
  close                  stop the agent-owned instance

  --window <match>       pick a window by title or URL when several are open
`;

async function main() {
  const args = process.argv.slice(2);

  let windowMatch = null;
  const at = args.indexOf("--window");
  if (at !== -1) {
    windowMatch = args[at + 1];
    args.splice(at, 2);
  }

  const [command, ...rest] = args;

  if (!command || command === "help") {
    process.stdout.write(HELP);
    return;
  }

  if (command === "launch") return launch();

  if (command === "close") {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("taskkill", ["/IM", "helve-orchestrator.exe", "/F"], { stdio: "ignore" });
      note("stopped helve-orchestrator.exe");
    } catch {
      note("nothing to stop");
    }
    return;
  }

  const cdp = await attach(windowMatch);
  try {
    switch (command) {
      case "shot":
        await shot(cdp, rest[0] ?? "helve-ui.png");
        break;
      case "snapshot":
        await snapshot(cdp, rest[0]);
        break;
      case "click":
        if (!rest[0]) die("click needs a ref or a CSS selector");
        await click(cdp, rest[0]);
        break;
      case "type":
        if (rest[0] === undefined) die("type needs some text");
        await type(cdp, rest.join(" "));
        break;
      case "key":
        if (!rest[0]) die("key needs a key name");
        await key(cdp, rest[0]);
        break;
      case "eval": {
        if (!rest[0]) die("eval needs an expression");
        const value = await evaluate(cdp, rest.join(" "), { awaitPromise: true });
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
        break;
      }
      case "console":
        await consoleTail(cdp, Number(rest[0] ?? 5));
        break;
      default:
        die(`unknown command ${JSON.stringify(command)}. Try \`pnpm ui help\`.`);
    }
  } finally {
    cdp.close();
  }
}

main().catch((e) => die(e.stack ?? String(e)));
