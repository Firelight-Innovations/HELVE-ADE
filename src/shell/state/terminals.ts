/**
 * The frontend half of the terminals.
 *
 * Mirrors `src-tauri/src/pty.rs`. Two exports, matching the two interfaces in
 * the contract and for the same reason:
 *
 *   * `terminalControl` opens and closes sessions. Low traffic, request/reply.
 *   * `terminalTransport` carries bytes. High traffic, one event per session,
 *     and nothing outside a terminal view should ever hold it.
 *
 * Note what is absent: any notion of *which sessions exist*. That lives in
 * `shell:state` (see `shellState.ts`), because a terminal can be dragged into
 * another window and so cannot be owned by the window showing it.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TerminalBusy, TerminalControl, TerminalTransport } from "../contract";
import { isFake } from "./fakeBackend";

export const terminalControl: TerminalControl = {
  create(windowLabel, cols, rows) {
    if (isFake()) return fakeControl.create(windowLabel, cols, rows);
    return invoke<string>("create_terminal", { label: windowLabel, cols, rows });
  },

  close(id) {
    if (isFake()) return fakeControl.close(id);
    void invoke("close_terminal", { id });
  },

  busy(id) {
    if (isFake()) return fakeControl.busy(id);
    // Rust answers `Option<Busy>`, which arrives as the value or `null`. No
    // mapping needed — `null` already means "idle, close it without asking".
    return invoke<TerminalBusy | null>("terminal_busy", { id });
  },
};

/** Mirrors `pty::Chunk` — one emission on `pty:data:<id>`. */
interface PtyChunk {
  seq: number;
  data: string;
}

/** Mirrors `pty::Attachment` — what `terminal_attach` answers with. */
interface PtyAttachment {
  text: string;
  nextSeq: number;
  exited: boolean;
}

export const terminalTransport: TerminalTransport = {
  attach(id, onData) {
    if (isFake()) return fakeTransport.attach(id, onData);

    // `listen` is async but `attach` is not, because the caller is a React
    // effect and an effect's cleanup has to be returned synchronously. So the
    // subscription is set up in the background and this flag covers the window
    // between: a component that mounts and unmounts before Tauri has registered
    // the listener must still end up with nothing listening.
    let live = true;
    const unlisteners: (() => void)[] = [];

    // Nothing may reach the emulator until the backlog has, or history would
    // arrive after the present. Live events that land in the meantime wait
    // here; `cursor` is the sequence number the backlog ends at, so a chunk the
    // backlog already contains — possible when re-attaching to a session that
    // was already streaming to another window — is dropped rather than shown
    // twice.
    let ready = false;
    let cursor = 0;
    const queued: PtyChunk[] = [];

    void (async () => {
      const stop = await listen<PtyChunk>(`pty:data:${id}`, (e) => {
        if (!live) return;
        if (!ready) queued.push(e.payload);
        else if (e.payload.seq >= cursor) onData(e.payload.data);
      });
      if (!live) return stop();
      unlisteners.push(stop);

      // Only now — with a listener actually registered — does Rust start
      // emitting. Everything the shell said before this point comes back in
      // one piece, which for the launch terminal is the cursor-position
      // request the shell is sitting and waiting on. Writing it into the
      // emulator is what produces the reply that unblocks it.
      const caught = await invoke<PtyAttachment | null>("terminal_attach", { id });
      if (!live) return;
      if (!caught) return; // the tab closed while this view was mounting.

      if (caught.text) onData(caught.text);
      cursor = caught.nextSeq;
      ready = true;
      for (const chunk of queued) {
        if (chunk.seq >= cursor) onData(chunk.data);
      }
      queued.length = 0;

      // The shell was already gone before anyone attached — a bad `HELVE_SHELL`
      // or a crash on startup. `pty:exit` fired into the same empty room the
      // output did, so the reap has to happen here instead.
      if (caught.exited) terminalControl.close(id);
    })();

    void (async () => {
      const stop = await listen(`pty:exit:${id}`, () => {
        // The shell ended on its own — `exit`, or it crashed. The session is
        // reaped through the same path a close button uses, so the tab
        // disappears the one way rather than two.
        if (live) terminalControl.close(id);
      });
      if (live) unlisteners.push(stop);
      else stop();
    })();

    return () => {
      live = false;
      for (const stop of unlisteners) stop();
    };
  },

  write(id, data) {
    if (isFake()) return fakeTransport.write(id, data);
    void invoke("terminal_write", { id, data });
  },

  resize(id, cols, rows) {
    if (isFake()) return fakeTransport.resize(id, cols, rows);
    void invoke("terminal_resize", { id, cols, rows });
  },
};

// --- the fake ---------------------------------------------------------------
//
// `?fake=1` runs the whole shell in a plain browser with no Tauri underneath
// it, which is how the panel's geometry gets measured rather than eyeballed —
// see `fakeBackend.ts`. A terminal with no bytes in it would measure as an
// empty box, so this is a small echo shell: enough output to fill a viewport,
// enough interactivity to prove keystrokes reach the transport and come back.
//
// It is not an emulator and does not try to be. No shipped code path reads it.

const fakeListeners = new Map<string, (chunk: string) => void>();
let fakeSerial = 1;

function fakeEmit(id: string, chunk: string) {
  fakeListeners.get(id)?.(chunk);
}

const fakeControl: TerminalControl = {
  create() {
    fakeSerial += 1;
    return Promise.resolve(`term-fake-${fakeSerial}`);
  },
  close() {
    /* Nothing to kill. */
  },
  busy(id) {
    // Every third fake session claims to be busy, so the confirmation dialog
    // and the silent close are both reachable without a real process.
    const busy = id.endsWith("3");
    return Promise.resolve(busy ? { process: "npm" } : null);
  },
};

const fakeTransport: TerminalTransport = {
  attach(id, onData) {
    fakeListeners.set(id, onData);
    // A frame's delay so the caller's emulator has finished mounting; writing
    // into an xterm that has not been opened yet is dropped silently.
    const timer = setTimeout(() => {
      fakeEmit(id, `\x1b[38;5;180mhelve\x1b[0m ${id} — fake shell, no pty\r\n$ `);
    }, 0);
    return () => {
      clearTimeout(timer);
      fakeListeners.delete(id);
    };
  },

  write(id, data) {
    // Local echo, with just enough handling to feel like a line editor:
    // Return moves to a fresh prompt, Backspace rubs a character out.
    if (data === "\r") fakeEmit(id, "\r\n$ ");
    else if (data === "\x7f") fakeEmit(id, "\b \b");
    else fakeEmit(id, data);
  },

  resize() {
    /* Nothing to tell. */
  },
};
