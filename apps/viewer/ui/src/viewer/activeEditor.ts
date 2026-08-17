/**
 * Which Monaco editor is mounted right now, for the code that cannot reach it.
 *
 * The seam between the Edit menu, handled in `App.tsx`, and the live editor
 * only `TextViewer` holds. **The Monaco import below is `import type` and must
 * stay that way** — a plain `import` would drag Monaco's 3.86 MB into the
 * Files entry chunk. Why this is module scope, and why at most one editor ever
 * exists: `docs/design-notes/viewer-renderers.md`.
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
 * The mounted editor, or `null` when no text file is showing. Stable by
 * reference between changes, which is what makes it a legal
 * `useSyncExternalStore` snapshot — returning a fresh wrapper each call would
 * put React into an infinite re-render.
 */
export function activeEditor(): CodeEditor | null {
  return current;
}

/**
 * Watch for an editor arriving or leaving. With `activeEditor` above, a
 * `useSyncExternalStore` source: the mount is *asynchronous*, so nothing React
 * already re-renders on marks the moment the Edit menu becomes usable. See
 * `docs/design-notes/viewer-renderers.md`.
 */
export function subscribeActiveEditor(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
