/**
 * Files dragged into the window from outside it.
 *
 * The other drag. `useDrag` is a pointer gesture watched from press to release,
 * moving things the shell already owns; this one belongs to the operating
 * system, is already in flight when we first hear of it, and carries paths.
 * There is no `pointerdown` to hang it off and no ghost to draw — Explorer
 * draws its own — so the two cannot be one hook. What they share is the part
 * worth sharing: both ask `dropZones.ts` where a release lands.
 *
 * The gesture's shape is adapted from `handleInternalTerminalFileDrop` in
 * Orca's `src/renderer/src/components/terminal-pane/terminal-drop-handler.ts`
 * (MIT, (c) Lovecast Inc.; see THIRD-PARTY-NOTICES): resolve a pane from the
 * drop target, resolve that pane's shell, write quoted paths to its pty, never
 * send a newline. None of the code is — Orca reads a `DataTransfer`, which a
 * Tauri webview with drag-drop enabled never hands you.
 */
import { useEffect, useState } from "react";
import { onFileDrag } from "../../bindings";
import { terminalAt } from "../dropZones";
import { terminalTransport } from "../state/terminals";

/**
 * Track an incoming file drag, and insert what it drops.
 *
 * Returns the session id the drag is over, or `null` — the whole public
 * surface. A caller draws an affordance from it and nothing else, because the
 * commit already happened in here, which is what stops two windows both acting
 * on one drop.
 */
export function useFileDrag(): string | null {
  const [targetId, setTargetId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;

    void (async () => {
      const unlisten = await onFileDrag((drag) => {
        if (!live) return;
        if (drag.kind === "leave") return setTargetId(null);
        if (drag.kind === "over") return setTargetId(terminalAt(drag.x, drag.y));

        setTargetId(null);
        commit(drag.x, drag.y, drag.paths);
      });

      if (!live) return unlisten();
      stop = unlisten;
    })();

    return () => {
      live = false;
      stop?.();
    };
  }, []);

  return targetId;
}

/**
 * A release. The target is re-tested from the drop's own coordinates rather
 * than reused from the last `over`: the two are separate events, and a drag
 * flicked across the window produces a `drop` no `over` ever reported.
 */
function commit(x: number, y: number, paths: string[]): void {
  const id = terminalAt(x, y);
  if (!id) {
    // Over the window, over no terminal. Nothing is the right answer — a path
    // means nothing to a pane showing Files, and "the focused terminal" would
    // put text where the user was not pointing. Logged at `debug` because
    // declining is correct and a decline is otherwise indistinguishable from a
    // failure; see `useDrag`'s `commitCluster`, which says the same.
    console.debug(`helve: ${paths.length} file(s) dropped over no terminal`);
    return;
  }
  if (paths.length > 0) terminalTransport.insertPaths(id, paths);
}
