import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolPresentation } from "../contract";
// The wire types come from the bridge package's source by relative path rather
// than from `@helve/bridge` itself. The root package does depend on that
// package now — the first-party apps under `apps/` import it, and they are
// built by this same Vite config — but the shell must not import its *client*,
// which is the tool half of transport B and reaches for `window.parent` at
// module load. Types and the error-code table have no such side effect.
import type {
  HelloMessage,
  ReadyMessage,
  RequestMessage,
  ResponseMessage,
} from "../../../packages/bridge/src/protocol";
import { HelveErrorCode } from "../../../packages/bridge/src/errors";
import { callApp } from "../state/apps";
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
 *
 * It is also where a frame's `request` messages are routed, and the two kinds
 * of surface part company at exactly that point. A first-party app's call goes
 * to `app_call`, which answers in the orchestrator's own process. A tool's
 * would have to reach its core over the broker, which is not built — so a tool
 * gets an error naming that, rather than the silence that used to be here.
 * Silence is the worse answer: the bridge times a pending call out after thirty
 * seconds, so a tool asking a question this build cannot answer would hang for
 * half a minute before finding out.
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
  // The only trusted map from a window to a mounted surface. Each `ToolMount`
  // registers its iframe's `contentWindow` here the moment it exists; the
  // listener below never trusts anything in a message's body for identity —
  // a tool cannot claim to be a different tool by lying in its payload.
  //
  // `isApp` is carried here rather than looked up in `tools` when a message
  // arrives, so routing is decided by the same registration that established
  // identity. A second lookup would be a second chance to disagree.
  const frames = useRef<Map<Window, { id: string; isApp: boolean }>>(new Map());
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());

  const registerFrame = useCallback((toolId: string, isApp: boolean, win: Window) => {
    frames.current.set(win, { id: toolId, isApp });
  }, []);

  const unregisterFrame = useCallback((win: Window) => {
    frames.current.delete(win);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Drop anything whose source isn't one of our mounted iframes — this
      // is also how the tool id is resolved, never from `event.data`.
      const source = event.source as Window | null;
      if (!source) return;
      const frame = frames.current.get(source);
      if (!frame) return;
      if (!isInboundMessage(event.data)) return;

      // `targetOrigin` is the incoming message's own origin, never "*" — for
      // every reply below, and for the same reason each time.
      const origin = event.origin;

      if (event.data.kind === "hello") {
        // The shell answers; it never announces first (docs/tool-protocol.md
        // §3 — a message posted before the frame's listener exists is simply
        // gone, with no replay).
        const reply: ReadyMessage = {
          helve: 1,
          kind: "ready",
          toolId: frame.id,
          protocol: 1,
          session: { engineEndpoint: null, projectPath: null },
        };
        source.postMessage(reply, origin);
        setReadyIds((prev) => (prev.has(frame.id) ? prev : new Set(prev).add(frame.id)));
        return;
      }

      const { id, method, params } = event.data;
      const respond = (body: Omit<ResponseMessage, "helve" | "kind">) =>
        source.postMessage({ helve: 1, kind: "response", ...body } satisfies ResponseMessage, origin);

      if (!frame.isApp) {
        respond({
          id,
          error: {
            code: HelveErrorCode.InternalError,
            message: `${method}: this build cannot reach a tool's core — the broker is not implemented`,
          },
        });
        return;
      }

      void callApp(frame.id, method, params)
        .then((result) => respond({ id, result }))
        // Both hosts of `callApp` reject with a `{code, message}` envelope, so
        // the common path is to pass it straight through. Anything else that
        // reaches here is a failure of the relay rather than of the app —
        // reported as an internal error with whatever it said for itself,
        // since a call that resolved to neither a result nor an error object
        // is exactly the case a caller cannot otherwise distinguish from a
        // hang.
        .catch((err: unknown) =>
          respond({
            id,
            error: isErrorPayload(err)
              ? err
              : { code: HelveErrorCode.InternalError, message: String(err) },
          }),
        );
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
 * shell, receiving the other direction, so reusing it would narrow to the
 * wrong union. The runtime check is the same two fields either way; this just
 * types it correctly for what we actually receive, and rejects any third
 * `kind` a frame might invent.
 */
function isInboundMessage(data: unknown): data is HelloMessage | RequestMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { helve?: unknown; kind?: unknown; id?: unknown; method?: unknown };
  if (message.helve !== 1) return false;
  if (message.kind === "hello") return true;
  // A request without a numeric id could never be answered — there would be
  // nothing to echo back — and one without a method names nothing to call.
  return (
    message.kind === "request" &&
    typeof message.id === "number" &&
    typeof message.method === "string"
  );
}

/** A rejection that already carries a JSON-RPC error object. */
function isErrorPayload(err: unknown): err is NonNullable<ResponseMessage["error"]> {
  if (typeof err !== "object" || err === null) return false;
  const payload = err as { code?: unknown; message?: unknown };
  return typeof payload.code === "number" && typeof payload.message === "string";
}
