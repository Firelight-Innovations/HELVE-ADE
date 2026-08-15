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
  CommandMessage,
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

/**
 * Run this when the shell's menu bar asks for a command.
 *
 * The other half is `declareCommands` — the shell only sends what the frontend
 * has said it can do right now, so a handler registered without a matching
 * declaration is simply never called. See `docs/tool-protocol.md` §3.
 */
export const onCommand: (cb: (command: string) => void) => () => void = client.onCommand;

/** Which menu commands this frontend can carry out **at this moment**. */
export const declareCommands: (commands: readonly string[]) => void = client.declareCommands;

export const session: typeof client.session = client.session;

export const host: typeof client.host = client.host;

/**
 * How long `reportPainted` will wait for an animation frame before reporting
 * anyway.
 *
 * The fallback is not belt-and-braces, it is the common case at startup. A
 * frontend under the orchestrator boots inside a window that is still *hidden*
 * behind the splash, and a hidden webview stops firing `requestAnimationFrame`
 * altogether — so waiting on rAF alone would mean the one situation this signal
 * exists for is the one situation it never fires in. Two hundred milliseconds
 * is far past a frame on a window that is drawing, and small against the
 * seconds the host is willing to wait.
 */
const PAINT_FALLBACK_MS = 200;

/** Set once `reportPainted` has sent; every call after the first is a no-op. */
let painted = false;

/**
 * Tell the host that this frontend has drawn its first meaningful content.
 *
 * The orchestrator holds its splash window up until every first-party app has
 * said this, so that the first frame a person sees after the splash is the app
 * itself rather than a loading state that resolves into one a beat later — see
 * `src-tauri/src/boot.rs`. A host with nothing to hold simply acknowledges it.
 *
 * Call it when the content is *committed*, not when the call that fetched it
 * resolves: the claim being made is that there is something worth looking at,
 * which is a fact about the DOM and not about a promise. Failure and empty
 * states count — a screen that says it could not read anything is still
 * finished, and holding a window back for one that is never going to improve
 * only makes the bad news slower.
 *
 * Safe to call from an effect that runs more than once (React's StrictMode runs
 * every effect twice in development): only the first call is sent, and the host
 * ignores a repeat anyway.
 */
export function reportPainted(): void {
  if (painted) return;
  painted = true;

  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    // Swallowed rather than reported: this is a courtesy to the host, and a
    // host that refuses it — a tool build with no such method, a shell that has
    // already stopped waiting — has told us something we have no use for. What
    // must not happen is an unhandled rejection in an app whose only crime was
    // finishing its first render.
    void client.invoke("helve/painted").catch(() => {});
  };

  const fallback = setTimeout(send, PAINT_FALLBACK_MS);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      send();
    });
  }
}
