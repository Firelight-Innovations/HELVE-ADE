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
import { on, reportPainted } from "@helve/bridge";
import { useMotionValue } from "framer-motion";
import Explorer, { type ExplorerHandle } from "./explorer/Explorer";
import NoticeBar from "./NoticeBar";
import { useMenuCommands } from "./commands";
import { useDelete } from "./useDelete";
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
   * The splash window waits for this pane before the main window is shown —
   * see `reportPainted` in `@helve/bridge`, and `boot::await_apps` for what is
   * waiting and for how long.
   *
   * "First meaningful frame" here is *the tree having rows*, not the layout
   * having appeared, which is why the explorer reports it rather than this
   * effect: `files/root` coming back leaves a pane with an empty tree in it,
   * and a window revealed at that moment would still visibly fill in. The one
   * case the explorer cannot report is the root call itself failing, since it
   * never gets a root to list — that is this effect, and it counts, because an
   * error is a finished screen too.
   */
  useEffect(() => {
    if (error !== null) reportPainted();
  }, [error]);

  /**
   * The project changed under us — a different folder is open.
   *
   * The event arrives over the same bridge every call goes out on; the shell
   * forwards it into this frame (`src/shell/toolwindow/ToolWindow.tsx`). Open
   * tabs are left alone rather than closed: a file that is still on disk is
   * still readable, and closing someone's editor because they switched
   * projects would lose work to a guess about intent.
   *
   * "The project" means **this surface's cluster's** project. A project belongs
   * to a cluster, and the shell relays this event only into frames in the
   * cluster it names — so a switch in the Files on the next monitor does not
   * reach here. Nothing in this file has to know that: `files/root` below is
   * answered against whichever cluster this frame is in, resolved by the shell
   * from the frame itself rather than from anything sent in the call.
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

  /**
   * The delete confirmation, owned here rather than by either region.
   *
   * Both the tree and the tab strip can start a delete, and only one question
   * should ever be on screen — two bars asking about two files would be a
   * choice about which one Escape answers. This file is also the only place
   * that can see both the tree and the open buffers, which is what the
   * confirmation has to weigh: what is on disk, and what is unsaved.
   */
  const del = useDelete({
    unsavedUnder: files.unsavedUnder,
    dropUnder: files.dropUnder,
    // The tree is re-read wholesale. A delete is rare, and unlike a create it
    // can remove a whole subtree — so there is no single directory to re-list
    // and no cheaper honest answer.
    onDeleted: () => setTreeNonce((n) => n + 1),
  });

  /**
   * The title bar's File and Edit menus, answered from here.
   *
   * Here rather than in a region, for the same reason the delete confirmation
   * is: a menu command can be about the tree, the tabs, or the editor, and this
   * is the only file that can see all three. It is also the only one that can
   * declare honestly what is possible — Save needs the buffer's dirty state,
   * Delete needs a tab, New File needs a root.
   *
   * Every command routes into the code the equivalent gesture already uses, so
   * a menu-bar Delete raises the same confirmation the right-click one does.
   * See `commands.ts`.
   */
  const explorerRef = useRef<ExplorerHandle | null>(null);
  useMenuCommands({
    root,
    files,
    explorer: explorerRef,
    askDelete: del.ask,
    onTreeChanged: () => setTreeNonce((n) => n + 1),
    onError: setError,
  });

  const active = files.tabs.find((tab) => tab.path === files.activePath) ?? null;

  return (
    <div className="files">
      {error && <p className="app__error files__error">{error}</p>}

      <div className="files__split" ref={splitRef}>
        <Explorer
          ref={explorerRef}
          root={root}
          width={explorerWidth}
          reloadNonce={treeNonce}
          selectedPath={files.activePath}
          onFirstListing={reportPainted}
          onRefresh={() => setTreeNonce((n) => n + 1)}
          onOpenFile={files.open}
          // The tree has already re-listed the folder it renamed in, so this
          // only has to move the tabs. Bumping `treeNonce` here as well would
          // drop the whole cache to show a change one directory already knows
          // about.
          onRenamed={files.rename}
          onDelete={del.ask}
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
            rootPath={root?.path ?? null}
            onActivate={files.activate}
            onClose={files.close}
            // Unlike the tree's, a rename started from a tab has no idea which
            // folder it happened in — so the tree is told to re-read whatever
            // it has open. Heavier than the tree's own `relist` of one
            // directory, and the right trade for a path this app takes rarely:
            // the alternative is teaching this file to work out a parent
            // directory, which is the one thing the frontend must not do.
            onRenamed={(from, to) => {
              files.rename(from, to);
              setTreeNonce((n) => n + 1);
            }}
            onDelete={del.ask}
          />

          {/* The delete confirmation, under the strip where every other
              question in this app appears. Escape answers it the same way
              Cancel does — see `NoticeBar`. */}
          {del.notice && <NoticeBar notice={del.notice} onEscape={del.cancel} />}

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
