/**
 * Wire types for transport B — tool frontend <-> shell window messages.
 * Mirrors `docs/tool-protocol.md` §3 exactly; if this drifts from that file,
 * the doc wins.
 *
 * Every message carries `helve: 1`. It's a version marker, but its real job
 * is cheaper: an iframe's `window` can receive `message` events from
 * anything, not just its host (browser extensions, embedded widgets, the
 * page's own code posting to itself) — `helve === 1` is what lets the bridge
 * ignore all of that in one check instead of trying to prove a message is
 * safe to parse.
 */

/** Mirrors the `Session` shape shared with the tool core's `helve/hello`. */
export interface Session {
  /** Named pipe (Windows) or Unix socket path for the engine runtime. */
  engineEndpoint: string | null;
  /** Root of the open project. Null until projects exist. */
  projectPath: string | null;
}

export interface HelveErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

// ---- Frontend -> shell ----

export interface HelloMessage {
  helve: 1;
  kind: "hello";
}

export interface RequestMessage {
  helve: 1;
  kind: "request";
  id: number;
  method: string;
  params?: unknown;
}

export type OutgoingMessage = HelloMessage | RequestMessage;

// ---- Shell -> frontend ----

export interface ReadyMessage {
  helve: 1;
  kind: "ready";
  toolId: string;
  protocol: 1;
  session: Session;
}

export interface ResponseMessage {
  helve: 1;
  kind: "response";
  id: number;
  result?: unknown;
  error?: HelveErrorPayload;
}

export interface EventMessage {
  helve: 1;
  kind: "event";
  event: string;
  payload: unknown;
}

/**
 * A menu command, aimed at whichever frame the shell considers active.
 *
 * Distinct from `event` rather than an event with a reserved name, because the
 * two make opposite claims. An event is news — the shell relaying something
 * that happened, which a frame may ignore. A command is an *instruction* the
 * user just gave through the shell's own chrome, and the shell only sends one
 * the frame has said it can carry out (see `helve/commands`). Keeping them
 * apart is what lets a frontend register a handler for one without having to
 * filter the other out of the same stream.
 *
 * Fire-and-forget: there is no id and no reply. What the menu needed to know —
 * whether this command is possible at all — was answered before the item was
 * ever clickable, and a result arriving afterwards would have nowhere to go,
 * since the menu has closed by then.
 */
export interface CommandMessage {
  helve: 1;
  kind: "command";
  command: string;
}

export type IncomingMessage = ReadyMessage | ResponseMessage | EventMessage | CommandMessage;

/**
 * The one check every inbound `message` event must pass before anything
 * else looks at it. Deliberately loose beyond that — `kind`-specific shape
 * is trusted once this and the `kind` narrow it, since the shell is the only
 * thing this bridge accepts messages from at all (see the `event.source`
 * check in `client.ts`).
 */
export function isHelveMessage(data: unknown): data is IncomingMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { helve?: unknown }).helve === 1 &&
    typeof (data as { kind?: unknown }).kind === "string"
  );
}

export function isReadyMessage(msg: IncomingMessage): msg is ReadyMessage {
  return msg.kind === "ready";
}

export function isResponseMessage(msg: IncomingMessage): msg is ResponseMessage {
  return msg.kind === "response";
}

export function isEventMessage(msg: IncomingMessage): msg is EventMessage {
  return msg.kind === "event";
}

export function isCommandMessage(msg: IncomingMessage): msg is CommandMessage {
  return msg.kind === "command" && typeof (msg as CommandMessage).command === "string";
}
