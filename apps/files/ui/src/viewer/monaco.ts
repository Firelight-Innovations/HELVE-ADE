/**
 * The only module in this app that touches `monaco-editor`.
 *
 * Everything Monaco-shaped is here — the worker environment, the feature
 * contributions, the language registrations, the theme, and the two factory
 * functions a component needs — so that `TextViewer.tsx` reads as a React
 * component and nothing else in `apps/files/` imports Monaco at all. The one
 * exception is a *type-only* import in `tabs/useOpenFiles.ts`, which `import
 * type` erases before Rollup ever sees it; see the note there.
 *
 * That matters beyond tidiness. `apps/` is not a pnpm workspace member, so
 * Monaco sits in the repository root's dependencies with nothing scoping it to
 * this app. The only thing keeping it out of the Files entry chunk — and out of
 * the shell's — is that the sole runtime path to this file is the dynamic
 * `import()` behind the `text` viewer in `registry.ts`. **Nothing may import
 * this module statically from anything reachable at load.**
 *
 * What this deliberately does not do:
 *
 * - No `editor.main`. That barrel registers every bundled language *and* the
 *   full TypeScript/CSS/HTML/JSON IntelliSense infrastructure as an import side
 *   effect — four more worker chunks and every Monarch grammar Monaco ships,
 *   for an editor that needs a dozen of them.
 * - No `languages/features/typescript`. TypeScript and JavaScript get the
 *   Monarch tokenizer from `languages/definitions/` — colour, brackets,
 *   comments — but no IntelliSense, because `ts.worker` is the single largest
 *   chunk Monaco can produce and this is a file editor, not an IDE. Same
 *   reasoning for `languages/features/css` and `.../html`, whose definitions
 *   entries also give tokenization without a language service. JSON is the one
 *   exception, argued for below.
 * - No diff editor wiring. `src/shell/diff/DiffView.tsx` has its own; see the
 *   theme note below for what happens when that one moves in here.
 */
import * as monaco from "monaco-editor/editor/editor.api";

/**
 * Every editor contribution Monaco ships.
 *
 * `editor.api` on its own is bare API. An editable pane built from it alone has
 * no find/replace, no context menu, no folding, no bracket matching, no
 * multi-cursor, no comment toggle, no clipboard actions and no Alt+↑/↓ — none
 * of which are optional in a text editor.
 *
 * The whole barrel, and that is a *measured* decision rather than the lazy one.
 * DO NOT REDO THIS EXPERIMENT; here is what it found (monaco-editor 0.56, Vite
 * 7, `pnpm build`, chunk sizes as Vite reports them):
 *
 *   chunk               register.all      curated        delta
 *   TextViewer.js         3,859.44 kB   3,440.32 kB    -419.12 kB
 *   jsonMode.js              54.16 kB     478.73 kB    +424.57 kB
 *   TOTAL minified        3,913.60 kB   3,919.05 kB      +5.45 kB
 *   TOTAL gzip            1,014.41 kB   1,017.36 kB      +2.95 kB
 *
 * The curated build dropped ten contributions that are provably inert in this
 * app — codelens, dropOrPasteInto, gpu, inlayHints, inlineCompletions,
 * linkedEditing, parameterHints, rename, semanticTokens, stickyScroll — every
 * one of which needs a provider that nothing here registers. It looked like it
 * saved 419 kB off `TextViewer`. **It saved nothing.** Almost exactly that much
 * reappeared in `jsonMode`: those modules were reachable from the dropped
 * features' static graph, and with the features gone Rollup could no longer
 * hoist them out of the one dynamic chunk that still needs them. Total bytes
 * went *up* by 5.45 kB.
 *
 * So the trade was: 419 kB deferred out of the chunk every text file loads and
 * into the chunk only a `.json` file loads, at the price of 54 hand-maintained
 * import lines whose failure mode — a feature silently absent — is invisible,
 * and which would have to be revisited the day a language service is added (a
 * TypeScript worker turns rename, parameterHints, inlayHints and semanticTokens
 * back into live features). Under the ~500 kB bar this was weighed against, and
 * a wash in total bytes, that is not worth the correctness margin: this is a
 * lazily-loaded chunk served off Tauri's local asset host, so the cost is parse
 * time, once, with no network in it.
 *
 * What would actually move this number is not curation. It is the ~28 MB of
 * `esm/vs` that the core editor pulls in regardless of which contributions are
 * listed. If this chunk ever has to shrink for real, that is where to look.
 */
import "monaco-editor/features/register.all";

/**
 * A curated set of languages, one `register.js` each.
 *
 * Each of these registers an id and a *lazy* loader, so the grammar itself is a
 * chunk fetched the first time a file of that language opens. The cost of
 * listing one here is therefore a few hundred bytes, not a grammar.
 *
 * `javascript` is its own entry: the `typescript` definition registers only the
 * `typescript` id, and a `.js` file left to it gets no highlighting at all.
 * (Verified by reading both `register.js` files, not assumed.)
 *
 * Adding a language is one line here plus one row in `LANGUAGE_BY_EXTENSION`.
 */
import "monaco-editor/languages/definitions/rust/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/cpp/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/ini/register";

/**
 * JSON is the exception: a real language service, not just a tokenizer.
 *
 * There is no `languages/definitions/json` — this module *is* how the `json`
 * language id comes to exist, and it brings validation, hover, completion,
 * folding, colour decorators and formatting with it. Worth its worker for a
 * file editor whose users open `package.json` and `tsconfig.json` daily.
 */
import { jsonDefaults } from "monaco-editor/languages/features/json/register";

import { TOML_CONFIGURATION, TOML_LANGUAGE } from "./toml";

import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";

/**
 * Two workers, dispatched by label.
 *
 * The moment `MonacoEnvironment.getWorker` exists it wins **unconditionally**:
 * `internal/common/workers.js` checks it before ever looking at the
 * `createWorker` a language service supplied. So a single-worker environment
 * does not merely skip the JSON service, it actively breaks it — the first JSON
 * hover, completion, colour decorator or folding request is handed the generic
 * editor worker, which has no `jsonWorker` module, and the request never
 * settles. `diagnosticsOptions.validate: false` does not prevent that; the
 * other nine `modeConfiguration` flags all default to true.
 *
 * The alternative was to keep one worker and switch every JSON mode flag except
 * `tokens` off. Rejected: it costs the whole JSON language service to save a
 * chunk that is lazily fetched anyway, and it leaves a live footgun — anyone
 * turning a flag back on gets a hang rather than a missing feature.
 *
 * Expect two JSON worker chunks in the build regardless. `workerManager.js`
 * contains a literal `new Worker(new URL('json.worker.js', import.meta.url))`
 * that Vite's `vite:worker-import-meta-url` plugin emits by static analysis,
 * reachable at runtime or not. The `?worker` import above is the second. That
 * is expected, not a bug.
 */
self.MonacoEnvironment = {
  getWorker: (_workerId, label) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};

/**
 * No schema fetching, ever.
 *
 * `false` is already the default, pinned here because it is a network-egress
 * property rather than a preference: a desktop file editor that quietly fetched
 * `$schema` URLs off the internet whenever someone opened a JSON file would be
 * doing something its user did not ask for. Structural validation still works;
 * only remote schema resolution is off.
 */
jsonDefaults.setDiagnosticsOptions({ ...jsonDefaults.diagnosticsOptions, enableSchemaRequest: false });

/**
 * TOML, which Monaco does not ship and this app cannot do without.
 *
 * The grammar is `./toml.ts`; that file argues for its own existence and lists
 * what the `ini` stand-in it replaced got wrong. Registered here rather than
 * there so that the rule at the top of this file still holds — one module
 * touches `monaco-editor`, and a grammar is data.
 *
 * Both extensions are declared on the language itself as well as in
 * `LANGUAGE_BY_EXTENSION` below. The table is what this app resolves through;
 * the declaration here is what Monaco's own machinery reads, and a model
 * created by URI without a language would otherwise find nothing.
 */
monaco.languages.register({ id: "toml", extensions: [".toml", ".helve"], aliases: ["TOML"] });
monaco.languages.setLanguageConfiguration("toml", TOML_CONFIGURATION);
monaco.languages.setMonarchTokensProvider("toml", TOML_LANGUAGE);

/**
 * The editor theme, defined once at module scope.
 *
 * Not per-mount: `defineTheme` writes into Monaco's global theme registry, so
 * redefining it on every editor would be repeated work for no visual change.
 *
 * Named `helve-dark`, the same as `src/shell/diff/DiffView.tsx`'s copy. Two
 * definitions of one name is a real hazard — whichever module evaluates last
 * wins — and it is tolerated only because the two never load together today:
 * nothing in the shell imports `DiffView`. That copy retires when the diff
 * viewer moves into Files and can extend this one.
 *
 * **Every colour below is a value from `src/tokens.css`, named in the comment
 * beside it.** Monaco's theme API takes colour *strings*, so this is the one
 * place in the app where a literal hex is unavoidable — which is exactly why
 * the comments are mandatory rather than decorative.
 *
 * Alphas are 8-digit `#RRGGBBAA`, not `rgba()`. Monaco parses theme colours
 * with `Color.fromHex`, which understands `#RGB`, `#RGBA`, `#RRGGBB` and
 * `#RRGGBBAA` and **silently returns opaque red for anything else** — including
 * a perfectly valid `rgba(...)` string. The two-hex-digit suffix is
 * `round(alpha * 255)`; the alphas themselves follow the `--accent-wash`
 * convention already in tokens.css.
 */
export const THEME = "helve-dark";

monaco.editor.defineTheme(THEME, {
  base: "vs-dark",
  // Syntax token colours are inherited from vs-dark rather than restated. The
  // handoff's palette names UI surfaces, not grammar scopes, so inventing a
  // token colour here would be inventing a colour, which this file may not do.
  inherit: true,
  rules: [],
  colors: {
    // --- the page ---------------------------------------------------------
    "editor.background": "#14161a", // --bg
    "editor.foreground": "#e4e7ec", // --text
    "editorGutter.background": "#14161a", // --bg — the gutter is page, not bar
    "editorLineNumber.foreground": "#4a505b", // --text-faint
    "editorLineNumber.activeForeground": "#949cab", // --text-dim

    // The current line, one step up from the page — the same step `--surface`
    // makes against `--bg` everywhere else in the product. The border is set to
    // the same value rather than to a transparent black, so vs-dark's default
    // outline disappears without this file naming a colour that is not a token.
    "editor.lineHighlightBackground": "#1b1e24", // --surface
    "editor.lineHighlightBorder": "#1b1e24", // --surface

    // --- selection and cursor ---------------------------------------------
    // Accent, because tokens.css gives `--accent` to focus, and a selection is
    // where focus is. Three strengths: the live selection, the same selection
    // once the editor loses focus, and other occurrences of the selected text.
    "editor.selectionBackground": "#d98a3f40", // --accent @ 0.25
    "editor.inactiveSelectionBackground": "#d98a3f1f", // --accent @ 0.12
    "editor.selectionHighlightBackground": "#d98a3f14", // --accent-wash
    "editorCursor.foreground": "#d98a3f", // --accent

    // --- find -------------------------------------------------------------
    // `--warn`, not `--accent`: a find match is not focus, and drawing it in
    // the focus colour next to a selection drawn in the focus colour would make
    // the two unreadable against each other.
    "editor.findMatchBackground": "#d9a93f59", // --warn @ 0.35
    "editor.findMatchHighlightBackground": "#d9a93f2e", // --warn @ 0.18
    "editor.findRangeHighlightBackground": "#d9a93f14", // --warn @ 0.08

    // --- structure --------------------------------------------------------
    "editorBracketMatch.background": "#22262e", // --surface-2
    "editorBracketMatch.border": "#d98a3f73", // --accent-line
    // The numbered keys are 0.56's; the unsuffixed `editorIndentGuide.*` names
    // are deprecated aliases and are not restated.
    "editorIndentGuide.background1": "#2c313b", // --line
    "editorIndentGuide.activeBackground1": "#3a404b", // --line-2
    "editorWhitespace.foreground": "#3a404b", // --line-2
    "editorRuler.foreground": "#2c313b", // --line
    "editorOverviewRuler.border": "#2c313b", // --line

    // --- scrollbar --------------------------------------------------------
    "scrollbarSlider.background": "#2c313b80", // --line @ 0.50
    "scrollbarSlider.hoverBackground": "#3a404bb3", // --line-2 @ 0.70
    "scrollbarSlider.activeBackground": "#3a404b", // --line-2

    // --- minimap ----------------------------------------------------------
    // The minimap is page, not chrome, so it takes `--bg` and disappears into
    // the editor beside it — vs-dark's default would draw a lighter column
    // along the right edge and read as a second pane.
    //
    // Its slider is the scrollbar's, one step quieter at rest: the minimap
    // *is* a scrollbar, and two different sliders on one edge would look like
    // two different controls.
    "minimap.background": "#14161a", // --bg
    "minimapSlider.background": "#2c313b4d", // --line @ 0.30
    "minimapSlider.hoverBackground": "#2c313b80", // --line @ 0.50
    "minimapSlider.activeBackground": "#3a404bb3", // --line-2 @ 0.70

    // --- the widgets the feature barrel brings with it ---------------------
    // Find, hover, suggest and the context menu all float above the page, so
    // they take `--surface` and a `--line` hairline like every other floating
    // panel in the shell.
    "editorWidget.background": "#1b1e24", // --surface
    "editorWidget.foreground": "#e4e7ec", // --text
    "editorWidget.border": "#2c313b", // --line
    "editorHoverWidget.background": "#1b1e24", // --surface
    "editorHoverWidget.border": "#2c313b", // --line
    "editorSuggestWidget.background": "#1b1e24", // --surface
    "editorSuggestWidget.border": "#2c313b", // --line
    "editorSuggestWidget.foreground": "#e4e7ec", // --text
    "editorSuggestWidget.selectedBackground": "#22262e", // --surface-2
    "editorSuggestWidget.highlightForeground": "#d98a3f", // --accent
    "menu.background": "#1b1e24", // --surface
    "menu.foreground": "#949cab", // --text-dim
    "menu.border": "#2c313b", // --line
    "menu.selectionBackground": "#22262e", // --surface-2
    "menu.selectionForeground": "#e4e7ec", // --text
    "list.hoverBackground": "#22262e", // --surface-2
    "input.background": "#14161a", // --bg
    "input.foreground": "#e4e7ec", // --text
    "input.border": "#3a404b", // --line-2
    "focusBorder": "#d98a3f", // --accent

    // --- diagnostics ------------------------------------------------------
    // Only JSON produces these today; the mapping is the shell's, so it stays
    // right when a second language service arrives.
    "editorError.foreground": "#d9635f", // --err
    "editorWarning.foreground": "#d9a93f", // --warn
    "editorInfo.foreground": "#949cab", // --text-dim
  },
});

/** What a caller may hold without importing Monaco itself. See the header. */
export type TextModel = monaco.editor.ITextModel;
export type CodeEditor = monaco.editor.IStandaloneCodeEditor;
export type EditorViewState = monaco.editor.ICodeEditorViewState;

/**
 * Extension → language id. The one place a filename becomes a grammar.
 *
 * Keys are lowercase and dot-less, matching `extensionOf` in `../rpc`. Anything
 * absent gets no language and renders as plain text, which is the correct
 * answer for a file this app has no grammar for — a wrong grammar is worse than
 * none.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  rs: "rust",

  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",

  css: "css",
  html: "html",
  htm: "html",
  xml: "xml",

  md: "markdown",
  markdown: "markdown",

  py: "python",

  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",

  sh: "shell",
  bash: "shell",
  zsh: "shell",

  yml: "yaml",
  yaml: "yaml",

  json: "json",

  ini: "ini",
  cfg: "ini",

  /**
   * TOML, and HELVE's own two files with it.
   *
   * These used to point at `ini` as an admitted stand-in. They now point at a
   * real grammar — `./toml.ts` — which is the follow-up the old note here asked
   * for by name.
   *
   * `helve` is in this table rather than being left to the plaintext fallback
   * because a `<project>.helve` marker *is* TOML: `project/marker.rs` reads one
   * with `raw.parse::<toml::Table>()`, and `create` writes one with `[helve]`
   * and `[project]` tables in it. The extension is HELVE's; the format is not,
   * and pretending otherwise would mean a second grammar to keep in step with
   * this one.
   *
   * This is also the pairing that makes the icon work land: `.helve` gets the
   * HELVE glyph from `icons/materialIcons.ts` *and* the colour of the format it
   * actually is.
   */
  toml: "toml",
  helve: "toml",
};

/** The Monaco language id for a file, or `undefined` for plain text. */
export function languageFor(extension: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[extension];
}

/**
 * The buffer behind one open tab.
 *
 * Given a `file:` URI so that anything keyed on document identity — JSON's
 * `fileMatch` associations, and any future language service — sees a real path
 * rather than an anonymous `inmemory://` model.
 *
 * The caller owns the result and must `dispose()` it; see `useOpenFiles.ts`.
 */
export function createModel(text: string, path: string, extension: string): TextModel {
  const uri = monaco.Uri.file(path);
  const language = languageFor(extension);

  // Monaco refuses to create a second model at the same URI, and would throw
  // in the middle of opening a file. That can only happen if a dispose was
  // missed somewhere, and re-using the model is strictly better for the person
  // in front of it than a stack trace: the text is replaced either way.
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    existing.setValue(text);
    if (language) monaco.editor.setModelLanguage(existing, language);
    return existing;
  }

  return monaco.editor.createModel(text, language, uri);
}

/**
 * Point an existing model's language at a different extension.
 *
 * Exists for renames. `documents.rekey` moves a live buffer to a new path
 * without disposing it — which is what makes a rename keep unsaved changes and
 * undo history — but the model was given its language when it was created, so
 * renaming `notes.txt` to `notes.md` leaves Markdown being tokenized as plain
 * text until the tab is closed and opened again.
 *
 * Falls back to `plaintext` rather than leaving the old language in place: an
 * extension this app has no grammar for should look like text, and keeping the
 * previous file type's colouring would be actively misleading — the same
 * argument `LANGUAGE_BY_EXTENSION` makes for a wrong grammar being worse than
 * none.
 *
 * The model's *URI* still says the old path, and there is no API to change it.
 * See `rekey` for why that is survivable today.
 */
export function retargetModel(model: TextModel, extension: string): void {
  monaco.editor.setModelLanguage(model, languageFor(extension) ?? "plaintext");
}

/**
 * Mount an editor over an existing model.
 *
 * The model is passed in rather than created from `value`, which is what makes
 * a tab's undo history and view state outlive its viewer: a standalone editor
 * disposes only the model it created itself, so `dispose()` here leaves the
 * caller's model alone.
 *
 * `automaticLayout: true` matches `DiffView`'s posture: the pane's size is
 * decided by a flexbox and a draggable splitter rather than by anything that
 * could call `layout()` at the right moment. It is also what keeps the minimap
 * honest — the map's width is a function of the editor's, and a splitter drag
 * that did not re-layout would leave it drawn at the old width.
 *
 * The minimap is on, with three settings that are about *this* pane rather
 * than about minimaps:
 *
 * - `renderCharacters: false`. The character-accurate map is a canvas of real
 *   glyphs at sub-pixel size; the block rendering says the same thing about
 *   shape and indentation, reads better next to a 12px editor, and is much
 *   cheaper to repaint on every keystroke.
 * - `maxColumn: 80`. Uncapped, the map is as wide as the longest line in the
 *   file, and a minified line would eat a third of a pane that is already
 *   sharing its width with the tree.
 * - `showSlider: "mouseover"`. At rest the map is a picture of the file; the
 *   viewport box appears when the pointer arrives, which is when it is a
 *   control.
 *
 * Not `size: "fill"` or `"proportional"`: the default `"actual"` draws one map
 * line per file line and stops, so a short file gets a short map instead of one
 * stretched to the pane's height, and the map's vertical position agrees with
 * the scrollbar beside it.
 */
export function mountEditor(container: HTMLElement, model: TextModel, readOnly: boolean): CodeEditor {
  return monaco.editor.create(container, {
    model,
    theme: THEME,
    readOnly,
    // Without this a read-only editor still shows a blinking caret, which
    // reads as "type here" for a pane that will refuse every keystroke.
    domReadOnly: readOnly,
    automaticLayout: true,
    minimap: {
      enabled: true,
      renderCharacters: false,
      maxColumn: 80,
      showSlider: "mouseover",
    },
    scrollBeyondLastLine: false,
    // Read from the token rather than restated, so the editor cannot drift
    // from the rest of the product's monospace. Falls back to the generic
    // family only if tokens.css somehow did not load.
    fontFamily: readToken("--mono") || "monospace",
    fontSize: 12,
    renderLineHighlight: "line",
    // A source file's own line breaks are information; re-flowing them would
    // misreport what the file says. Same rule as `.app__code`.
    wordWrap: "off",
  });
}

/**
 * Bind Ctrl+S / ⌘S inside the editor.
 *
 * Needed on top of the document-level handler in `App.tsx`: Monaco's keybinding
 * service consumes keydown at the editor's own DOM node and stops it
 * propagating, so with focus in the editor the document listener never sees it.
 * `saveDocument` de-duplicates concurrent calls anyway, so the two firing
 * together would be harmless rather than a double write.
 */
export function bindSave(editor: CodeEditor, run: () => void): void {
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, run);
}

/** One CSS custom property off the root element, trimmed. `""` if unset. */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
