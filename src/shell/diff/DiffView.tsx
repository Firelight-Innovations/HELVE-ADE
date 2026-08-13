/**
 * A read-only side-by-side diff, rendered with Monaco's `DiffEditor`.
 *
 * Not mounted anywhere yet — nothing in the shell imports this file. It exists
 * so the git-diff feature (built separately, later) has a component to drop
 * in, and so `pnpm build` proves the worker wiring and the trimmed import
 * actually work before that feature lands.
 *
 * Imported from `monaco-editor/esm/vs/editor/editor.api`, not `.../editor.main`
 * — `editor.main` registers every bundled language, and the IntelliSense
 * infrastructure behind them, as a side effect of import. None of that is
 * needed to show a read-only diff. The cost of that choice: with only
 * `editor.api` pulled in, Monaco has no tokenizer for any language, so
 * `language` below does not yet produce syntax highlighting. It is still
 * accepted as a prop so a caller doesn't have to change when highlighting is
 * wired in later.
 */
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "./diff.css";

// One worker, wired here rather than in a global entry file — this module
// (and the worker chunk it pulls in) is only evaluated once something
// actually imports `DiffView`, so nothing pays for Monaco until the diff view
// is used. `ts.worker` / `json.worker` / `css.worker` / `html.worker` are
// deliberately not wired: this is a read-only diff, not a language service,
// and each of those workers is its own multi-hundred-KB chunk on top of this
// one.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Defined once at module scope, not per-mount — `defineTheme` writes into
// Monaco's global theme registry, so redefining it on every DiffView mount
// would be repeated work for no visual change.
//
// Colours are lifted from src/tokens.css, not chosen here. `editor.background`
// and `editor.foreground` reuse --bg and --text directly. The diff
// insert/remove backgrounds reuse --ok and --err — the same pair
// `CHANGE_TOKEN` in contract.ts already uses for added ("A") and deleted
// ("D") files — at two alphas: a low "wash" alpha for the full-line
// background, matching the --accent-wash convention already in tokens.css,
// and a stronger alpha for the character-level highlight within a changed
// line.
monaco.editor.defineTheme("helve-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#14161a", // --bg
    "editor.foreground": "#e4e7ec", // --text
    "diffEditor.insertedLineBackground": "rgba(95, 179, 122, 0.08)", // --ok, wash alpha
    "diffEditor.insertedTextBackground": "rgba(95, 179, 122, 0.25)", // --ok
    "diffEditor.removedLineBackground": "rgba(217, 99, 95, 0.08)", // --err, wash alpha
    "diffEditor.removedTextBackground": "rgba(217, 99, 95, 0.25)", // --err
  },
});

export interface DiffViewProps {
  original: string;
  modified: string;
  /** Passed straight to Monaco's model. See the file header: with only
   *  `editor.api` imported, this does not yet produce highlighting — it is
   *  accepted now so callers don't have to change when it does. */
  language?: string;
}

export default function DiffView({ original, modified, language }: DiffViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Re-created whenever the text changes rather than fed through
  // `setValue` — a diff view has no caret or selection worth preserving
  // across an `original`/`modified` swap, so there's nothing an in-place
  // update would buy over just building a fresh pair of models.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const diffEditor = monaco.editor.createDiffEditor(container, {
      theme: "helve-dark",
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
    });

    diffEditor.setModel({
      original: monaco.editor.createModel(original, language),
      modified: monaco.editor.createModel(modified, language),
    });

    // Disposing the diff editor does not dispose the two models it was
    // handed — Monaco assumes a model may be shared or reused elsewhere.
    // These were created fresh above for this instance alone, so they are
    // ours to dispose too, or they leak on every unmount.
    return () => {
      const model = diffEditor.getModel();
      model?.original.dispose();
      model?.modified.dispose();
      diffEditor.dispose();
    };
  }, [original, modified, language]);

  return <div ref={containerRef} className="diff" />;
}
