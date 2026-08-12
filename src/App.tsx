import { useCallback, useEffect, useState } from "react";
import { cachedStack, loadStack, type StackSnapshot } from "./bindings";
import WindowRoot from "./shell/WindowRoot";
import { fakeStack, isFake } from "./shell/state/fakeBackend";

/**
 * Owns the stack snapshot and hands it to the shell.
 *
 * All this does is data: fetch, refresh, and error state. Everything about how
 * the app looks and what it shows lives under `shell/`. Keeping the fetch here
 * rather than inside the shell means the shell can be restyled or rearranged
 * without anything having to know how the snapshot is obtained.
 */
export default function App() {
  const [snapshot, setSnapshot] = useState<StackSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rescan = useCallback(async () => {
    if (isFake()) return;
    setBusy(true);
    try {
      setSnapshot(await loadStack());
      setError(null);
    } catch (err) {
      // Rust `Result::Err` becomes a rejected promise. Our AppError serializes
      // to its message string, so this is already human-readable.
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // `?fake=1` runs the shell in a plain browser with no Tauri underneath —
    // see `shell/state/fakeBackend.ts` for why that exists.
    if (isFake()) {
      setSnapshot(fakeStack());
      return;
    }

    // `boot::start` already read the manifest and scanned every checkout
    // once, behind the splash window, before this window was ever shown —
    // so pick up its cached result here instead of paying for a second scan
    // on every mount. `loadStack` is only the fallback for the case boot
    // has nothing cached (it failed and the user clicked "Continue anyway"
    // on the splash before a snapshot was ever stored).
    void (async () => {
      try {
        const cached = await cachedStack();
        if (cached) {
          setSnapshot(cached);
          setError(null);
          return;
        }
        await rescan();
      } catch (err) {
        setError(String(err));
      }
    })();
  }, [rescan]);

  return (
    <WindowRoot
      snapshot={snapshot}
      error={error}
      rescanning={busy}
      onRescan={() => void rescan()}
    />
  );
}
