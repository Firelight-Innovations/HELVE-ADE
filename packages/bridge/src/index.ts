/**
 * `@helve/bridge` — what a tool's `ui/` imports instead of `@tauri-apps/api`.
 * Same tool code, either host: an iframe under the orchestrator shell, or a
 * top-level window in the tool's own standalone Tauri app.
 *
 * This file just wires `createClient` (the testable core, see `client.ts`)
 * to the real `window`. A singleton, not a factory: a tool's frontend has
 * exactly one host for its whole lifetime, decided once at load.
 */
import { createClient, type WindowLike } from "./client.js";

export type { Client, ClientOptions, Host, TauriCore, WindowLike } from "./client.js";
export type {
  EventMessage,
  HelloMessage,
  HelveErrorPayload,
  IncomingMessage,
  OutgoingMessage,
  ReadyMessage,
  RequestMessage,
  Session,
} from "./protocol.js";
export { HelveErrorCode, HelveRpcError } from "./errors.js";

// `Window`'s real `addEventListener` is broader than `WindowLike` needs
// (any event type, an `EventListenerObject` alternative, capture options) —
// the cast just picks the narrower shape this bridge actually uses.
const client = createClient({
  self: window as unknown as WindowLike,
  parent: window.parent as unknown as WindowLike,
});

export const invoke: <T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<T> = client.invoke;

export const on: (event: string, cb: (payload: unknown) => void) => () => void = client.on;

export const session: typeof client.session = client.session;

export const host: typeof client.host = client.host;
