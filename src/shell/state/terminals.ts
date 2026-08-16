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

export const terminalControl: TerminalControl = {
  create(windowLabel, cols, rows) {
    return invoke<string>("create_terminal", { label: windowLabel, cols, rows });
  },

  createInPane(windowLabel, paneId, dir) {
    // No `cols`/`rows`. The panel's `create` passes an 80×24 first guess
    // because the caller has a deck to size it against; a pane terminal is
    // mounted by `ToolWindow` over a rectangle nobody has measured at the
    // moment of asking, so guessing here would be inventing a number rather
    // than reporting one. Rust uses the same 80×24 placeholder, and the
    // emulator corrects it the instant it has measured itself.
    //
    // `dir` is the one thing that *is* measured before the call, and it is a
    // different measurement: the pane being split is already on screen, where
    // the pane being opened is not. See `panes/splitOnOpen.ts`.
    return invoke<string>("open_terminal_in_pane", {
      label: windowLabel,
      paneId: paneId ?? null,
      dir: dir ?? null,
    });
  },

  split(sourceId, cols, rows) {
    return invoke<string>("split_terminal", { id: sourceId, cols, rows });
  },

  close(id) {
    forgetTitleState(id);
    void invoke("close_terminal", { id });
  },

  busy(id) {
    // Rust answers `Option<Busy>`, which arrives as the value or `null`. No
    // mapping needed — `null` already means "idle, close it without asking".
    return invoke<TerminalBusy | null>("terminal_busy", { id });
  },

  setTitle(id, title) {
    reportTitle(id, title, (id, title) => {
      void invoke("set_terminal_title", { id, title });
    });
  },
};

// --- title coalescing --------------------------------------------------------
//
// A shell that redraws its prompt commonly rewrites its title on every line —
// most set it to the working directory — and every report round-trips to
// Rust and broadcasts `shell:state` to every window. Left unchecked, a busy
// prompt would mean a shell-state broadcast on every keystroke of typing at
// it. So reports are coalesced per session before they ever reach `invoke`:
// a trailing 150ms debounce collapses a burst of rewrites from one prompt
// redraw into the single title still current 150ms later, and a title
// identical to the last one actually sent is dropped rather than re-sent —
// which also covers the common case of a title that never changes at all,
// after the first report.
//
// Rust re-checks the "identical to what's stored" half of this on its own
// (`ShellState::set_terminal_title`) — this map only needs to agree with
// itself, not with Rust, since a wrong guess here costs one redundant
// `invoke` rather than a wrong tab name.
const lastSentTitle = new Map<string, string>();
const titleTimers = new Map<string, ReturnType<typeof setTimeout>>();

const TITLE_DEBOUNCE_MS = 150;

function reportTitle(id: string, title: string, send: (id: string, title: string) => void) {
  const trimmed = title.trim();
  if (!trimmed) return; // never blank the shell-name fallback with a report.

  const pending = titleTimers.get(id);
  if (pending) clearTimeout(pending);

  titleTimers.set(
    id,
    setTimeout(() => {
      titleTimers.delete(id);
      if (lastSentTitle.get(id) === trimmed) return;
      lastSentTitle.set(id, trimmed);
      send(id, trimmed);
    }, TITLE_DEBOUNCE_MS),
  );
}

/** Drop a closed session's coalescing state, so a reused-looking id (there
 *  isn't one today, but nothing here should assume that) can't inherit a
 *  stale "already sent" title, and so the maps don't grow for the life of
 *  the window. */
function forgetTitleState(id: string) {
  lastSentTitle.delete(id);
  const pending = titleTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    titleTimers.delete(id);
  }
}

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
    void invoke("terminal_write", { id, data });
  },

  resize(id, cols, rows) {
    void invoke("terminal_resize", { id, cols, rows });
  },
};
