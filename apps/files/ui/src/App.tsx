/**
 * Files — the explorer, the tabs, and the pane the two of them fill.
 *
 * This file is the join. It owns the three-region layout and the state that
 * genuinely spans regions — where the tree is rooted, and which file is
 * showing — and nothing else. The tree is `explorer/`, the tab model is
 * `tabs/`, and what a file *looks* like is `viewer/registry.ts`. Each of those
 * can be read without reading this one.
 *
 * What it deliberately does not own: the list of file formats. Adding a viewer
 * touches `viewer/registry.ts` and one new component, and never this file. If
 * a change to Files ever needs an edit here *and* there, the seam is in the
 * wrong place.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { on } from "@helve/bridge";
import { useMotionValue } from "framer-motion";
import Explorer from "./explorer/Explorer";
import Splitter from "./Splitter";
import TabStrip from "./tabs/TabStrip";
import { useOpenFiles } from "./tabs/useOpenFiles";
import Viewer from "./viewer/Viewer";
import { describe, getRoot, type Root } from "./rpc";

/** The explorer's starting width, and the two minimums the splitter clamps to. */
const EXPLORER_DEFAULT = 260;
const EXPLORER_MIN = 180;
const VIEWER_MIN = 240;

export default function App() {
  const [root, setRoot] = useState<Root | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Bumped whenever the tree's contents may have changed underneath us: the
   * project was switched, or the user asked for a refresh. The explorer treats
   * a change as "drop the cache and re-list", which is the whole of the live
   * project-change reload — there is no filesystem watcher.
   */
  const [treeNonce, setTreeNonce] = useState(0);

  const files = useOpenFiles();

  // Written directly by the splitter's pointer handler rather than held in
  // React state, so a drag is one style write per frame instead of one render.
  // See `Splitter.tsx`; the mechanics are `src/shell/frame/Frame.tsx`'s.
  const explorerWidth = useMotionValue(EXPLORER_DEFAULT);
  const splitRef = useRef<HTMLDivElement | null>(null);

  const loadRoot = useCallback(() => {
    void getRoot()
      .then((next) => {
        setRoot(next);
        setError(null);
      })
      .catch((err: unknown) => setError(describe("files/root", err)));
  }, []);

  useEffect(loadRoot, [loadRoot]);

  /**
   * The project changed under us — a different folder is open.
   *
   * The event arrives over the same bridge every call goes out on; the shell
   * forwards it into this frame (`src/shell/toolwindow/ToolWindow.tsx`). Open
   * tabs are left alone rather than closed: a file that is still on disk is
   * still readable, and closing someone's editor because they switched
   * projects would lose work to a guess about intent.
   */
  useEffect(
    () =>
      on("project:changed", () => {
        loadRoot();
        setTreeNonce((n) => n + 1);
      }),
    [loadRoot],
  );

  /**
   * Ctrl+S at the document level, so it works with focus anywhere in the app.
   *
   * Monaco binds its own Ctrl+S inside the editor and that one wins there; this
   * catches the case where focus is in the tree or the tab strip. Both end up
   * at the same `save` the viewer registered.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "s") return;
      event.preventDefault();
      void files.saveActive().catch((err: unknown) => setError(describe("files/write", err)));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [files]);

  const active = files.tabs.find((tab) => tab.path === files.activePath) ?? null;

  return (
    <div className="files">
      {error && <p className="app__error files__error">{error}</p>}

      <div className="files__split" ref={splitRef}>
        <Explorer
          root={root}
          width={explorerWidth}
          reloadNonce={treeNonce}
          selectedPath={files.activePath}
          onRefresh={() => setTreeNonce((n) => n + 1)}
          onOpenFile={files.open}
        />

        <Splitter
          width={explorerWidth}
          containerRef={splitRef}
          minLeft={EXPLORER_MIN}
          minRight={VIEWER_MIN}
        />

        <section className="files__main">
          <TabStrip
            tabs={files.tabs}
            activePath={files.activePath}
            dirty={files.dirty}
            onActivate={files.activate}
            onClose={files.close}
          />

          {active ? (
            <Viewer
              // The nonce is in the key so an external reload remounts the
              // viewer and it re-reads from disk. The path alone would not:
              // reloading the same file is not a different file.
              key={`${active.path}:${active.nonce}`}
              file={active}
              onDirty={(dirty) => files.setDirty(active.path, dirty)}
              registerSave={(save) => files.registerSave(active.path, save)}
            />
          ) : (
            <p className="app__note files__empty">Select a file to open it.</p>
          )}
        </section>
      </div>
    </div>
  );
}
