import type { ResolvedTool } from "../bindings";

/**
 * The region a tool renders into.
 *
 * Deliberately blank for now. Every tool in the stack is its own piece of
 * software in its own repository — a design tool, a code viewer, a technical
 * design tool, an art tool, and the engine itself — and none of them are
 * integrated yet. There is also no project to open them against, which is the
 * thing that would actually give them something to show; the project picker
 * comes later.
 *
 * ## What this is a seam for
 *
 * Every tool that mounts here is a web frontend, so there is exactly one
 * mechanism: an iframe served from the tool's checkout through a custom URI
 * scheme, or in development pointed straight at that tool's own Vite server so
 * its hot-reload works inside the real shell.
 *
 * The engine does not mount here at all. It is a C++ runtime with no frontend
 * — the orchestrator only starts and supervises it, and the tools talk to it
 * directly over a named pipe. An earlier draft of this comment had the engine
 * rendering into a native child surface composited over the webview; that was
 * wrong, and dropping it removes the one part of this design that would have
 * needed platform window handles and input-routing rules.
 *
 * See `company/docs/design/helve-tool-integration.md` for the full contract:
 * what a tool repo ships, the bridge package that lets one tool run under
 * either host, and the transport split between tools and the engine.
 *
 * `tool` is unused for the moment and that is fine — it is the input the real
 * implementation reads to resolve an iframe source, and keeping it in the
 * signature means the call site in `Shell.tsx` does not have to change.
 */
export default function ToolSurface({ tool }: { tool: ResolvedTool | null }) {
  void tool;

  return <div className="surface" />;
}
