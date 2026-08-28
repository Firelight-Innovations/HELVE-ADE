/**
 * Forger: technical design software, today an empty shell.
 *
 * There is no product surface yet — see `src-tauri/src/apps/forger.rs` for why
 * this app exists before there is anything to design. What this component owes
 * is the same thing every app owes: draw something honest and report
 * `reportPainted()` once it has, whether `forger/state` answered or failed.
 */
import { useEffect, useState } from "react";
import { reportPainted } from "@openkaava/bridge";
import { fetchState, reasonFor, type State } from "./rpc";

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(reasonFor(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The condition is "the first answer landed", either way it went — the same
  // rule `apps/README.md` states and `apps/home/ui/src/App.tsx` follows. A
  // browser with no Tauri under it (`pnpm dev:agent`) rejects every `invoke`,
  // and that failure is this app's honest first frame, not a reason to wait.
  useEffect(() => {
    if (state !== null || error !== null) reportPainted();
  }, [state, error]);

  return (
    <div className="app">
      <header className="app__head">
        <h1 className="app__title">Forger</h1>
        <span className="app__sub">Technical design software</span>
      </header>
      <div className="app__body">
        {error ? (
          <p className="app__error">{error}</p>
        ) : (
          <div className="forger__empty">
            <p>Forger is not built yet.</p>
            <p className="app__note">
              {state?.project
                ? `This cluster's project is ${state.project}, but there is nothing here to design against it with.`
                : "This cluster has no project open, and there would be nothing to design against it yet either way."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
