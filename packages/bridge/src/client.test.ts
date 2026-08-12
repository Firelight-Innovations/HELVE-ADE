import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type IncomingWindowMessage, type TauriCore, type WindowLike } from "./client.js";
import { HelveErrorCode, HelveRpcError } from "./errors.js";

const SHELL_ORIGIN = "https://shell.example";

/** A fake `Window`: `postMessage` is a spy, and `addEventListener` just
 * stashes the listener so `dispatch` can drive it directly — there's no
 * real DOM here, so nothing delivers `message` events on its own. */
function fakeWindow(): { win: WindowLike; dispatch: (event: IncomingWindowMessage) => void } {
  const listeners = new Set<(event: IncomingWindowMessage) => void>();
  const win: WindowLike = {
    postMessage: vi.fn(),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
  };
  return { win, dispatch: (event) => listeners.forEach((l) => l(event)) };
}

function readyMessage(session = { engineEndpoint: null, projectPath: null }) {
  return { helve: 1 as const, kind: "ready" as const, toolId: "echo", protocol: 1 as const, session };
}

/** Completes the hello/ready handshake against a client already created
 * with the given `parent` handle. */
function handshake(
  parent: WindowLike,
  dispatch: (event: IncomingWindowMessage) => void,
  session?: { engineEndpoint: string | null; projectPath: string | null },
) {
  dispatch({ source: parent, origin: SHELL_ORIGIN, data: readyMessage(session) });
}

describe("host detection", () => {
  it("is 'helve' when self !== parent, mirroring window.parent !== window", () => {
    const { win: self } = fakeWindow();
    const { win: parent } = fakeWindow();
    expect(createClient({ self, parent }).host()).toBe("helve");
  });

  it("is 'tauri' when self === parent — a tool's own app is a top-level window", () => {
    const { win: self } = fakeWindow();
    expect(createClient({ self, parent: self }).host()).toBe("tauri");
  });
});

describe("handshake", () => {
  it("posts hello on init, targetOrigin '*', without waiting to be spoken to", () => {
    const { win: self } = fakeWindow();
    const { win: parent } = fakeWindow();
    createClient({ self, parent });
    expect(parent.postMessage).toHaveBeenCalledWith({ helve: 1, kind: "hello" }, "*");
  });

  it("resolves session() from the ready message's session field", async () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });
    const session = { engineEndpoint: "\\\\.\\pipe\\helve-1", projectPath: "C:\\proj" };

    handshake(parent, dispatch, session);

    await expect(client.session()).resolves.toEqual(session);
  });
});

describe("request/response", () => {
  it("round trips a request once past the handshake", async () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });
    handshake(parent, dispatch);

    const promise = client.invoke("echo", { text: "hi" });
    // Uses the shell's own origin (learned from `ready`), not "*", now that
    // it's known.
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { helve: 1, kind: "request", id: 1, method: "echo", params: { text: "hi" } },
      SHELL_ORIGIN,
    );

    dispatch({
      source: parent,
      origin: SHELL_ORIGIN,
      data: { helve: 1, kind: "response", id: 1, result: { text: "hi" } },
    });
    await expect(promise).resolves.toEqual({ text: "hi" });
  });

  it("queues an invoke made before handshake and flushes it on ready", async () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });

    const promise = client.invoke("echo", { text: "queued" });
    // Only `hello` should be on the wire so far — the request waits.
    expect(parent.postMessage).toHaveBeenCalledTimes(1);

    handshake(parent, dispatch);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { helve: 1, kind: "request", id: 1, method: "echo", params: { text: "queued" } },
      SHELL_ORIGIN,
    );

    dispatch({ source: parent, origin: SHELL_ORIGIN, data: { helve: 1, kind: "response", id: 1, result: "ok" } });
    await expect(promise).resolves.toBe("ok");
  });

  it("does not send a queued request that already timed out", async () => {
    // The timeout clock starts at `invoke`, not at send, so a call made
    // before the handshake can expire while still queued. If the flush fired
    // it anyway the shell would run work whose caller has already been told
    // it failed — silent, and worst for anything that mutates state.
    vi.useFakeTimers();
    try {
      const { win: self, dispatch } = fakeWindow();
      const { win: parent } = fakeWindow();
      const client = createClient({ self, parent, timeoutMs: 1_000 });

      const promise = client.invoke("echo", { text: "abandoned" });
      const assertion = expect(promise).rejects.toMatchObject({ code: HelveErrorCode.Timeout });
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;

      handshake(parent, dispatch);
      // Still just the `hello` from init: the flush dropped the leftover.
      expect(parent.postMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with a HelveRpcError carrying the shell's error envelope", async () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });
    handshake(parent, dispatch);

    const promise = client.invoke("nope");
    dispatch({
      source: parent,
      origin: SHELL_ORIGIN,
      data: {
        helve: 1,
        kind: "response",
        id: 1,
        error: { code: -32601, message: "no such method: nope" },
      },
    });

    await expect(promise).rejects.toBeInstanceOf(HelveRpcError);
    await expect(promise).rejects.toMatchObject({ code: -32601, message: "no such method: nope" });
  });

  it("times out a request that never gets a response", async () => {
    vi.useFakeTimers();
    try {
      const { win: self, dispatch } = fakeWindow();
      const { win: parent } = fakeWindow();
      const client = createClient({ self, parent, timeoutMs: 1_000 });
      handshake(parent, dispatch);

      const promise = client.invoke("echo");
      const assertion = expect(promise).rejects.toMatchObject({ code: HelveErrorCode.Timeout });
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("message filtering", () => {
  it("drops a ready message whose source is not the parent frame", async () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });

    dispatch({ source: {}, origin: SHELL_ORIGIN, data: readyMessage() });

    let settled = false;
    void client.session().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it("drops a message missing the helve:1 marker", async () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });

    dispatch({ source: parent, origin: SHELL_ORIGIN, data: { kind: "ready", toolId: "echo", protocol: 1, session: {} } });

    let settled = false;
    void client.session().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("events", () => {
  it("delivers events to on() and stops once unsubscribed", () => {
    const { win: self, dispatch } = fakeWindow();
    const { win: parent } = fakeWindow();
    const client = createClient({ self, parent });
    handshake(parent, dispatch);

    const received: unknown[] = [];
    const off = client.on("file/changed", (p) => received.push(p));

    dispatch({
      source: parent,
      origin: SHELL_ORIGIN,
      data: { helve: 1, kind: "event", event: "file/changed", payload: { path: "a.txt" } },
    });
    expect(received).toEqual([{ path: "a.txt" }]);

    off();
    dispatch({
      source: parent,
      origin: SHELL_ORIGIN,
      data: { helve: 1, kind: "event", event: "file/changed", payload: { path: "b.txt" } },
    });
    expect(received).toEqual([{ path: "a.txt" }]);
  });
});

describe("tauri host", () => {
  function fakeTauri() {
    const invoke = vi.fn().mockResolvedValue("tauri-result");
    const listen = vi.fn().mockResolvedValue(() => {});
    const tauri: TauriCore = { invoke, listen };
    return { invoke, listen, importTauri: () => Promise.resolve(tauri) };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards ordinary methods to tauri's invoke, name unchanged", async () => {
    const { win: self } = fakeWindow();
    const { invoke, importTauri } = fakeTauri();
    const client = createClient({ self, parent: self, importTauri });

    await expect(client.invoke("echo", { text: "hi" })).resolves.toBe("tauri-result");
    expect(invoke).toHaveBeenCalledWith("echo", { text: "hi" });
  });

  it("resolves helve/* locally and never reaches tauri invoke", async () => {
    const { win: self } = fakeWindow();
    const { invoke, importTauri } = fakeTauri();
    const client = createClient({ self, parent: self, importTauri });

    await expect(client.invoke("helve/hello")).resolves.toEqual({ protocol: 1 });
    await expect(client.invoke("helve/shutdown")).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("resolves session() immediately, with no handshake to wait for", async () => {
    const { win: self } = fakeWindow();
    const client = createClient({ self, parent: self });
    await expect(client.session()).resolves.toEqual({ engineEndpoint: null, projectPath: null });
  });
});
