/**
 * The title bar's File menu, from this side.
 *
 * The shell's menu bar cannot reach into this app — File Explorer runs in an
 * iframe and the shell must not import its hooks or poke its DOM. So a menu
 * item is a *message*: the shell posts a transport-B `command` to the active
 * frame, and this module is what this frame does about it.
 * `docs/tool-protocol.md` §3 has the wire shape; `@helve/bridge`'s `onCommand`
 * is the receiving end.
 *
 * ## Two apps, two declarations, and no coordination between them
 *
 * There is a second copy of this file in `apps/viewer/ui/src/`, answering the
 * commands that act on an open buffer — Save, Save As, Duplicate, Undo. This
 * one answers the two that act on the *tree*.
 *
 * Nothing had to be built for that to work, and nothing in the title bar knows
 * the split happened. The shell aims a command at whichever surface is active
 * and greys out everything that surface has not declared, so the menu is simply
 * the union of what the active frame offered. Click into the tree and New File
 * lights up; click into an editor and Save does. That falls out of
 * `helve/commands` being a declaration rather than a registry, which is the
 * property its design note in `docs/tool-protocol.md` argues for.
 *
 * ## The one thing this app gave up
 *
 * `file/delete` is declared by the Viewer, not here, and so a menu-bar Delete
 * acts on the open file rather than on the tree's cursor. That is a real
 * narrowing from the single-app version, and it is deliberate rather than
 * missed: the tree's cursor is `explorer/Explorer.tsx`'s own state and reaching
 * it would mean a third method on `ExplorerHandle`. Right-click > Delete on a
 * row is unaffected and is how a folder gets deleted either way.
 *
 * ## Why the ids are spelled out here rather than imported
 *
 * They also exist in `src/shell/titlebar/TitleBar.tsx` as `APP_COMMAND`. This
 * is the same restatement `rpc.ts`'s header argues for and for the same reason:
 * an app's only coupling to its host is `@helve/bridge` and the shape of what
 * crosses it, and the day this becomes a tool repository of its own, nothing in
 * `apps/files/` may be reaching into `src/`.
 */
import { useCallback, useEffect, useRef } from "react";
import { declareCommands, onCommand } from "@helve/bridge";
import type { ExplorerHandle } from "./explorer/Explorer";
import type { Root } from "./rpc";

/** Every command this app answers. Mirrors `APP_COMMAND` in the shell. */
export const COMMAND = {
  newFile: "file/new-file",
  trash: "file/trash",
} as const;

export interface MenuCommandDeps {
  root: Root | null;
  /** The tree, for New File and Trash. `null` until it mounts. */
  explorer: React.RefObject<ExplorerHandle | null>;
  /** Report a failure where the user will see it. */
  onError: (message: string) => void;
}

/**
 * Answer the shell's menu, and keep it honest about what is possible.
 *
 * Returns nothing: everything it does is either a side effect on the tree or a
 * declaration going out over the bridge.
 */
export function useMenuCommands({ root, explorer }: MenuCommandDeps): void {
  const run = useCallback(
    (command: string) => {
      switch (command) {
        case COMMAND.newFile:
          explorer.current?.newFile();
          return;

        case COMMAND.trash:
          explorer.current?.showTrash();
          return;

        default:
          // A command the shell sent that this app never declared. Dropped
          // rather than guessed at — the shell only sends what was declared, so
          // reaching here means the two disagreed, and acting on it is the
          // worse answer.
          return;
      }
    },
    [explorer],
  );

  // `run` is stable, but the listener is installed once through a ref anyway —
  // the same shape `src/shell/keys/useKeyboard.ts` uses, and cheap insurance
  // against a future dependency making it unstable without anyone noticing that
  // a re-subscribe leaves a window where a command lands on nothing.
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => onCommand((command) => latest.current(command)), []);

  useEffect(() => {
    // Both need somewhere to put a file, so both wait on a root. A tree that
    // has not resolved one cannot make a file and has no Recycle Bin to show.
    declareCommands(root !== null ? [COMMAND.newFile, COMMAND.trash] : []);
  }, [root]);
}
