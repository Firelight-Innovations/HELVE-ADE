import { useEffect, useState } from "react";
import { HelveRpcError, reportPainted } from "@helve-ade/bridge";
import { readState, type JourneymanState } from "./rpc";

/**
 * Journeyman today: a titled empty state and nothing else.
 *
 * The app is a skeleton — see `src-tauri/src/apps/journeyman.rs`'s module doc
 * for why it exists in this shape rather than not existing yet. There is no
 * product surface to build a loading state, a form or a list around, so this
 * component does the one thing every app owes the shell (`reportPainted`,
 * `apps/README.md`) and renders the two states `journeyman/state` can actually
 * produce: an honest "not built yet", and an honest failure when there is no
 * backend to ask, which is the case under `pnpm dev:agent`.
 */
export default function App() {
  const [state, setState] = useState<JourneymanState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void readState()
      .then((next) => {
        if (live) {
          setState(next);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(describe(e));
      });

    return () => {
      live = false;
    };
  }, []);

  // Reports once the first answer has landed, either way it went — the same
  // rule `apps/home/ui/src/App.tsx` follows. A pane that could not reach its
  // backend has still finished drawing: it is showing the failure, which is
  // the whole of what it has to say, and holding the splash up for a screen
  // that will not improve only delays the bad news.
  useEffect(() => {
    if (state !== null || error !== null) reportPainted();
  }, [state, error]);

  return (
    <div className="app journeyman">
      <header className="app__head">
        <h1 className="app__title">Journeyman</h1>
        <span className="app__sub">The build side of the stack, downstream of Forger</span>
      </header>
      <div className="app__body">
        {error ? (
          <p className="app__error">{error}</p>
        ) : (
          <div className="journeyman__empty">
            <p>Journeyman is not built yet.</p>
            <p className="app__note">
              {state?.project ? `Project: ${state.project}` : "No project is open in this cluster."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A `HelveRpcError` carries the code its host produced it from, which is the
 * difference between "this build has no such method" and "the call never
 * reached a host at all" — the second of which is what every reader of this
 * app in a plain browser will see, since `pnpm dev:agent` mounts the shell
 * with nothing behind it. Anything else is shown as-is rather than guessed at.
 */
function describe(error: unknown): string {
  if (error instanceof HelveRpcError) return `[${error.code}] ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
