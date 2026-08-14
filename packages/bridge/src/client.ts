/**
 * The testable core of the bridge. `createClient` takes its window handles
 * as parameters instead of reaching for `window`/`window.parent` globally —
 * under jsdom `window.parent === window`, so a client hard-wired to globals
 * could only ever be exercised on the Tauri path. Passing `self`/`parent` in
 * lets tests fake the iframe relationship and drive the Helve path too.
 * `src/index.ts` is the thin layer that supplies the real globals.
 */
import {
  isEventMessage,
  isHelveMessage,
  isReadyMessage,
  isResponseMessage,
  type HelveErrorPayload,
  type IncomingMessage,
  type Session,
} from "./protocol.js";
import { HelveErrorCode, HelveRpcError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export type Host = "helve" | "tauri";

/** A window-shaped message event — kept minimal (not the DOM `MessageEvent`
 * type) so tests can hand the listener plain objects instead of constructing
 * real ones. */
export interface IncomingWindowMessage {
  source: unknown;
  origin: string;
  data: unknown;
}

/** The slice of `Window` the bridge needs, on both sides of the postMessage
 * call. `self` also needs to listen; `parent` only ever gets posted to. */
export interface WindowLike {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: "message", listener: (event: IncomingWindowMessage) => void): void;
}

/** The two Tauri APIs the bridge needs, reshaped to hide the difference
 * between a raw `invoke` and a `listen` that hands back a full `Event<T>`. */
export interface TauriCore {
  invoke(cmd: string, args?: unknown): Promise<unknown>;
  listen(event: string, cb: (payload: unknown) => void): Promise<() => void>;
}

export interface ClientOptions {
  self: WindowLike;
  parent: WindowLike;
  /**
   * Dynamic import of the Tauri APIs, injected so `@tauri-apps/api` stays an
   * optional peer dependency — a tool that only ever runs inside Helve
   * shouldn't have to install it — and so tests can supply a fake without
   * the real module needing to resolve at all.
   */
  importTauri?: () => Promise<TauriCore>;
  /** Default per-`invoke` timeout in ms. Overridable per call too. */
  timeoutMs?: number;
}

export interface Client {
  invoke<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  session(): Promise<Session>;
  host(): Host;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

async function defaultImportTauri(): Promise<TauriCore> {
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return {
    invoke,
    listen: (event, cb) => listen(event, (e) => cb(e.payload)),
  };
}

export function createClient(opts: ClientOptions): Client {
  const { self, parent, timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const importTauri = opts.importTauri ?? defaultImportTauri;

  // Structural, not timed: a tool's own standalone Tauri app is always a
  // top-level window, so `self === parent` (mirroring `window.parent ===
  // window`) is a one-time fact about how the page was loaded, checked once
  // here — no probe, no timeout, no ambiguous middle state.
  const host: Host = self === parent ? "tauri" : "helve";

  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  // Set from the `ready` message's `event.origin` (see the listener below),
  // and used as the exact `targetOrigin` for every post after that. Null
  // until then, which is also the queue-vs-flush signal.
  let shellOrigin: string | null = null;
  let queued: Array<() => void> = [];
  let resolveSession!: (s: Session) => void;
  const sessionPromise = new Promise<Session>((resolve) => {
    resolveSession = resolve;
  });

  function settleResponse(id: number, result: unknown, error: HelveErrorPayload | undefined) {
    const req = pending.get(id);
    if (!req) return; // already timed out, or an id this client never sent
    pending.delete(id);
    clearTimeout(req.timer);
    if (error) req.reject(new HelveRpcError(error.code, error.message, error.data));
    else req.resolve(result);
  }

  if (host === "helve") {
    self.addEventListener("message", (event) => {
      // Anything not from the parent frame, or not wearing the version
      // marker, isn't the shell — could be an unrelated message sharing the
      // window, or (before `ready` arrives) simply not it yet.
      if (event.source !== parent) return;
      if (!isHelveMessage(event.data)) return;
      const msg: IncomingMessage = event.data;

      if (isReadyMessage(msg)) {
        if (shellOrigin !== null) return; // handshake only ever happens once
        shellOrigin = event.origin;
        resolveSession(msg.session);
        const flush = queued;
        queued = [];
        flush.forEach((fire) => fire());
        return;
      }
      if (isResponseMessage(msg)) {
        settleResponse(msg.id, msg.result, msg.error);
        return;
      }
      if (isEventMessage(msg)) {
        listeners.get(msg.event)?.forEach((cb) => cb(msg.payload));
      }
    });

    // Sent with targetOrigin "*": the shell's origin isn't known until it
    // replies, and this message carries nothing worth protecting. The
    // client speaks first on purpose — waiting for the shell to announce
    // itself would race this frame's own script load and listener
    // registration, and a postMessage that arrives before a listener exists
    // is simply gone, no replay. (Same failure mode this project already
    // hit with Tauri events during splash boot — see Splash.tsx.)
    parent.postMessage({ helve: 1, kind: "hello" }, "*");
  } else {
    // No shell exists under the Tauri host, so there's no handshake to wait
    // on — the session is knowable immediately, and is always empty.
    resolveSession({ engineEndpoint: null, projectPath: null });
  }

  function sendRequest(id: number, method: string, params: unknown) {
    // Every caller is either past the handshake or being flushed by it, so
    // this is always set. Throwing rather than falling back to "*" keeps that
    // an invariant: a future edit that reached here early would otherwise
    // broadcast a request — params and all — to any listening origin, and do
    // it silently.
    if (shellOrigin === null) throw new Error("bridge: sendRequest before handshake");
    parent.postMessage({ helve: 1, kind: "request", id, method, params }, shellOrigin);
  }

  function invokeHelve<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new HelveRpcError(HelveErrorCode.Timeout, `invoke timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      // The `pending.has` guard matters for the queued path specifically. The
      // timeout above starts when `invoke` is called, not when the request is
      // actually posted, so a call made before the handshake can time out
      // while still sitting in the queue — and then get flushed to the shell
      // anyway once `ready` arrives. The caller has already seen a rejection
      // at that point, so for any method that mutates something, the shell
      // would be executing work its caller believes failed. Dropping the
      // fire-and-forget leftover is the whole fix.
      const fire = () => {
        if (pending.has(id)) sendRequest(id, method, params);
      };
      // Queued before handshake and flushed on `ready`, so tool code never
      // has to await anything before its first call.
      if (shellOrigin !== null) fire();
      else queued.push(fire);
    });
  }

  async function invokeTauri<T>(method: string, params: unknown): Promise<T> {
    // `/` isn't legal in a Tauri command name, so `helve/*` would be a
    // guaranteed runtime error if forwarded. Handle the reserved methods
    // locally instead of ever reaching `@tauri-apps/api`. There's no real
    // handshake to answer under this host, so `hello` only has the one
    // field the bridge can honestly claim to know; `shutdown` has nothing
    // to ack and resolves to null, per the reserved-methods table in
    // docs/tool-protocol.md §2.
    if (method === "helve/hello") return { protocol: 1 } as unknown as T;
    if (method === "helve/shutdown") return null as unknown as T;
    // Nothing is waiting on this one here. Under the orchestrator it tells the
    // shell a frame has drawn its first meaningful content, which is what the
    // splash window holds for; a tool's own Tauri app has no splash and no
    // second window to reveal, so it acknowledges and does nothing, like
    // `helve/shutdown` above.
    if (method === "helve/painted") return null as unknown as T;
    if (method.startsWith("helve/")) {
      throw new HelveRpcError(HelveErrorCode.MethodNotFound, `no such method: ${method}`);
    }
    const tauri = await importTauri();
    return tauri.invoke(method, params) as Promise<T>;
  }

  return {
    invoke<T>(method: string, params?: unknown, timeoutMs = defaultTimeoutMs): Promise<T> {
      return host === "helve"
        ? invokeHelve<T>(method, params, timeoutMs)
        : invokeTauri<T>(method, params);
    },

    on(event: string, cb: (payload: unknown) => void): () => void {
      if (host === "helve") {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(cb);
        return () => set!.delete(cb);
      }

      // No shell to relay events under Tauri — a tool's own core pushes
      // notifications the same way the rest of this app's Rust side already
      // does (see bindings.ts / Splash.tsx), so `on` forwards to Tauri's
      // event system there instead. `listen` is itself async, but `on` must
      // return synchronously; `cancelled` covers the unsubscribe-before-
      // registration-resolves race the same way Splash.tsx's cleanup does.
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      importTauri()
        .then((tauri) => tauri.listen(event, cb))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch((err) => console.error(err));
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },

    session(): Promise<Session> {
      return sessionPromise;
    },

    host(): Host {
      return host;
    },
  };
}
