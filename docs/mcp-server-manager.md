# MCP server manager

Roadmap item #4. HELVE hosts MCP servers; it never consumes them.

The clients are harnesses the user brings themselves — Claude Code, Codex, or
whatever else — running in terminals **HELVE spawned**. That is the constraint
the whole design rests on, and it is worth saying plainly before anything else:
we own the environment the client starts in. Discovery, authentication and port
assignment are all solvable by writing an environment variable, where for a
general-purpose MCP server each of them would be a support problem.

HELVE is BYOH. We are not building a harness, so nothing here may assume one.

---

## 1. The rule about what gets a server

**If the harness can already do it, it does not get an MCP server.**

No file reading, no writing, no directory listing, no search, no git. Every
coding agent worth pointing at HELVE arrives with those built in, usually better
tuned than ours would be, and wrapping them would buy an agent a second worse way
to do something it can already do — while costing us a permission surface, a
maintenance burden, and a pile of tool descriptions competing for the model's
attention against its own.

What earns a server is the opposite: **something that exists only inside HELVE.**
Forger's design model is the first real case. An agent cannot read a Forger spec
by opening a file, because the interesting part is not the file — it is the
model, its boundaries, and the question "does this change violate one?". That has
no filesystem equivalent, so it is worth a tool.

Apply this rule before writing any server. It is the one that keeps this feature
from turning into a reimplementation of the harness.

## 2. What we are building, and what we are not

There is no MCP server manager library in Rust. There is one protocol SDK —
[`rmcp`](https://crates.io/crates/rmcp), the official one — and everything above
it is ours: the registry of who owns what, enable and disable, health, the
settings UI. `rmcp` gives us the wire format, the transports, and a derive that
turns an argument struct into a JSON Schema. It has no opinion about a host
running several servers on behalf of several apps, because that is an application
concern and not a protocol one.

So "manager" here means **registry**, not **supervisor** — a data structure, not
a distributed systems problem. That falls out of section 3.

Right now HELVE needs no MCP server at all. Nothing in the current build does
anything a harness cannot already do, so by section 1 nothing qualifies. This
milestone therefore ships **infrastructure plus one echo server**, whose entire
job is to prove a client can discover the endpoint, authenticate, list a tool and
call it. Forger lands on top of it within days.

## 3. Every server lives in the orchestrator

This is the decision everything else follows from, and it is worth being exact
about, because the obvious reading of "each app can have an MCP server" is wrong.

An app's MCP server is not a process, and does not live in the app. It is a
module in `src-tauri/src/mcp/servers/`, registered here, hosted here. Forger's
server will be orchestrator code that talks to Forger — not code inside Forger's
own repository.

Two things follow, both of them good:

**The tool broker stops being a blocker.** A tool's Rust core is a child process
reached over transport A, and `apps/mod.rs` is explicit that the broker joining
that process to the shell is not built yet. Had Forger been expected to serve MCP
from its own process, this feature would have been stuck behind roadmap #10.
Hosting it here means it is not.

**No app or tool ever depends on `rmcp`.** The dependency is in one crate, the
handshake is implemented once, and a server author writes a tool descriptor and a
function rather than a protocol implementation.

## 4. One listener, one endpoint per server

A single HTTP listener on loopback, routing by path: `/mcp/forger`, `/mcp/echo`.
Each registered server is its own MCP endpoint and its own entry in `.mcp.json`.

Aggregating everything behind one endpoint was considered and rejected. It made
sense only under the assumption that each server was a separate process, where
fanning out cost real machinery; with every server in-process, a second endpoint
costs a route. What separate endpoints buy is worth more than that route:

- **Namespacing we do not have to invent.** The client derives tool names from
  the server name it connected to — `mcp__helve-forger__validate` — instead of us
  hand-prefixing every tool inside one flat namespace and hoping nobody collides.
- **A 1:1 map to the settings UI.** "Registered server" is exactly the row the
  user toggles, which is what the roadmap asked for.
- **Scoping.** An agent working in Forger gets Forger's tools. It has no reason
  to see Turner's, and every tool it can see but must not use is noise in its
  context.

Enable and disable stay on our side — HELVE decides which routes are mounted and
which entries are written — rather than living in the harness's own `/mcp` panel.

## 5. Registration

A registry in `src-tauri/src/mcp/`, seeded at boot, deliberately shaped like
`apps::REGISTRY`: an id, a display name, a description, and the handler that
answers a `tools/call`.

It is a `Vec` built at startup rather than a `const` slice, because a server can
be toggled off in settings and because a future registrant may not be known at
compile time. Nothing downstream may assume the set is fixed after boot — which
is also what makes the `list_changed` notification in section 7 honest rather
than decorative.

Server ids follow the same `^[a-z][a-z0-9-]*$` rule as app ids and tool ids, for
the same reason: an id ends up in a URL path and in a config key.

## 6. Transport and discovery

**Listener.** `rmcp`'s streamable-HTTP server transport, bound to `127.0.0.1` on
a preferred port with upward fallback. Loopback only, never `0.0.0.0`: this is a
local IPC channel that happens to speak HTTP, and binding it to a routable
interface would put every registered tool on the network.

**Discovery.** HELVE writes the project's `.mcp.json`, and because HELVE owns the
pty, both the port and the token can be environment variables:

```json
{
  "mcpServers": {
    "helve-echo": {
      "type": "http",
      "url": "http://127.0.0.1:${HELVE_MCP_PORT}/mcp/echo",
      "headers": { "Authorization": "Bearer ${HELVE_MCP_TOKEN}" }
    }
  }
}
```

Three properties fall out of that, and all three are why it is written this way
rather than with the values inlined:

- **The file is safe to commit.** No secret, no machine-specific port — the same
  file for every developer on the project.
- **The token rotates per launch** without rewriting anything on disk.
- **A terminal HELVE did not spawn cannot connect.** It inherits neither
  variable, so the URL does not resolve and the bearer is empty. That is the
  correct failure rather than an inconvenience: these tools reach into the live
  application, and a shell opened outside it should not be able to.

HELVE merges rather than clobbers — a project may already have its own servers,
and only the `helve-*` keys are ours to write or remove.

`helve-*` names avoid Claude Code's reserved set (`workspace`,
`claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser`).

**Verify before relying on it:** that `${VAR}` expansion applies to `url` and
`headers` on an `http` entry, not only to `command`/`args` on a stdio one. If it
does not, the fallback is `headersHelper` for the token and a rewritten `url` per
launch, which costs the committable-file property and nothing else.

## 7. Approval, and telling the user

A project-scoped `.mcp.json` is approved once, interactively, on first use. That
is a security feature and we should not try to defeat it silently.

What HELVE does instead:

- **Status bar indicator** with three states — connected, pending approval, off.
  Pending is the one that matters: it is a real state with a real fix, and a user
  who does not know the server is waiting on them will conclude it is broken.
- **An opt-in in settings** to write `enabledMcpjsonServers` into
  `.claude/settings.local.json`, pre-approving HELVE's servers for that project.
  Opt-in and per-project, phrased as trusting HELVE's own server rather than as
  turning off a prompt.

When the registered set changes while a client is connected, the server emits
MCP's `list_changed` notification; Claude Code honours it without a reconnect.

## 8. Dependency cost

New to the tree: `rmcp` (features `server`, `transport-streamable-http-server`,
`macros`, `schemars`), which brings an HTTP stack — `axum`/`tower`/`hyper` — and
an explicit `tokio`. Tauri already pulls tokio and hyper transitively, so the
marginal compile cost is the axum layer rather than a new async runtime.

Worth stating because it is the largest dependency addition this repo has made,
and it is load-bearing for exactly one feature.

There is deliberately **no new crate under `crates/`**. That directory holds the
protocol surface shared with tool repositories, and nothing outside the
orchestrator implements MCP. A crate for this would be a published contract with
no second party.

## 9. Order of work

1. `src-tauri/src/mcp/` — the registry, server descriptors, id validation.
   No I/O, no async, fully unit-testable.
2. The `rmcp` server: listener, loopback bind, token, path routing.
3. The echo server, as the thing that proves 1 and 2 end to end.
4. Env injection in `pty.rs`, and the `.mcp.json` merge on project open.
5. Status bar state and the settings surface.
6. Forger's server, once Forger exists.
