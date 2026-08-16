# The Helve tool protocol — v1

The wire contract between the orchestrator and a tool. This is the reference
implementations are written against; if code and this document disagree, one of
them is a bug.

For *why* the design is shaped this way, see
`company/docs/design/helve-tool-integration.md`. This file is the mechanical
half: exact bytes, exact field names.

A tool is a **Rust core** plus a **React frontend**. Under the tool's own Tauri
app those two halves talk over Tauri IPC. Under the orchestrator they don't talk
to each other at all — the frontend talks to the shell, and the shell talks to
the core. Two transports, one logical call:

```
              ┌─────────────── orchestrator (shell) ────────────────┐
  iframe      │                                                     │   child process
 ┌────────┐   │  ┌─────────┐                      ┌──────────────┐  │   ┌──────────┐
 │ tool   │◄──┼─►│ window  │◄────── broker ──────►│ stdin/stdout │◄─┼──►│ tool     │
 │ ui     │   │  │ message │   (transport B)      │  (transport A)│  │   │ core     │
 └────────┘   │  └─────────┘                      └──────────────┘  │   └──────────┘
              └─────────────────────────────────────────────────────┘
```

Both transports carry the same `method` string and the same `params`. The broker
is a relay, not a translator.

---

## 1. `helve-tool.toml`

Lives at the root of a tool's checkout. `helve.toml` (the stack manifest) says
*which* tools exist and at what version; `helve-tool.toml` says *how to run* the
one it sits next to.

```toml
[tool]
id      = "echo"          # must equal the [[tool]] id in helve.toml
version = "0.1.0"         # semver

[frontend]
dist    = "ui/dist"       # built bundle, relative to the checkout root
dev-url = "http://localhost:5174"   # optional; the tool's own Vite server

[core]
bin  = "target/debug/helve-echo-tool"   # relative to the checkout root
args = ["--helve-rpc"]                  # optional, default ["--helve-rpc"]

[permissions]             # optional; reserved, ignored by the broker today
```

Rules:

- Every path is **relative to the checkout root** (the directory holding
  `helve-tool.toml`). Rejected: absolute paths, any `..` component, and
  anything resolving to the checkout root itself — a `dist` of `""` would
  otherwise serve the tool's whole checkout, `.git` included.
  *Known gap:* a symlink inside the checkout still escapes it, because paths
  are not canonicalized. That belongs to the later security pass, along with
  per-tool permissions.
- `id` matches `^[a-z][a-z0-9-]*$`. Rejecting anything else keeps ids safe to use
  as URL authorities and directory names later.
- `version` parses as semver.
- Unknown keys are an **error**, not a warning. A typo'd key that is silently
  ignored is a bug that only shows up at runtime.
- On Windows, `bin` may omit `.exe`; a resolver tries `bin` then `bin.exe`.
- `dev-url` is only consulted by a development build of the orchestrator.

## 2. Transport A — shell ↔ tool core (standard streams)

The orchestrator runs the core as a child process and speaks **JSON-RPC 2.0 over
newline-delimited JSON** on its standard streams.

- One JSON object per line, UTF-8, terminated by `\n`. No `Content-Length`
  framing. (Raw newlines can't appear inside a JSON string unescaped, so a line
  is always a whole message.)
- **stdout carries protocol traffic and nothing else.** A stray `println!` in a
  tool corrupts the stream. Logging goes to **stderr**, which the orchestrator
  captures and tags with the tool id.
- A whole message is written under one lock, so a tool may send notifications
  from any thread — a file watcher, a build reporter — without interleaving
  bytes into another message. That only holds for writes made through
  `helve-rpc`; raw writes to stdout are still the tool's own problem.
- The child exits when its stdin closes. That is what makes orphan processes
  impossible: kill the orchestrator, every pipe closes, every tool exits.

### Messages

Request (host → tool, or tool → host):

```json
{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"hi"}}
```

Success response:

```json
{"jsonrpc":"2.0","id":1,"result":{"text":"hi"}}
```

Error response:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no such method: frobnicate"}}
```

Notification — no `id`, no response expected. This is how a tool pushes an event
without being asked:

```json
{"jsonrpc":"2.0","method":"file/changed","params":{"path":"a.txt"}}
```

`id` is a positive integer allocated by whichever side sends the request. A
response **must** echo the request's `id`. Ids from the two directions are
independent; they never collide because a response is always matched against the
pending table of the side that sent the request.

### Reserved methods

Every tool core must implement these. The `helve/` prefix is reserved; tools
must not define their own methods under it.

> The methods a *first-party app* answers are not part of this protocol and are
> not listed here — this document is the transport. The Files app's surface,
> which is the one an agent is most likely to drive, is
> [`docs/files-app-methods.md`](files-app-methods.md).

| Method | Params | Result |
|---|---|---|
| `helve/hello` | `{"protocol":1,"session":Session}` | `{"id":string,"version":string,"protocol":1}` |
| `helve/shutdown` | none | `null` |

`helve/hello` is the first message on the pipe, always sent by the host. The host
rejects the tool if `protocol != 1` or if `id` disagrees with `helve-tool.toml`.

`helve/shutdown` asks for a clean exit: reply, then exit. The host waits two
seconds after the reply and then kills the process.

### Error codes

Standard JSON-RPC, plus a Helve range:

| Code | Meaning |
|---|---|
| `-32700` | Parse error — the line was not valid JSON |
| `-32600` | Invalid request — valid JSON, wrong shape |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error inside the handler |
| `-32000` | Tool process exited or crashed (generated by the host) |
| `-32001` | Request timed out (generated by the host) |
| `-32002` | Handshake failed (generated by the host) |

## 3. Transport B — tool frontend ↔ shell (window messages)

The frontend runs in an iframe on a different origin from the shell, so the two
talk with `postMessage`. Every message carries `helve: 1` as a version marker and
a cheap way to ignore traffic from anything else sharing the window.

Frontend → shell:

```jsonc
{"helve":1,"kind":"hello"}
{"helve":1,"kind":"request","id":1,"method":"echo","params":{"text":"hi"}}
```

Shell → frontend:

```jsonc
{"helve":1,"kind":"ready","toolId":"echo","protocol":1,"session":{...}}
{"helve":1,"kind":"response","id":1,"result":{"text":"hi"}}
{"helve":1,"kind":"response","id":1,"error":{"code":-32601,"message":"..."}}
{"helve":1,"kind":"event","event":"file/changed","payload":{"path":"a.txt"}}
{"helve":1,"kind":"command","command":"file/save"}
```

### The handshake is client-initiated, and that is load-bearing

The iframe sends `hello`; the shell answers `ready`. Not the other way around.

If the shell announced first, it would be racing the iframe's script load and
message listener registration — and a window message that arrives before a
listener exists is simply gone, with no replay. That is the same class of bug the
splash window already hit with Tauri events (see `src-tauri/src/boot.rs`). Having
the side that *knows* it is ready speak first removes the race instead of
papering over it with a poll.

The bridge queues any `invoke` made before `ready` arrives and flushes the queue
on handshake, so tool code never has to think about this.

### Reserved methods

The `helve/` prefix is reserved on this transport too, and for the same reason:
the shell answers these itself and never forwards them to a core.

| Method | Params | Result | Meaning |
|---|---|---|---|
| `helve/painted` | none | `null` | This frontend has drawn its first meaningful content. |
| `helve/commands` | `{"commands":string[]}` | `null` | These are the menu commands this frontend can carry out **right now**. |
| `helve/title` | `{"title":string}` | `null` | Call this surface's tab something other than its app's name. |
| `helve/open` | `{"appId":string,"payload"?:any}` | `{"instanceId":string}` | Put something on screen in another app, in my cluster. |
| `helve/publish` | `{"topic":string,"value":any}` | `null` | State a fact about myself for my cluster-mates to read. |

`helve/painted` is a report, not a request. The orchestrator holds its splash
window up until every first-party app has sent one, so that the window it hands
off to is finished rather than still filling in — see `src-tauri/src/boot.rs`.
A host with nothing waiting on it acknowledges and does nothing, which is what
a tool's own standalone Tauri app does.

Two rules make it worth trusting. It is sent *after* the content is committed
to the DOM, not when the call that fetched it resolved — a frontend that
reported on the promise would be claiming a screen that does not exist yet. And
it identifies the frontend the same way every other message here does: the shell
resolves the id from `event.source`, so a frame can only ever report about
itself.

The host may stop waiting. It does not wait forever, and a report that arrives
after it gave up is discarded rather than being an error.

### Menu commands

The orchestrator's title bar has a menu bar, and its File, Edit and View menus
have to operate whatever is showing. The shell cannot reach into a frame to do
that — a frame is a separate document, and for a tool a separate origin — so a
menu item becomes a `command` message aimed at the **active** frame.

```jsonc
{"helve":1,"kind":"command","command":"file/save"}
```

It is fire-and-forget. There is no `id` and no reply, because the only thing the
menu needed to know was answered before the item was ever clickable, and the
menu has closed by the time anything could come back.

A `command` is deliberately **not** an `event`. The two make opposite claims: an
event is news the frame may ignore, a command is an instruction the user just
gave. A frontend registers for one without having to filter out the other.

#### The frontend declares; the shell never assumes

`helve/commands` is the other half, and it is the half that makes this design
work. A menu offering Save when nothing is dirty is a menu that lies — and the
shell cannot know when that is, because whether there is anything to save is a
fact about the frontend's own state.

So the direction is reversed. The frontend sends `helve/commands` with the set
it can carry out at this moment, and the shell **disables every item not in that
set**. The last declaration replaces the previous one; it does not add to it.
A frame that has never declared anything can do nothing, which is the honest
starting point rather than an awkward default.

The consequence worth naming: **the shell holds no list of any app's
capabilities.** It knows a set of command id strings and nothing about what they
mean. That is what keeps the next surface to arrive from breaking the menu — it
declares nothing, so its menu is honestly inert, and no code in the title bar
had to be told it exists.

The shell drops a command the target has not declared, rather than sending it
anyway. Reaching that point means the two disagreed, and a frame acting on
something it said it could not do is the worse outcome.

Command ids are the host's vocabulary, not the protocol's — this document does
not enumerate them, the same way it does not enumerate an app's methods. The
orchestrator's are in `src/shell/titlebar/TitleBar.tsx` (`APP_COMMAND`).

`@helve/bridge` exposes both halves as `onCommand` and `declareCommands`. The
declaration is de-duplicated against the last one actually sent, because the
natural place to call it is an effect that runs on every render.

### Frames talking to each other

`helve/open` and `helve/publish` are how one frontend reaches **another
frontend** — sideways, through the shell, without either of them learning the
other exists. Everything else on this transport goes down to a host and back.

Neither travels through a tool core or through Rust. Both frames are already in
the same browser, and the layout that decides *which* frame is a fact only the
shell holds.

#### `helve/open` — put this on screen somewhere else

```jsonc
{"helve":1,"kind":"request","id":7,"method":"helve/open",
 "params":{"appId":"viewer","payload":{"path":"a.txt","preview":true}}}
```

The shell finds a surface of that app kind **in the calling frame's own
cluster**, brings it forward if it is already there, opens one if it is not,
and delivers the payload to it as an event:

```jsonc
{"helve":1,"kind":"event","event":"helve:opened","payload":{"path":"a.txt","preview":true}}
```

The result names the surface that was chosen — `{"instanceId":"viewer-2"}` —
for a caller that wants to know whether it opened something new. Most ignore it.

Three properties are load-bearing:

- **A kind, never an instance.** A frame cannot address a particular surface,
  because which surface should answer is a fact about the layout that only the
  shell can see, and a frame that could name one could name one in a cluster it
  is not in.
- **Its own cluster only.** The calling frame is resolved from `event.source`
  against the shell's map of mounted iframes, exactly as every other message
  here is, and the search for a target never leaves the cluster that frame is
  placed in.
- **One event name for every intent.** What is being asked for lives in the
  payload and is read by the app that receives it — File Explorer sends a path
  and a peek flag, the source control view will send something else to the same
  app. A shell that routed on intent would need a table of every app's verbs,
  which is the thing this transport is shaped to avoid.

The payload is **not validated by the shell**, and that is deliberate: it is the
app's vocabulary, not the protocol's. The receiving app is the first and only
place its shape is checked.

#### `helve/publish` — state a fact for your cluster-mates

```jsonc
{"helve":1,"kind":"request","id":8,"method":"helve/publish",
 "params":{"topic":"files/active-path","value":{"path":"a.txt"}}}
```

Delivered to every **other** app frame in the cluster under the topic's name,
prefixed:

```jsonc
{"helve":1,"kind":"event","event":"helve:topic/files/active-path",
 "payload":{"value":{"path":"a.txt"},"from":"viewer-1"}}
```

The publisher is excluded from its own broadcast. A subscriber that republished
anything derived from what it heard would otherwise ping-pong with itself, and
no amount of care in one app prevents that from the other end.

**Topics are retained.** The last value published under a topic is replayed to
any frame that completes its handshake later, so a surface opened a minute after
the fact is not left blind until the next change. A publisher's topics are
dropped when its frame goes — a retained value from a surface that has closed
would be replayed to the next one as though it were current.

The `helve:topic/` prefix is what keeps an app's topics from colliding with the
shell's own push events (`project:changed`). A frame cannot publish under a name
that would arrive looking like news the shell authored.

`value` is unvalidated, `undefined` included — publishing "there is nothing" is
a real thing to say, and narrowing it to a refusal would leave the last real
value retained and make an empty editor indistinguishable from one nobody had
heard from.

#### Under the Tauri host

Both are **refused** with `-32601`, not accepted and dropped the way
`helve/commands` is. A tool's own standalone app is one window with one frontend
in it: there is no cluster, no second app, and nobody to deliver to. Answering
"done" to an open while nothing happened would leave a frontend believing it had
put a file on screen that nothing anywhere is showing.

`publish` is fire-and-forget in the bridge, so that rejection is swallowed at
the call site rather than surfacing as an unhandled promise.

### Origins

- The bridge posts `hello` with `targetOrigin: "*"` — it doesn't know the shell's
  origin yet, and the message carries no data worth protecting. It then reads the
  shell's origin off the `ready` message's `event.origin` and uses **that exact
  origin** as `targetOrigin` for every subsequent post.
- The bridge drops any message whose `event.source !== window.parent`.
- The shell drops any message whose `event.source` is not a mounted tool iframe's
  `contentWindow`, and resolves the tool id from that source rather than from
  anything in the message body. A tool cannot claim to be a different tool.

### Session

Handed to the frontend on `ready`, and to the core in `helve/hello`. Same shape
both places:

```ts
interface Session {
  /** Named pipe (Windows) or Unix socket path for the engine runtime. */
  engineEndpoint: string | null;
  /** Root of the open project. Null until projects exist. */
  projectPath: string | null;
}
```

This is how a tool finds the engine — the orchestrator generates one endpoint
name per session and publishes it here. Both fields are null today.

## 4. The bridge package

`@helve/bridge` is what a tool's `ui/` imports instead of `@tauri-apps/api`. Same
tool code, either host.

```ts
import {
  invoke, on, onCommand, declareCommands, session, host, reportPainted,
  openIn, publish, subscribe, OPENED_EVENT,
} from "@helve/bridge";

const reply = await invoke<{ text: string }>("echo", { text: "hi" });
const off   = on("file/changed", (p) => console.log(p));
const s     = await session();   // resolves after handshake
host();                          // "helve" | "tauri"
reportPainted();                 // "there is something on screen now"

// The menu bar. `declareCommands` is what makes the items clickable; call it
// again whenever the answer changes, and pass the whole set each time.
declareCommands(dirty ? ["file/save", "edit/undo"] : ["edit/undo"]);
const stop = onCommand((command) => run(command));

// Reaching another app in this cluster. `openIn` names a kind, never a surface.
await openIn("viewer", { path: "a.txt", preview: true });
on(OPENED_EVENT, (payload) => show(payload));   // the receiving end

// Facts your cluster-mates may care about. Retained, so a frame that mounts
// later is told the current value rather than waiting for the next change.
publish("files/active-path", { path: "a.txt" });
const off = subscribe("files/active-path", (value, from) => highlight(value, from));
```

`publish` de-duplicates against the last value sent for the same topic, because
the natural place to call it is an effect that runs on every render — the same
reasoning `declareCommands` is built on.

`reportPainted` sends `helve/painted` once, from a `requestAnimationFrame` so
the browser has laid the content out first — with a short timer racing it,
because a webview in a window that is still hidden stops firing animation
frames entirely, and that is exactly the case this signal exists for. Every
call after the first is a no-op, so it is safe from an effect that runs twice.

### Host detection

```
window.parent !== window   →  "helve"
otherwise                  →  "tauri"
```

A tool's standalone Tauri app is a top level window; inside the orchestrator the
tool is always framed. This is a structural fact checked once at load, not a
timing guess — there is no probe, no timeout, and no ambiguous middle state.

### Under the Tauri host

- `invoke(method, params)` forwards to `@tauri-apps/api/core`'s `invoke`, with
  the method name passed through unchanged.
- `helve/*` methods are handled **inside the bridge** and never reach Tauri —
  they aren't valid Tauri command names anyway (`/` is not allowed). `helve/hello`
  resolves locally; `helve/shutdown`, `helve/painted` and `helve/commands` all
  resolve to null. A tool's own app draws its own chrome, so there is no menu bar
  for a declaration to grey out — it is accepted and dropped rather than refused,
  so a frontend that supports menu commands does not log an error on a host where
  the feature does not apply. `onCommand` registers a handler nothing will ever
  call there, and its unsubscribe is real either way.
- `session()` resolves immediately to `{engineEndpoint: null, projectPath: null}`.
- `@tauri-apps/api` is imported dynamically, so a tool built for the orchestrator
  alone doesn't have to ship it.

### Timeouts

Every `invoke` rejects after 30 seconds by default. A pending request whose tool
process dies rejects with `-32000`. Both surface as a `HelveRpcError` carrying
`code`, `message`, and optional `data`.

## 5. What a tool repository ships

1. `helve-tool.toml` at the checkout root.
2. A headless binary that speaks transport A when passed `--helve-rpc`.
3. A frontend bundle whose only host coupling is `@helve/bridge`.

`examples/echo-tool` in this repo is the reference implementation of all three,
and is what the protocol's tests run against.
