/**
 * Which Monaco editor is mounted right now, for the code that cannot reach it.
 *
 * The Edit menu's items — Undo, Cut, Find — are the app's answer to a message
 * that arrives from the shell, not to anything inside the viewer's tree. So the
 * command handler in `App.tsx` needs the live editor, and `TextViewer` is the
 * only thing that has one. This is the seam between them, and it is the same
 * shape as `documents` in `../tabs/useOpenFiles`: module scope, one Files frame
 * per window, so one registry.
 *
 * **The Monaco import below is `import type` and must stay that way.** This
 * module is reachable from `App.tsx` at load, and a plain `import` here would
 * drag Monaco's 3.86 MB into the Files entry chunk — undoing the dynamic-import
 * discipline `./registry.ts` exists to protect. See the far longer version of
 * this warning at the top of `../tabs/useOpenFiles.ts`, which holds a model for
 * the same reason and under the same rule. Nothing in this file *creates*
 * anything; it holds a reference to what `TextViewer` made.
 *
 * At most one editor exists at a time: switching tabs unmounts the viewer and
 * mounts a new one, and the unmount clears this. `set(null)` is guarded on
 * identity so a late unmount cannot clear an editor that has already replaced
 * it — React commits the new mount's effect before the old one's cleanup in
 * some orderings, and clearing on the wrong one would leave the Edit menu
 * pointed at nothing while a file was plainly on screen.
 */
import type { CodeEditor } from "./monaco";

let current: CodeEditor | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  listeners.forEach((cb) => cb());
}

export function setActiveEditor(editor: CodeEditor | null): void {
  if (current === editor) return;
  current = editor;
  announce();
}

/** Forget `editor`, but only if it is still the one registered. */
export function clearActiveEditor(editor: CodeEditor): void {
  if (current !== editor) return;
  current = null;
  announce();
}

/**
 * The mounted editor, or `null` when no text file is showing.
 *
 * Stable by reference between changes, which is what makes it a legal
 * `useSyncExternalStore` snapshot — returning a fresh wrapper each call would
 * put React into an infinite re-render.
 */
export function activeEditor(): CodeEditor | null {
  return current;
}

/**
 * Watch for an editor arriving or leaving.
 *
 * `App.tsx` needs this because the mount is *asynchronous*: opening a file
 * renders a tab immediately and only creates the editor once `files/read` comes
 * back, so nothing React already re-renders on marks the moment the Edit menu
 * becomes usable. Paired with `activeEditor` above, this is a
 * `useSyncExternalStore` source.
 */
export function subscribeActiveEditor(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
