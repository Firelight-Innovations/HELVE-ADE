/**
 * The first-party apps this build ships.
 *
 * Mirrors `src-tauri/src/apps/mod.rs`. Asked for once and never again: the
 * registry is compiled in, so unlike the stack snapshot there is nothing on
 * disk that could change the answer while the shell is running, and no
 * "re-scan apps" to offer.
 *
 * Starts as an empty array rather than `null`. The distinction the stack
 * snapshot needs — "not loaded yet" as against "loaded and empty" — buys
 * nothing here, because no state in the interface is reachable only when apps
 * are still resolving; the switcher simply gains its app tabs a frame later.
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
import { HelveErrorCode } from "../../../packages/bridge/src/errors";
import { isFake, fakeAppCall, fakeApps, fakeOpenables } from "./fakeBackend";

export function useApps(): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>([]);

  useEffect(() => {
    if (isFake()) {
      setApps(fakeApps());
      return;
    }

    let live = true;
    void listApps()
      .then((result) => live && setApps(result))
      // An app list that fails to load leaves the switcher showing tools only.
      // Reported rather than swallowed: every other path here is infallible, so
      // if this ever fires, whatever went wrong is worth seeing in the console
      // instead of being read as "this build ships no apps".
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
 * A second hook beside `useApps` rather than a wider version of it, and the two
 * are not redundant — they answer different questions and only one of them
 * carries a URL. `useApps` is *things with a frontend*, and it is what
 * `ToolWindow` resolves a mountable address from; this is *things you can open*,
 * and a terminal is one of those without being one of those. `bindings.ts`'s
 * `Openable` has the full reasoning, including what an empty `url` would break.
 *
 * Empty until it answers, like `useApps` above: the menu gains its rows a frame
 * later, and no state in the interface is reachable only while it is resolving.
 */
export function useOpenables(): Openable[] {
  const [openables, setOpenables] = useState<Openable[]>([]);

  useEffect(() => {
    if (isFake()) {
      setOpenables(fakeOpenables());
      return;
    }

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
 * Rejects with a `{ code, message }` envelope in both directions — the same
 * shape `app_call` fails with on the Rust side, so the caller (`ToolWindow`)
 * has one thing to put in a `response` message rather than two error
 * vocabularies to tell apart.
 *
 * `scope` says which surface is asking, which is what decides *which project*
 * the call is answered against now that a project belongs to a cluster. It is
 * the caller's to supply and not this function's to guess: `ToolWindow` knows
 * the instance because it resolved the message's `event.source`, and the title
 * bar's menu items know the cluster their window is showing. Omitting it is
 * allowed and means "no cluster" — every app already handles that, since it is
 * the same state as a cluster nobody has opened anything in.
 *
 * Under `?fake=1` an app's frontend still mounts and still completes its
 * handshake, because both of those are the shell's own work. What it cannot do
 * is reach Rust, so the call goes to `fakeAppCall` instead. That answers Home's
 * reads and the whole of `files/*` from fixtures, refuses what the backend
 * would refuse, and returns `undefined` for everything left — which is refused
 * here, with the same code a method that failed inside its handler would use.
 *
 * All three outcomes are load-bearing. The answers are what make a pane's
 * layout, its tree, and its viewers measurable in a browser; the fixture's own
 * refusals are what keep an app's error paths reachable; and the last one keeps
 * this from claiming a health it does not have — the three actions that open a
 * *native folder picker* have no answer here that would not be an invention,
 * and a fixture that looked healthier than the backend is the exact failure
 * that once hid an empty switcher bar.
 */
export async function callApp(
  id: string,
  method: string,
  params?: unknown,
  scope?: CallScope,
): Promise<unknown> {
  if (isFake()) {
    const fixture = await fakeAppCall(method, params, scope);
    if (fixture !== undefined) return fixture;

    throw {
      code: HelveErrorCode.InternalError,
      message: `${method}: no backend (browser mode)`,
    };
  }
  return appCall(id, method, params, scope);
}
