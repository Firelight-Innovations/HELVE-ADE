import type { Body } from "./blocks";

/**
 * The MCP server manager, from the user's side.
 *
 * Deliberately blunt about the two things that will otherwise waste somebody's
 * afternoon: only the Echo server exists today, and a terminal HELVE did not
 * spawn cannot connect at all — which looks exactly like a broken config.
 */
export const mcpServers: Body = {
  takeaway:
    "You can turn a HELVE MCP server on, get it into a project's `.mcp.json`, and connect an agent to it from a HELVE terminal.",
  blocks: [
    {
      kind: "text",
      body: "MCP — the Model Context Protocol — is how a coding agent picks up tools it did not ship with. HELVE hosts its own servers, so an agent working in your project can call into the parts of HELVE you would otherwise have to drive by hand.",
    },
    {
      kind: "text",
      body: "The servers run **inside** HELVE, not inside the apps or the stack tools. That is worth knowing because it is the reason this works at all today: a tool's core is a separate process and the broker that would reach it is not written, so a server hosted in Forger's own repository would be stuck behind that. Hosted here, it is not.",
    },

    { kind: "heading", body: "Turn one on" },
    {
      kind: "step",
      body: "Open the status bar's sliders glyph and pick **MCP servers**, which lands you on that section of Settings.",
    },
    {
      kind: "step",
      body: "Toggle the server you want. Each registered server is its own endpoint and its own entry in a project's config, so this is a per-server decision rather than one switch for the lot.",
    },
    {
      kind: "step",
      body: "Leave **Write .mcp.json into open projects** on. That is the switch that gets the server into a file your agent will actually read.",
    },
    {
      kind: "soon",
      body: "There is one server today: **Echo**, with a `ping` and an `echo` tool. It exists to prove the transport end to end. Forger's is the first real one and is not written yet — so what you are turning on right now is a working pipe with a toy on the end of it.",
    },

    { kind: "heading", body: "What lands in your project" },
    {
      kind: "text",
      body: "A `.mcp.json` at the project root, holding one entry per enabled server. HELVE **merges** rather than overwrites — if the project already has servers of its own, they are left exactly as they were, and only the `helve-` prefixed keys are HELVE's to write or remove.",
    },
    {
      kind: "code",
      body: `{
  "mcpServers": {
    "helve-echo": {
      "type": "http",
      "url": "http://127.0.0.1:\${HELVE_MCP_PORT}/mcp/echo",
      "headers": { "Authorization": "Bearer \${HELVE_MCP_TOKEN}" }
    }
  }
}`,
    },
    {
      kind: "text",
      body: "Note what is **not** in there: no port number and no token. Both are environment variables, which buys three things — the file is safe to commit, the token can rotate on every launch without rewriting anything on disk, and the entry is identical for everybody on the project.",
    },

    { kind: "heading", body: "The part that catches people" },
    {
      kind: "text",
      body: "Those two variables are set by **HELVE**, on the shells HELVE spawns. A terminal you opened outside HELVE inherits neither, so the URL does not resolve and the bearer token is empty.",
    },
    {
      kind: "note",
      body: 'That is the correct failure rather than an inconvenience. These tools reach into the running application; a shell opened outside it should not be able to. But it does mean the fix for "my agent cannot see the HELVE tools" is almost always **run the agent from a terminal inside HELVE** — see the Terminals tutorial.',
    },

    { kind: "heading", body: "Connecting an agent" },
    {
      kind: "step",
      body: "Open a terminal in the cluster your project is open in.",
    },
    {
      kind: "step",
      body: "Start your agent there — Claude Code, or any other MCP client that reads a project-scoped `.mcp.json`.",
    },
    {
      kind: "step",
      body: "Approve the server when the client asks. A project-scoped `.mcp.json` is approved once, interactively, on first use. That is a security feature of the client and HELVE does not try to defeat it silently.",
    },
    {
      kind: "text",
      body: "Tool names arrive namespaced by the server they came from — `mcp__helve-echo__ping` — because each server is its own endpoint rather than everything being flattened behind one. That also means an agent working on one part of the stack can be given only that part's tools, instead of every tool HELVE has.",
    },

    { kind: "heading", body: "Security, in one paragraph" },
    {
      kind: "text",
      body: "The listener binds to `127.0.0.1` and never to `0.0.0.0`. It is a local channel that happens to speak HTTP, and putting it on a routable interface would put every registered tool on the network. Every request carries a bearer token minted for this launch.",
    },
    {
      kind: "soon",
      body: "Three pieces are designed but not built: the status bar indicator that would tell you a server is connected, off, or waiting on your approval; the opt-in that pre-approves HELVE's own servers for a project; and the notification that tells a connected client the server list changed. Until the first of those lands, a server waiting on approval and a server that is off look the same from HELVE's side.",
    },
  ],
};
