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
import { invoke, on, session, host, reportPainted } from "@helve/bridge";

const reply = await invoke<{ text: string }>("echo", { text: "hi" });
const off   = on("file/changed", (p) => console.log(p));
const s     = await session();   // resolves after handshake
host();                          // "helve" | "tauri"
reportPainted();                 // "there is something on screen now"
```

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
  resolves locally; `helve/shutdown` and `helve/painted` resolve to null.
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
