# The Helve tool protocol — v1

The wire contract between the orchestrator and a tool. This is the reference
implementations are written against; if code and this document disagree, one of
them is a bug.

It is both halves. The exact bytes and the exact field names, and — beside each
rule whose shape is not obvious from the rule itself — why it is that way and
what was rejected instead. Section 6 says which of this you may build a tool
against today, which of it may still move, and what happens to your tool if it
does.

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
  /** Root of the open project. Null until projects exist. */
  projectPath: string | null;
}
```

This is what the host tells a tool about the world it opened into. The single
field is null today, and stays null until projects reach tools.

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
- `session()` resolves immediately to `{projectPath: null}`.
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

## 6. Stability

The protocol is at v1 and most of what is above is running code. But the broker
is not built, so the one path this whole document exists to describe — a tool's
frontend asking a question its own core answers — has never run end to end. That
is an unusual place to publish a specification from, and leaving it implied
would cost somebody a weekend, so this section is the map: what to build
against, what is still moving, and what happens to your tool when it moves.

### What is settled

Implemented, covered by tests, and not changing shape under v1.

- **`helve-tool.toml` (§1)** — every key, the path rules, and unknown keys being
  an error. `crates/helve-tool-manifest` is the only parser there is;
  `examples/echo-tool/helve-tool.toml` is the file its tests read.
- **Transport A (§2)** — the framing, the three message shapes, `helve/shutdown`,
  and the error codes. `crates/helve-rpc` is *both* halves of the pipe, which is
  what stops a host and a tool drifting apart, and
  `examples/echo-tool/tests/roundtrip.rs` drives a real child process through
  handshake, call, bad params, unknown method, notification, and death.
- **Transport B (§3)** — the `helve: 1` envelope, the five message kinds, the
  client-initiated handshake, the five reserved `helve/*` methods, and the
  origin rules. All of it runs on every launch: the orchestrator's own Home and
  Files are not special-cased anywhere, they are frames speaking this transport
  through this bridge.
- **`@helve/bridge` (§4)** — the exported names, the thirty-second default
  timeout, `HelveRpcError`'s `code`, `message` and `data`, and host detection.

Two caveats on that list, both about the same gap and both worth stating before
somebody discovers them. Transport B is exercised only by frames the shell
answers *itself*; no tool frontend has been mounted in this shell yet. And the
host half of the `helve/hello` check in §2 — reject the tool if `protocol != 1`
or if `id` disagrees with the manifest — is specified here and enforced nowhere:
`HANDSHAKE_FAILED` exists in `crates/helve-rpc` and nothing raises it, because
the code that would is the broker. A tool must still answer `helve/hello`
correctly. Nothing checks that it did.

### What may still move

- **The broker.** A tool frontend's non-`helve/*` `invoke` is refused today with
  `-32603` and a message naming the gap, rather than hanging for thirty seconds.
  When the broker lands no message shape above changes — specifying both
  transports around one `method` and one `params` is what buys that — but it
  will be the first end-to-end run of anything, and first runs find things.
- **`[permissions]`.** The table is accepted and its contents are never looked
  at: the manifest crate types it as an opaque `toml::Value` so that reserving
  the space costs nothing today. Anything written in it is a note to yourself.
  What it will actually mean is the second open question below.
- **`Session`.** Its one field is null in every build that exists. It carried a
  second, `engineEndpoint`, removed rather than carried forward: it named a
  component that is not part of this stack, it was null everywhere, and it had
  no specification past "a named pipe or socket path". Removing it while the
  protocol has no third-party implementors costs nothing — keeping it would have
  meant documenting a field nobody could fill.
- **Path safety.** §1 names the known gap: paths are not canonicalized, so a
  symlink inside a checkout still escapes it. Closing that can only make a
  manifest that parses today start failing, which is the direction a security
  fix is allowed to move in.
- **Command ids and app methods** are declared in §3 not to be part of this
  protocol, and that is the point rather than an omission. A host adds, renames
  and drops its own vocabulary without the protocol version moving.

### The versioning rule

Both transports carry an integer — `protocol` in `helve/hello`, `helve` on every
window message — and **that integer is the only breaking-change lever.** It goes
to 2 when something that already exists stops meaning what it meant: a field
removed, a type changed, a result reshaped, a handshake reversed.

Additive change leaves it at 1. A new reserved `helve/*` method, a new optional
key in `helve-tool.toml`, a new field on `Session`, a new code in the Helve error
range. A tool written against v1 keeps working across every one of those, and
that is the entire promise the number is making.

One asymmetry inside that, because it will otherwise be found the hard way. A
new optional manifest key is additive for *tool authors* — every existing
`helve-tool.toml` still parses — and is not additive for *hosts*, because
unknown keys are a hard error. A manifest using a key added in a later shell is
rejected by an earlier one, by name. That trade is deliberate and §1 already
argues it: a key silently ignored is the worse failure. The consequence is that
a tool adopting a new key has declared a minimum shell version, and should say
so somewhere its users will read.

`helve/hello` is specified to **reject a mismatch rather than negotiate down.**
A shell and a tool from two majors half-working is a worse day than either of
them stopping at the handshake.

The crates and `@helve/bridge` carry ordinary semver, independent of this
number. `@helve/bridge` 0.2.0 still speaks protocol 1. A package version is not
a protocol version.

And the rule this file lives under: a change to §1 through §4 lands in the same
commit as the code that makes it true, and the commit message says the format
moved. The line at the top is not decoration — if the code and this document
disagree, one of them is a bug, and which one is a question with an answer.

### Two security questions this document does not answer

Both are open, both are Braden's, and both are written out here rather than
deferred because they are free to answer on paper now and expensive to retrofit
through a resolver later. A tool author's threat model depends on the answers.

#### Open: does the shell clone a repository, or fetch a signed artifact?

Nothing above says how a tool's checkout arrived on disk, and today nothing puts
one there — `checkout-root` in `helve.toml` points at directories a person
cloned by hand. The question becomes real the moment the shell does the
fetching, which is the reason to answer it before it does.

Cloning a repository named by a URL in a TOML file and running its `core.bin` is
arbitrary code execution authorized by a line of configuration. It also needs
`git` on the user's machine, and a version pin that resolves to a tag is a
pointer somebody can move: the pin reads as reproducible and is not.

A signed release artifact with a checksum is a fixed set of bytes that can be
verified before anything executes, needs no `git`, and gives a pin that names
one build permanently. It costs a release pipeline in every tool repository.

**Recommendation: signed artifacts for anything the shell fetches itself, with
the hand-cloned local checkout kept as the development path.** Those two are
already separate in `helve-tool.toml` — `dist` is a built bundle, `dev-url` is a
live server — so the cost lands on distribution rather than on a tool author's
inner loop, which is the half that has to stay fast. **Not decided.**

#### Open: what is a mounted tool permitted to do?

The protocol bounds the frontend, and it is worth being exact about how far,
because it stops well short of where a reader will assume it reaches. A tool
frontend is an iframe on its own origin — `src-tauri/src/tool_frontend.rs` has
why that is `helve-tool://` and not `file://`, and the answer is that `file://`
would put every tool on one opaque origin and dissolve the checks below. The
shell resolves who is speaking from `event.source` rather than from anything in
the message body, so a tool cannot claim to be another tool. `helve/open`
reaches only app *kinds*, and only inside the calling frame's own cluster.

None of that touches the core. **A tool's core is a child process holding the
user's full privileges, and nothing in this protocol constrains it** — the
filesystem, the network, and everything else the user has. Tauri's capability
system governs a webview; a core is not one.

Prompting at install time is the obvious lever and a weak one alone. It is the
only moment a person has the context to answer, and a prompt nobody understands
is a prompt everybody accepts. `[permissions]` as it stands is a declaration by
the tool's own author, which makes it a statement of intent; it becomes a
constraint only where a host enforces it.

**Recommendation: give `[permissions]` a real schema before the broker ships
rather than after** — retrofitting it means breaking tools that already exist —
**deny by default on the tool window's Tauri capability set**, since a tool
frontend needs nothing from Tauri directly and talks to the shell for
everything, **and say plainly in this document that a core is unsandboxed under
v1** rather than letting the frontend's isolation imply a guarantee that does
not extend to it. **Not decided.**
