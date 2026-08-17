/**
 * The frontend half of the layout presets.
 *
 * Mirrors `src-tauri/src/presets/mod.rs`. A preset is a named arrangement — the
 * split shape, and which app belongs in each pane — and it is *user data*: it
 * lives in `presets.json`, outlives every layout it was captured from, and
 * belongs to no cluster and no project.
 *
 * Fetched once, then subscribed — the same shape `useShellState` uses and for
 * the same reason: Tauri events have
 * no replay buffer, so a window that only subscribed would sit with an empty
 * menu until somebody saved something. Subscribe first, then fetch, and discard
 * the fetch if an event beat it home.
 *
 * Not an optimisation either. Presets are one global list and every window a
 * projection of it, so a second window still offering yesterday's menu after a
 * save in the first is the drift `shell:state` exists to prevent — for one event
 * on a deliberate save and nothing the rest of the time.
 *
 * Deliberately not a store: nothing here caches, merges or reconciles. Rust
 * merges the built-ins with the file and broadcasts the whole answer; this
 * re-renders with it.
 */
import { useEffect, useState } from "react";
import { applyLayoutPreset, listPresets, onPresetsChanged, saveLayoutPreset } from "../../bindings";
import type { LayoutPreset } from "../contract";

/**
 * Every preset: built-ins first, then what survives of `presets.json`.
 *
 * Starts empty rather than `null`, like `useApps` and for its reason: nothing in
 * the interface is reachable only while presets resolve, so the submenu gains
 * its rows a frame later. A built-in can never be missing, so the empty list
 * lasts one render and never recurs.
 */
export function useLayoutPresets(): LayoutPreset[] {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);

  useEffect(() => {
    let live = true;
    let settled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      unlisten = await onPresetsChanged((next) => {
        if (!live) return;
        settled = true;
        setPresets(next);
      });

      try {
        const initial = await listPresets();
        // An event arrived while that round trip was in flight, and it is newer
        // than what we asked for. Dropping it is the whole point of the flag.
        if (live && !settled) setPresets(initial);
      } catch (err: unknown) {
        // Rust degrades a broken `presets.json` to the built-ins, so reaching
        // this means the *call* failed. Worth seeing: the symptom is an empty
        // submenu, which reads as a feature nobody wired up.
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
 * menu row is drawn in the bar of the cluster you are looking at, so the backend
 * acts on the window's active cluster, as `open_instance` does. See
 * `commands::apply_preset`.
 *
 * **Nothing open is closed.** Surfaces matching the preset's slots move into
 * them, missing slots get fresh surfaces, and everything else lands in the last
 * pane. The rule and its reasoning are in `presets::plan`.
 */
export function applyPreset(label: string, presetId: string): Promise<void> {
  return applyLayoutPreset(label, presetId);
}

/**
 * Capture the active cluster's arrangement under `name`.
 *
 * Rejects with a sentence meant to be *shown* — a blank name, or one the
 * built-ins already hold — which is why the caller is a field rather than a
 * `.catch`. Resolves with nothing: the new list arrives on the broadcast.
 */
export async function savePreset(label: string, name: string): Promise<void> {
  await saveLayoutPreset(label, name);
}
