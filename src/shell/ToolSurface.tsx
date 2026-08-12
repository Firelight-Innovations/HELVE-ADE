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
 * When tools do arrive, this component is where the decision about *how* they
 * render gets made, and it is not one decision — it is at least two:
 *
 *   - The authoring tools are web apps. Those can be hosted in an iframe
 *     pointed at their built assets (served through a custom Tauri URI
 *     scheme) or, in development, straight at their own Vite dev server so
 *     their hot-reload works inside the real shell.
 *
 *   - The engine is not a web app. It is a native runtime that renders on the
 *     GPU, and there is no iframe that can host that. It needs a native child
 *     surface positioned over the webview, which is a genuinely different
 *     hosting mechanism with different rules about z-order, resizing, and
 *     input routing.
 *
 * So the eventual shape here is a switch on some per-tool "host kind" rather
 * than one embedding strategy applied uniformly. That field does not exist on
 * `ToolSpec` yet, and inventing it before the first real tool exists would be
 * guessing. The important thing today is that the seam sits here, and that
 * nothing upstream of it has assumed an answer.
 *
 * `tool` is unused for the moment and that is fine — it is the input the real
 * implementation will switch on, and keeping it in the signature means the
 * call site in `Shell.tsx` does not have to change when that happens.
 */
export default function ToolSurface({ tool }: { tool: ResolvedTool | null }) {
  void tool;

  return <div className="surface" />;
}
