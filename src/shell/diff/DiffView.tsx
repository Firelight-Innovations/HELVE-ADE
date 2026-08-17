/**
 * A read-only diff, rendered with Monaco's `DiffEditor` — two columns by
 * default, one interleaved column when `renderSideBySide` is false.
 *
 * Mounted by the source-control panel (`worktree/SourceControlView.tsx`),
 * which imports it lazily: this module pulls in Monaco and its worker chunk on
 * evaluation, and the panel is mounted for the life of the window whether or
 * not anyone opens a diff. The `lazy` boundary there keeps that cost on the
 * first click rather than on startup.
 *
 * Why the import below is `editor.api` and not `.../editor.main`, why `"toml"`
 * is consequently the only language this editor tokenizes and why that is the
 * shape of the fix rather than an oversight, and how chunks are shared with the
 * Files app's Monaco: docs/design-notes/shell-worktree.md, under this path.
 */
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { registerToml } from "@helve/monaco-languages";
import "./diff.css";

// One worker, wired here rather than in a global entry file — this module and
// its worker chunk are evaluated only once something imports `DiffView`, so
// nothing pays for Monaco until the diff view is used. `ts` / `json` / `css` /
// `html` workers are deliberately not wired: this is a read-only diff, not a
// language service, and each is its own multi-hundred-KB chunk on top of this.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// TOML, the only language this editor can tokenize — see the file header for
// why it is the only one and why that is deliberate rather than partial.
//
// Idempotent: `search/previewMonaco.ts` calls this too and is shell-side like
// this module, so both chunks can be live in one JS context and would
// otherwise register the same id twice against one global registry. The guard
// lives in `@helve/monaco-languages` so neither caller has to remember.
registerToml(monaco);

// Defined once at module scope, not per-mount — `defineTheme` writes into
// Monaco's global theme registry, so redefining it on every DiffView mount
// would be repeated work for no visual change.
//
// Every colour below is lifted from src/tokens.css, and the four diff colours
// must be 8-digit hex, never `rgba(...)`: Monaco parses a theme colour with
// `parseHex(hex) || Color.red`, so a perfectly valid CSS `rgba()` string
// silently becomes opaque red. Which token each reuses, and how that bug went
// unseen, are in the design note named in the file header.
monaco.editor.defineTheme("helve-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#14161a", // --bg
    "editor.foreground": "#e4e7ec", // --text
    "diffEditor.insertedLineBackground": "#5fb37a14", // --ok, wash alpha
    "diffEditor.insertedTextBackground": "#5fb37a40", // --ok
    "diffEditor.removedLineBackground": "#d9635f14", // --err, wash alpha
    "diffEditor.removedTextBackground": "#d9635f40", // --err
  },
});

export interface DiffViewProps {
  original: string;
  modified: string;
  /** Passed straight to Monaco's model, but only `"toml"` actually tokenizes
   *  here; everything else renders as plain text until someone decides this
   *  editor should carry Monaco's bundled grammars. `@helve/monaco-languages`'s
   *  `isTomlPath` is how a caller with a path and no Monaco import decides. */
  language?: string;
  /** Two columns, or one with removals and additions interleaved. Defaults to
   *  two because that is what a diff opened in the tool window wants. The
   *  source-control panel passes `false`: it is `--w-panel-default` (380px)
   *  wide, and two columns of code in half of that wraps every meaningful line
   *  — the same reason VS Code's SCM view flips to inline when docked narrow. */
  renderSideBySide?: boolean;
}

export default function DiffView({
  original,
  modified,
  language,
  renderSideBySide = true,
}: DiffViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Re-created whenever the text changes rather than fed through `setValue` —
  // a diff view has no caret or selection worth preserving across an
  // `original`/`modified` swap, so an in-place update buys nothing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const diffEditor = monaco.editor.createDiffEditor(container, {
      theme: "helve-dark",
      readOnly: true,
      automaticLayout: true,
      renderSideBySide,
      minimap: { enabled: false },
    });

    diffEditor.setModel({
      original: monaco.editor.createModel(original, language),
      modified: monaco.editor.createModel(modified, language),
    });

    // Disposing the diff editor does not dispose the two models it was handed
    // — Monaco assumes a model may be shared or reused elsewhere. These were
    // created fresh above for this instance alone, so they are ours to dispose
    // too, or they leak on every unmount.
    //
    // Order matters, and not subtly: the widget listens for its own models
    // being disposed, and disposing one while it is still attached throws
    // "TextModel got disposed before DiffEditorWidget model got reset" out of
    // an event handler on every close. Detaching first makes the disposals
    // below unobserved, which is what lets them be ours to make.
    return () => {
      const model = diffEditor.getModel();
      diffEditor.setModel(null);
      model?.original.dispose();
      model?.modified.dispose();
      diffEditor.dispose();
    };
  }, [original, modified, language, renderSideBySide]);

  return <div ref={containerRef} className="diff" />;
}
