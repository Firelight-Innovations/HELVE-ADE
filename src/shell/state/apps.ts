/**
 * The first-party apps this build ships.
 *
 * Mirrors `src-tauri/src/apps/mod.rs`. Asked for once and never again: the
 * registry is compiled in, so unlike the stack snapshot there is nothing on
 * disk that could change the answer while the shell is running, and no
 * "re-scan apps" to offer.
 *
 * Starts as an empty array rather than `null`. The distinction the stack
 * snapshot needs — "not loaded yet" against "loaded and empty" — buys nothing
 * here: the switcher simply gains its app tabs a frame later.
 */
import { useEffect, useState } from "react";
import {
  appCall,
  listApps,
  listOpenables,
  type AppInfo,
  type CallScope,
  type Openable,
} from "../../bindings";

export function useApps(): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>([]);

  useEffect(() => {
    let live = true;
    void listApps()
      .then((result) => live && setApps(result))
      // An app list that fails to load leaves the switcher showing tools only.
      // Reported rather than swallowed: every other path here is infallible, so
      // a failure is worth seeing instead of reading as "this build ships none".
      .catch((err: unknown) => console.error("helve: could not list apps:", err));

    return () => {
      live = false;
    };
  }, []);

  return apps;
}

/**
 * Everything the Apps menu can open: every app, then a terminal.
 *
 * A second hook beside `useApps` rather than a wider version of it, and not
 * redundant with it: `useApps` is *things with a frontend*, which is what
 * `ToolWindow` resolves a mountable address from; this is *things you can open*,
 * and a terminal is one of those without being one of those. `bindings.ts`'s
 * `Openable` has the full reasoning, including what an empty `url` would break.
 *
 * Empty until it answers, like `useApps` above.
 */
export function useOpenables(): Openable[] {
  const [openables, setOpenables] = useState<Openable[]>([]);

  useEffect(() => {
    let live = true;
    void listOpenables()
      .then((result) => live && setOpenables(result))
      // An empty Apps menu is the symptom, and it looks exactly like a feature
      // that was never wired up — so it is reported rather than swallowed, for
      // the reason `useApps` gives about its own failure.
      .catch((err: unknown) => console.error("helve: could not list openables:", err));

    return () => {
      live = false;
    };
  }, []);

  return openables;
}

/**
 * Relay one app frame's `invoke` to its Rust half.
 *
 * A pass-through to `appCall` today, kept as a named seam rather than inlined:
 * every app call in the shell goes through this one line, which is where a
 * different backend would be reached from. Its rejection shape is `appCall`'s.
 *
 * `scope` says which surface is asking, which is what decides *which project*
 * the call is answered against now that a project belongs to a cluster. It is
 * the caller's to supply and not this function's to guess: `ToolWindow` knows
 * the instance because it resolved the message's `event.source`, and the title
 * bar's menu items know the cluster their window is showing. Omitting it is
 * allowed and means "no cluster" — every app already handles that, since it is
 * the same state as a cluster nobody has opened anything in.
 */
export function callApp(
  id: string,
  method: string,
  params?: unknown,
  scope?: CallScope,
): Promise<unknown> {
  return appCall(id, method, params, scope);
}
