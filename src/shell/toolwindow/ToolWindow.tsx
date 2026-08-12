import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolPresentation } from "../contract";
// The bridge package (`@helve/bridge`) is not a dependency of this app's
// package.json — only `examples/echo-tool/ui` has it wired up via the pnpm
// workspace. Importing the wire types by relative path instead of
// redeclaring them, per docs/tool-protocol.md §3/§4.
import type { HelloMessage, ReadyMessage } from "../../../packages/bridge/src/protocol";
import ToolMount from "./ToolMount";
import EmptyState from "./EmptyState";
import "./toolwindow.css";

/**
 * The tool window — the container every docked tool mounts into, plus its
 * boot and empty states.
 *
 * Owns the shell half of transport B (docs/tool-protocol.md §3): every tool
 * iframe's `hello` lands here, and this is the only place that answers
 * `ready`. Centralising the listener (rather than one per `ToolMount`) is
 * what makes the security property possible — there is exactly one place
 * that resolves a tool id from `event.source`, and exactly one map of
 * trusted sources to check it against.
 */
export default function ToolWindow({
  tools,
  activeToolId,
  onOpenTool,
  onRescan,
}: {
  tools: ToolPresentation[];
  activeToolId: string | null;
  onOpenTool: (id: string) => void;
  onRescan: () => void;
}) {
  // The only trusted map from a window to a tool id. Each `ToolMount`
  // registers its iframe's `contentWindow` here the moment it exists; the
  // listener below never trusts anything in a message's body for identity —
  // a tool cannot claim to be a different tool by lying in its payload.
  const frames = useRef<Map<Window, string>>(new Map());
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());

  const registerFrame = useCallback((toolId: string, win: Window) => {
    frames.current.set(win, toolId);
  }, []);

  const unregisterFrame = useCallback((win: Window) => {
    frames.current.delete(win);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Drop anything whose source isn't one of our mounted iframes — this
      // is also how the tool id is resolved, never from `event.data`.
      const toolId = frames.current.get(event.source as Window);
      if (!toolId) return;
      if (!isHelloMessage(event.data)) return;

      // The shell answers; it never announces first (docs/tool-protocol.md
      // §3 — a message posted before the frame's listener exists is simply
      // gone, with no replay). `targetOrigin` is the hello message's own
      // origin, not "*".
      const reply: ReadyMessage = {
        helve: 1,
        kind: "ready",
        toolId,
        protocol: 1,
        session: { engineEndpoint: null, projectPath: null },
      };
      (event.source as Window).postMessage(reply, event.origin);
      setReadyIds((prev) => (prev.has(toolId) ? prev : new Set(prev).add(toolId)));
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="toolwindow">
      {/* Every docked tool renders here, always — including inactive ones.
          `ToolMount` hides them with `visibility: hidden`, never `display:
          none` or a remount, so a tool's iframe never reloads just because
          the user looked away and back. */}
      {tools.map((tool) => (
        <ToolMount
          key={tool.id}
          tool={tool}
          active={tool.id === activeToolId}
          ready={readyIds.has(tool.id)}
          registerFrame={registerFrame}
          unregisterFrame={unregisterFrame}
        />
      ))}
      {activeToolId === null && <EmptyState tools={tools} onOpenTool={onOpenTool} onRescan={onRescan} />}
    </div>
  );
}

/**
 * `isHelveMessage` in the bridge package is typed for the frontend's inbound
 * direction (`ReadyMessage | ResponseMessage | EventMessage`) — we are the
 * shell, receiving the other direction (`HelloMessage | RequestMessage`), so
 * reusing it would narrow to the wrong union. The runtime check is the same
 * one line either way; this just types it correctly for what we actually
 * receive. `RequestMessage` has no handler yet — there is no tool core
 * process wired up in this parcel — so anything but `hello` is dropped.
 */
function isHelloMessage(data: unknown): data is HelloMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { helve?: unknown }).helve === 1 &&
    (data as { kind?: unknown }).kind === "hello"
  );
}
