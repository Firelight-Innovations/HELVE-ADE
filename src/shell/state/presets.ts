/**
 * The frontend half of the layout presets.
 *
 * Mirrors `src-tauri/src/presets/mod.rs`. A preset is a named arrangement — the
 * split shape, and which app belongs in each pane — and it is *user data*: it
 * lives in `presets.json` beside `projects.json` and `layout.json`, outlives
 * every layout it was captured from, and belongs to no cluster and no project.
 *
 * ## Fetched once, then subscribed
 *
 * The same shape `useShellState` uses and for the same reason: Tauri events have
 * no replay buffer, so a window that only subscribed would sit with an empty
 * menu until somebody saved something. Subscribe first, then fetch, and discard
 * the fetch if an event beat it home.
 *
 * The subscription is not an optimisation either. Presets are one global list,
 * every window is a projection of it, and a second window still offering
 * yesterday's menu after a save in the first is exactly the kind of drift this
 * codebase spends `shell:state` to prevent. It costs one event on a deliberate
 * save and nothing at all the rest of the time.
 *
 * ## Deliberately not a store
 *
 * Nothing here caches, merges or reconciles. Rust merges the built-ins with the
 * file and broadcasts the whole answer; this re-renders with it.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LayoutPreset } from "../contract";
import { isFake, fakePresets } from "./fakeBackend";

export const PRESETS_CHANGED_EVENT = "presets:changed";

/**
 * Every preset: the compiled-in built-ins first, then whatever survives of
 * `presets.json`.
 *
 * Starts empty rather than `null`, like `useApps` and for its reason: no state
 * in the interface is reachable only while presets are still resolving, so the
 * submenu simply gains its rows a frame later. A built-in can never actually be
 * missing, so an empty list is a state that lasts one render and never recurs.
 */
export function useLayoutPresets(): LayoutPreset[] {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);

  useEffect(() => {
    if (isFake()) return fakePresets.subscribe(setPresets);

    let live = true;
    let settled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      unlisten = await listen<LayoutPreset[]>(PRESETS_CHANGED_EVENT, (e) => {
        if (!live) return;
        settled = true;
        setPresets(e.payload);
      });

      try {
        const initial = await invoke<LayoutPreset[]>("list_presets");
        // An event arrived while that round trip was in flight, and it is newer
        // than what we asked for. Dropping it is the whole point of the flag.
        if (live && !settled) setPresets(initial);
      } catch (err: unknown) {
        // Rust degrades a broken `presets.json` to the built-ins rather than
        // failing, so reaching this means the *call* failed — which is worth
        // seeing, because the symptom is a submenu with nothing in it and that
        // looks like a feature that was never wired up.
        console.error("helve: could not list layout presets:", err);
      }
    })();

    return () => {
      live = false;
      unlisten?.();
    };
  }, []);

  return presets;
}

/**
 * Rearrange this window's active cluster to match a preset.
 *
 * Takes no cluster id, and that is the contract rather than an omission: the
 * menu row is drawn in the bar of the cluster you are looking at, and the
 * backend acts on the window's active cluster for the same reason
 * `open_instance` does. See `commands::apply_preset`.
 *
 * **Nothing open is closed.** Surfaces matching the preset's slots move into
 * them, missing slots get fresh surfaces, and everything else lands in the last
 * pane. The rule and its reasoning are in `presets::plan`.
 */
export function applyPreset(label: string, presetId: string): Promise<void> {
  if (isFake()) return fakePresets.apply(presetId);
  return invoke("apply_preset", { label, presetId });
}

/**
 * Capture the active cluster's arrangement under `name`.
 *
 * Rejects with a sentence meant to be *shown* — a blank name, or one the
 * built-ins already hold — which is why the caller is a field rather than a
 * `.catch(console.error)`. Resolves with nothing: the new list arrives through
 * the broadcast, like every other shared thing in this shell.
 */
export async function savePreset(label: string, name: string): Promise<void> {
  if (isFake()) return fakePresets.save(name);
  await invoke<LayoutPreset[]>("save_preset", { label, name });
}
