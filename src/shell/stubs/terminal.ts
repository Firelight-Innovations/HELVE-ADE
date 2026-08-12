/**
 * A fake `TerminalSource`, for the secondary panel to run against before
 * real terminal emulation exists.
 *
 * The starting sessions match the names the handoff's default screen draws
 * — "bash", "bash 2", "forger" — and the shell's own fake backend
 * (src/shell/state/fakeBackend.ts) uses the same three names, so a screenshot
 * of either lines up with the other. Only "forger" starts with
 * `agentFinished: true`, which is what puts the dot on its tab.
 *
 * `bash`'s lines are lifted verbatim from SCREEN 01's panel crop
 * (docs/handoffs/shell-spec.html) — the `$ helve run forger` transcript,
 * tone for tone. `bash 2`'s lines are SCREEN 02's "no tool attached" crop,
 * so both panel variants the handoff draws exist somewhere in this fixture.
 * `forger`'s content isn't drawn anywhere in the handoff (its tab is never
 * the selected one in a crop), so it's invented but tone-plausible.
 *
 * `create` and `close` mutate real module state and notify subscribers, so
 * "add a terminal" and "close a terminal" are genuinely exercisable against
 * this stub, not just visually present.
 */
import type { TerminalSession, TerminalSource } from "../contract";

function initialSessions(): TerminalSession[] {
  return [
    {
      id: "term-1",
      title: "bash",
      agentFinished: false,
      lines: [
        { text: "$ helve run forger", tone: "prompt" },
        { text: "ok    checkout resolved", tone: "ok" },
        { text: "…    starting process", tone: "info" },
        { text: "      waiting for handshake", tone: "muted" },
        { text: "ok    handshake accepted", tone: "ok" },
        { text: "$ ", tone: "prompt" },
      ],
    },
    {
      id: "term-2",
      title: "bash 2",
      agentFinished: false,
      lines: [
        { text: "helve — no tool attached", tone: "prompt" },
        { text: "$ ", tone: "prompt" },
      ],
    },
    {
      id: "term-3",
      title: "forger",
      agentFinished: true,
      lines: [
        { text: "$ helve test forger", tone: "prompt" },
        { text: "ok    12 passed", tone: "ok" },
        { text: "…    packaging build", tone: "info" },
        { text: "ok    build complete", tone: "ok" },
        { text: "$ ", tone: "prompt" },
      ],
    },
  ];
}

let sessions = initialSessions();
let nextSerial = sessions.length + 1;
const listeners = new Set<(sessions: TerminalSession[]) => void>();

function notify() {
  const snapshot = sessions.slice();
  for (const cb of listeners) cb(snapshot);
}

export const stubTerminalSource: TerminalSource = {
  subscribe(cb) {
    listeners.add(cb);
    cb(sessions.slice());
    return () => {
      listeners.delete(cb);
    };
  },

  create() {
    const id = `term-${Date.now()}-${nextSerial}`;
    const title = `bash ${nextSerial}`;
    nextSerial += 1;
    sessions = [...sessions, { id, title, agentFinished: false, lines: [{ text: "$ ", tone: "prompt" }] }];
    notify();
    return id;
  },

  close(id) {
    sessions = sessions.filter((s) => s.id !== id);
    notify();
  },
};
