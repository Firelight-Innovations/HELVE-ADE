/**
 * The open-file model: which tabs exist, which is showing, which are dirty, and
 * the buffers behind them.
 *
 * Two things live here that look like they belong elsewhere, and both are here
 * for the same reason — `ViewerProps` in `../viewer/registry.ts` is a fixed
 * four-prop contract and a viewer cannot be handed anything else.
 *
 * 1. `documents`, a module-scope store of one Monaco model per open path. It is
 *    *not* hook state: `TextViewer` has no route to a hook's closure, and the
 *    whole point of the store is that a model outlives the viewer that mounted
 *    it — which is what makes undo history, cursor and scroll survive a tab
 *    switch. One Files frame per window, so one store.
 *
 * 2. `saveDocument`, the single implementation of "write this buffer to disk".
 *    Both the viewer's registered save and the close-a-dirty-tab prompt go
 *    through it, so there is one place that knows about `baseMtime` and one
 *    place that can be wrong.
 *
 * **The Monaco import below is `import type` and must stay that way.** It is
 * erased before Rollup builds the graph, so this module — which `App.tsx`
 * imports at load — never pulls Monaco into the Files entry chunk. A plain
 * `import` here would undo the dynamic-`import()` discipline that
 * `../viewer/registry.ts` exists to protect. Nothing in this file *creates* a
 * model; it only holds and disposes ones `TextViewer` made.
 *
 * The numbers, so the warning is not just a warning: the Files entry chunk is
 * 175 kB and contains no Monaco at all (`grep -c monaco dist/assets/files-*.js`
 * returns 0). Monaco is 3.86 MB, in a chunk fetched only when a text file is
 * first opened. Dropping the word `type` from line 35 moves that 3.86 MB into
 * the 175 kB — a twenty-fold entry chunk, paid on every Files launch including
 * the ones that only ever look at a PNG. Nothing would fail; `tsc` and the
 * build would both stay green. That is exactly why it is written down here.
 *
 * What this deliberately does not do: watch the filesystem. There is no
 * watcher, so external changes are noticed by `stat`-ing the open files on tab
 * activate and on the window regaining focus. That is a poll and it has a
 * window — the `baseMtime` guard on `files/write` is the backstop that catches
 * what the poll misses, and it catches it at the only moment that matters.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenFile } from "../viewer/registry";
import type { TextModel, EditorViewState } from "../viewer/monaco";
import { baseName, extensionOf, stat, write } from "../rpc";

/** One button in a `TabNotice`. */
export interface TabAction {
  label: string;
  run(): void;
}

/**
 * A question the tab strip must put to the user before something irreversible
 * happens, or a report it must make about a tab going stale under them.
 *
 * It rides on the tab rather than arriving as a prop because `App.tsx` hands
 * `TabStrip` exactly five props and this parcel does not own that file. The
 * actions travel with the notice for the same reason. If a sixth prop ever
 * appears, this becomes a plain data type and the callbacks move out.
 *
 * Left-most action is the safe one. Nothing here uses `window.confirm`: a modal
 * that blocks the event loop inside an iframe is a worse answer than a bar the
 * user can ignore.
 */
export interface TabNotice {
  tone: "warn" | "err";
  message: string;
  actions: TabAction[];
}

export interface OpenTab extends OpenFile {
  /** Bumped to force the viewer to remount and re-read — an external reload. */
  nonce: number;
  /**
   * The file is gone from disk. The tab stays open regardless: its buffer may
   * be the only copy left, and closing it would be this app deleting someone's
   * work because something else deleted a file.
   */
  missing: boolean;
  notice: TabNotice | null;
}

/** The buffer behind one open tab, plus everything needed to save it. */
export interface TabDocument {
  model: TextModel;
  /**
   * `model.getAlternativeVersionId()` as of the last read or write. Dirty is
   * any difference — which, unlike a boolean flag, goes back to *clean* when
   * the user undoes their way to the saved text.
   */
  savedVersionId: number;
  /** The mtime of the read (or write) this text is based on. See `files/write`. */
  baseMtime: number | null;
  /**
   * The backend's byte cap, when the read came back truncated; `null` when the
   * whole file is here. One field rather than a boolean and a number, because
   * the banner needs the limit and the save guard needs the boolean, and two
   * fields could disagree.
   */
  truncatedAt: number | null;
  /** Cursor and scroll, saved on unmount so a tab switch comes back in place. */
  viewState: EditorViewState | null;
}

/** How the store reports back to the tab list that owns it. */
export interface DocumentHost {
  /** Drop this tab's buffer and remount its viewer, so it reads disk again. */
  reload(path: string): void;
  /** A write landed, and this is the mtime the file now has. */
  saved(path: string, mtime: number | null): void;
}

class DocumentStore {
  private readonly byPath = new Map<string, TabDocument>();

  /** Set by the mounted `useOpenFiles`. `null` between frames. */
  host: DocumentHost | null = null;

  get(path: string): TabDocument | undefined {
    return this.byPath.get(path);
  }

  put(path: string, doc: TabDocument): void {
    this.discard(path);
    this.byPath.set(path, doc);
  }

  /**
   * Forget a buffer and dispose its model.
   *
   * Monaco models are not garbage: each one is registered with the model
   * service under its URI and holds its own tokenizer state and undo stack, so
   * one that is dropped without `dispose()` leaks for the life of the frame and
   * makes the next `createModel` at the same path throw. `DiffView.tsx`'s
   * closing comment documents the same trap from the other end.
   */
  discard(path: string): void {
    const doc = this.byPath.get(path);
    if (!doc) return;
    this.byPath.delete(path);
    doc.model.dispose();
  }

  /**
   * Whether this buffer differs from what is on disk, asked of the model
   * itself rather than of React state.
   *
   * Used by `close`, which must be right *now* — the dirty `Set` is a render
   * input that lags a keystroke by a commit, and closing a tab on a stale
   * answer would discard the last thing typed.
   */
  isDirty(path: string): boolean {
    const doc = this.byPath.get(path);
    return doc !== undefined && doc.model.getAlternativeVersionId() !== doc.savedVersionId;
  }
}

export const documents = new DocumentStore();

/** Saves in flight, keyed by path. See `saveDocument`. */
const saving = new Map<string, Promise<void>>();

/**
 * Write one open buffer to disk. The only place that calls `files/write`.
 *
 * Rejects on every failure, including a stale-write conflict — callers decide
 * what to draw. `TextViewer` turns a stale rejection into its own banner;
 * `close` turns it into a notice and leaves the tab open. Neither may swallow
 * it, because a save that silently did nothing is how edits disappear.
 *
 * Concurrent calls for one path share a promise rather than racing. Monaco's
 * Ctrl+S and the document-level one in `App.tsx` can both fire for a single
 * keypress, and two writes with the same `baseMtime` would make the second one
 * fail as stale against the first — a conflict the app invented itself.
 */
export function saveDocument(path: string): Promise<void> {
  const running = saving.get(path);
  if (running) return running;

  const attempt = writeDocument(path).finally(() => saving.delete(path));
  saving.set(path, attempt);
  return attempt;
}

async function writeDocument(path: string): Promise<void> {
  const doc = documents.get(path);
  // Nothing open at this path is not a failure: `saveActive` may be called with
  // a read-only viewer showing, or with no tab at all.
  if (!doc) return;

  if (doc.truncatedAt !== null) {
    throw new Error("This file is only partly loaded — saving it would delete the rest.");
  }

  const text = doc.model.getValue();
  // Read the version *before* awaiting. Anything typed while the write is in
  // flight belongs to a later version, and must leave the tab dirty rather than
  // be marked saved by a write that did not contain it.
  const version = doc.model.getAlternativeVersionId();

  const result = await write(path, text, doc.baseMtime);

  doc.savedVersionId = version;
  doc.baseMtime = result.mtime;
  documents.host?.saved(path, result.mtime);
}

/**
 * Ask the tab list to reload one file from disk, discarding its buffer.
 *
 * The route a viewer takes to the nonce bump it cannot reach itself. A no-op
 * when no frame is mounted, which is the right answer: there is no tab to
 * remount.
 */
export function requestReload(path: string): void {
  documents.host?.reload(path);
}

/** Everything `App.tsx` needs from the tab model, and nothing more. */
export interface OpenFiles {
  tabs: OpenTab[];
  activePath: string | null;
  dirty: ReadonlySet<string>;
  open(path: string): void;
  activate(path: string): void;
  close(path: string): void;
  setDirty(path: string, dirty: boolean): void;
  registerSave(path: string, save: (() => Promise<void>) | null): void;
  saveActive(): Promise<void>;
}

export function useOpenFiles(): OpenFiles {
  /**
   * Three pieces of state, each mirrored into a ref that is written first.
   *
   * The ref is the value; the state is the render mirror. Callbacks read the
   * ref, so none of them needs the state in a dependency array and none of them
   * changes identity — which matters because `App.tsx` passes them straight
   * into effects. It also keeps every update out of a `setState` updater
   * function, so nothing here misbehaves under StrictMode's double invoke.
   */
  const tabsRef = useRef<OpenTab[]>([]);
  const [tabs, setTabsState] = useState<OpenTab[]>(tabsRef.current);

  const activeRef = useRef<string | null>(null);
  const [activePath, setActiveState] = useState<string | null>(null);

  const dirtyRef = useRef<ReadonlySet<string>>(new Set<string>());
  const [dirty, setDirtyState] = useState<ReadonlySet<string>>(dirtyRef.current);

  /** Saves registered by whichever viewers are currently mounted. */
  const saves = useRef(new Map<string, () => Promise<void>>());

  const writeTabs = useCallback((next: OpenTab[]) => {
    tabsRef.current = next;
    setTabsState(next);
  }, []);

  const writeActive = useCallback((next: string | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  const writeDirty = useCallback((path: string, isDirty: boolean) => {
    if (dirtyRef.current.has(path) === isDirty) return;
    const next = new Set(dirtyRef.current);
    if (isDirty) next.add(path);
    else next.delete(path);
    dirtyRef.current = next;
    setDirtyState(next);
  }, []);

  const patch = useCallback(
    (path: string, change: Partial<OpenTab>) => {
      if (!tabsRef.current.some((tab) => tab.path === path)) return;
      writeTabs(tabsRef.current.map((tab) => (tab.path === path ? { ...tab, ...change } : tab)));
    },
    [writeTabs],
  );

  /** Refresh a tab's disk facts. Silent on failure — see `open`. */
  const restat = useCallback(
    (path: string) => {
      void stat(path)
        .then((entry) =>
          patch(path, {
            name: entry.name,
            ext: extensionOf(entry.name),
            size: entry.size,
            mtime: entry.mtime,
            missing: !entry.exists,
          }),
        )
        .catch(() => {
          /* A stat that failed says nothing about the file, only about the
             call. The viewer's own read is what reports a real problem. */
        });
    },
    [patch],
  );

  /**
   * Close a tab and let go of everything behind it.
   *
   * Unconditional — `close` decides whether it is allowed. Activation moves to
   * the tab on the right, or the left when there is none, which is what every
   * editor does and what keeps a run of closes from jumping around.
   */
  const drop = useCallback(
    (path: string) => {
      const index = tabsRef.current.findIndex((tab) => tab.path === path);
      if (index === -1) return;

      documents.discard(path);
      saves.current.delete(path);
      writeDirty(path, false);

      const next = tabsRef.current.filter((tab) => tab.path !== path);
      writeTabs(next);

      if (activeRef.current === path) {
        writeActive(next[index]?.path ?? next[index - 1]?.path ?? null);
      }
    },
    [writeTabs, writeActive, writeDirty],
  );

  /**
   * Throw away this tab's buffer and make its viewer read disk again.
   *
   * The nonce is what does it: `App.tsx` keys the viewer on `path:nonce`, so a
   * bump remounts it. Discarding the document first is what makes the remount
   * re-read rather than find the old buffer still in the store — and it is also
   * why a reload loses undo history, which is correct: the text it applied to
   * is gone.
   */
  const reload = useCallback(
    (path: string) => {
      const tab = tabsRef.current.find((entry) => entry.path === path);
      if (!tab) return;

      documents.discard(path);
      writeDirty(path, false);
      patch(path, { nonce: tab.nonce + 1, notice: null });
      restat(path);
    },
    [patch, restat, writeDirty],
  );

  /** Ask before losing edits. Save first — the safe answer goes on the left. */
  const askBeforeClosing = useCallback(
    (path: string, name: string) => {
      const notice: TabNotice = {
        tone: "warn",
        message: `${name} has unsaved changes.`,
        actions: [
          {
            label: "Save",
            run: () => {
              patch(path, { notice: null });
              void saveDocument(path)
                .then(() => drop(path))
                .catch((err: unknown) => {
                  // The tab stays open. A close that lost the save *and* the
                  // buffer is the one outcome this whole prompt exists to
                  // prevent, so a failed save can only ever end here.
                  patch(path, {
                    notice: {
                      tone: "err",
                      message: `Could not save ${name}: ${err instanceof Error ? err.message : String(err)}`,
                      actions: [
                        { label: "Keep editing", run: () => patch(path, { notice: null }) },
                        { label: "Discard changes", run: () => drop(path) },
                      ],
                    },
                  });
                });
            },
          },
          { label: "Discard", run: () => drop(path) },
          { label: "Cancel", run: () => patch(path, { notice: null }) },
        ],
      };
      patch(path, { notice });
    },
    [drop, patch],
  );

  /**
   * `stat` every open file and react to what moved.
   *
   * Runs on activate and when the window comes back — see the header on why
   * there is no watcher. A tab already showing a notice is skipped: it is
   * already asking the user a question, and re-asking it every poll would
   * replace the notice object under their cursor.
   */
  const poll = useCallback(() => {
    for (const tab of tabsRef.current) {
      if (tab.notice) continue;

      const path = tab.path;
      const knownMtime = tab.mtime;

      void stat(path)
        .then((entry) => {
          if (!entry.exists) {
            patch(path, { missing: true });
            return;
          }
          if (tab.missing) patch(path, { missing: false });

          // A filesystem that cannot report times can't be polled; the
          // `baseMtime` guard on write is the whole defence there, and it
          // treats a null base as "write anyway" by design.
          if (entry.mtime === null || knownMtime === null || entry.mtime === knownMtime) return;

          if (!documents.isDirty(path) && !dirtyRef.current.has(path)) {
            reload(path);
            return;
          }

          const observed = entry.mtime;
          patch(path, {
            notice: {
              tone: "warn",
              message: `${tab.name} changed on disk, and you have unsaved changes.`,
              actions: [
                { label: "Keep mine", run: () => patch(path, { mtime: observed, notice: null }) },
                { label: "Reload from disk", run: () => reload(path) },
              ],
            },
          });
        })
        .catch(() => {
          /* Same as `restat`: a failed poll is not evidence about the file. */
        });
    }
  }, [patch, reload]);

  /**
   * Open a file, or bring its tab forward if it is already open.
   *
   * The tab appears at once and its disk facts are filled in when the `stat`
   * lands, rather than the other way round — a click that does nothing for a
   * round trip reads as a click that missed. Everything downstream tolerates
   * the gap: the viewer takes its `baseMtime` from its own read, not from here,
   * and the poll skips a tab whose mtime is still null.
   */
  const open = useCallback(
    (path: string) => {
      writeActive(path);

      if (!tabsRef.current.some((tab) => tab.path === path)) {
        const name = baseName(path);
        writeTabs([
          ...tabsRef.current,
          { path, name, ext: extensionOf(name), size: null, mtime: null, nonce: 0, missing: false, notice: null },
        ]);
      }

      restat(path);
    },
    [restat, writeActive, writeTabs],
  );

  const activate = useCallback(
    (path: string) => {
      writeActive(path);
      poll();
    },
    [poll, writeActive],
  );

  const close = useCallback(
    (path: string) => {
      const tab = tabsRef.current.find((entry) => entry.path === path);
      if (!tab) return;

      if (documents.isDirty(path) || dirtyRef.current.has(path)) {
        askBeforeClosing(path, tab.name);
        return;
      }
      drop(path);
    },
    [askBeforeClosing, drop],
  );

  const setDirty = useCallback(
    (path: string, isDirty: boolean) => writeDirty(path, isDirty),
    [writeDirty],
  );

  const registerSave = useCallback((path: string, save: (() => Promise<void>) | null) => {
    if (save) saves.current.set(path, save);
    else saves.current.delete(path);
  }, []);

  /**
   * Save whatever is showing, if it can be saved.
   *
   * Resolves rather than rejecting when there is nothing to save — no tab, or a
   * read-only viewer that never registered anything. Ctrl+S over an image is
   * not an error.
   */
  const saveActive = useCallback(async () => {
    const path = activeRef.current;
    if (!path) return;
    const save = saves.current.get(path);
    if (!save) return;
    await save();
  }, []);

  // The store's way back to the tab list. Re-installed rather than merged, so
  // a remounted frame replaces a stale closure instead of racing one.
  useEffect(() => {
    documents.host = {
      reload,
      saved: (path, mtime) => {
        writeDirty(path, false);
        patch(path, { mtime, notice: null });
      },
    };
    return () => {
      documents.host = null;
    };
  }, [patch, reload, writeDirty]);

  /**
   * Notice external changes when the user comes back.
   *
   * Both events, because this app runs in an iframe and neither is sufficient
   * alone: `focus` fires when focus re-enters *this* frame, which misses an
   * alt-tab away and back if focus was elsewhere in the shell, and
   * `visibilitychange` mirrors the top-level document, which misses a move
   * between two visible windows.
   */
  useEffect(() => {
    const onFocus = () => poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  return { tabs, activePath, dirty, open, activate, close, setDirty, registerSave, saveActive };
}
