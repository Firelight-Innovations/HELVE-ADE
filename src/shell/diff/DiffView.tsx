/**
 * A read-only diff, rendered with Monaco's `DiffEditor` — two columns by
 * default, one interleaved column when `renderSideBySide` is false.
 *
 * Mounted by the source-control panel (`worktree/SourceControlView.tsx`),
 * which imports it lazily: this module pulls in Monaco and its worker chunk on
 * evaluation, and the panel is mounted for the life of the window whether or
 * not anyone opens a diff. The `lazy` boundary there is what keeps that cost
 * on the first click rather than on startup.
 *
 * Files (`apps/files`) also uses Monaco, wired separately in
 * `apps/files/ui/src/viewer/monaco.ts`. The two do not collide: an app runs in
 * its own iframe, so each has its own `self.MonacoEnvironment` and its own
 * theme registry. They do share chunks — both entries reach the same
 * `monaco-editor` modules, so Rollup hoists them into one shared dynamic
 * chunk. That is fine and deliberate: it is dynamic on both sides, so
 * `index.html` preloads none of it.
 *
 * Imported from `monaco-editor/editor/editor.api`, not `.../editor.main` —
 * `editor.main` registers every bundled language, and the IntelliSense
 * infrastructure behind them, as a side effect of import. None of that is
 * needed to show a read-only diff. The cost of that choice: with only
 * `editor.api` pulled in, Monaco has no tokenizer for any language, so
 * `language` below does not yet produce syntax highlighting. It is still
 * accepted as a prop so a caller doesn't have to change when highlighting is
 * wired in later.
 *
 * (The short specifier is not a shorthand for the long one: monaco-editor
 * 0.56's `exports` map is `"./*": "./esm/vs/*.js"`, so
 * `monaco-editor/esm/vs/editor/editor.api` would resolve to
 * `esm/vs/esm/vs/editor/editor.api.js` and fail. The code below has always been
 * right; this comment used to name a path that does not exist.)
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
//
// The four diff colours are 8-digit hex rather than `rgba(...)`, and that is
// not a style preference. Monaco parses a theme colour with `Color.fromHex`,
// which is `parseHex(hex) || Color.red` (base/common/color.js:182), and
// `parseHex` accepts only `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`. A
// perfectly valid CSS `rgba()` string is not rejected loudly — it silently
// becomes **opaque red**. These four were written that way and did render red;
// nothing mounts this component, so nobody had seen it. The alpha byte is
// round(alpha * 255): 0.08 is 0x14, 0.25 is 0x40.
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
  /** Passed straight to Monaco's model. See the file header: with only
   *  `editor.api` imported, this does not yet produce highlighting — it is
   *  accepted now so callers don't have to change when it does. */
  language?: string;
  /**
   * Two columns, or one with the removals and additions interleaved.
   *
   * Defaults to two because that is what a diff opened in the tool window
   * wants. The source-control panel passes `false`: it is
   * `--w-panel-default` (380px) wide, and two columns of code in half of that
   * wraps every meaningful line — the same reason VS Code's own SCM view
   * flips to inline when it is docked narrow.
   */
  renderSideBySide?: boolean;
}

export default function DiffView({ original, modified, language, renderSideBySide = true }: DiffViewProps) {
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
      renderSideBySide,
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
