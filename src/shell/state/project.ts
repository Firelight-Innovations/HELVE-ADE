/**
 * Which project is open, for the shell itself.
 *
 * The shell has never needed this before — a project was something the apps
 * knew about, reached over transport B, and Rust broadcast `project:changed`
 * only so `ToolWindow` could relay it into the app frames. The title bar names
 * the project now, so the shell has become a subscriber in its own right and
 * needs its own read of the same two things: the current value at mount, and
 * every change after it.
 *
 * The initial read goes through `home/state`, which is Home's method rather
 * than the shell's. That is the same knowledge `WindowRoot` already spends on
 * File > Open… — the shell knows which app owns projects, because it is the app
 * a window opens on — and it is cheaper than a second Tauri command returning
 * the snapshot the event already carries. If a `project/state` command is ever
 * added for its own reasons, this is the one line that changes.
 *
 * There is no watcher behind any of it. A project renamed on disk while HELVE
 * is running keeps its old name in the bar until something opens it again, and
 * that is the same staleness `ProjectInfo.name` has everywhere else.
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { callApp } from "./apps";
import { isFake, subscribeFakeProject } from "./fakeBackend";

/** The part of Rust's `ProjectInfo` anything in the shell reads. */
export interface OpenProject {
  name: string;
  path: string;
}

/** `null` for "nothing open" and for "not answered yet" alike — the title bar
 *  draws the same thing for both, and a third state would be a distinction with
 *  nowhere to show. */
export function useOpenProject(): OpenProject | null {
  const [open, setOpen] = useState<OpenProject | null>(null);

  useEffect(() => {
    // `?fake=1` has no Tauri event system, and an unguarded `listen` rejects on
    // mount — the same guard `ToolWindow` and `state/terminals.ts` carry, for
    // the same reason. The fixture's own subscription stands in for it, so
    // opening a recent project in Home still retitles the bar in a browser.
    if (isFake()) return subscribeFakeProject(setOpen);

    let live = true;
    let unlisten: (() => void) | undefined;

    void callApp("home", "home/state")
      .then((state) => live && setOpen(openOf(state)))
      // Left as "no project" rather than surfaced. The bar's answer to a failed
      // read and to nothing being open is the same drawing, and there is no
      // slot in a title for an error — the console is where this belongs.
      .catch((err: unknown) => console.error("helve: could not read the open project:", err));

    // `listen` is async and a cleanup must be returned synchronously, so the
    // subscription is set up in the background and `live` covers the gap.
    void (async () => {
      const stop = await listen<unknown>("project:changed", (e) => {
        if (live) setOpen(openOf(e.payload));
      });
      if (!live) return stop();
      unlisten = stop;
    })();

    return () => {
      live = false;
      unlisten?.();
    };
  }, []);

  return open;
}

/**
 * Pull the open project out of a `ProjectSnapshot`, or `null` from anything
 * that isn't one.
 *
 * Defensive because both inputs are `unknown` at this boundary: `home/state`
 * answers with whatever Rust serialized, and the event payload is relayed
 * without ever being typed. A shape check here costs nothing and keeps a
 * malformed payload from putting `undefined` in the window title.
 */
function openOf(snapshot: unknown): OpenProject | null {
  const value = (snapshot as { open?: unknown } | null)?.open;
  if (typeof value !== "object" || value === null) return null;

  const { name, path } = value as { name?: unknown; path?: unknown };
  if (typeof name !== "string" || typeof path !== "string") return null;
  return { name, path };
}
