/**
 * Grammars for languages Monaco does not ship, plus the one function that
 * installs them.
 *
 * There is exactly one language in here today — TOML, which HELVE's own two
 * marker formats are written in — and the package is named for the general case
 * because the boundary it exists to cross is general. `src/` and `apps/files/`
 * may not import each other, so anything both sides of the shell need lives
 * under `packages/`; `@helve/file-icons` was the first of these and this is the
 * second. A second grammar would be another file beside `./toml.ts` and another
 * `register*` below, not a second package.
 *
 * **Nothing here imports `monaco-editor` at runtime.** The grammars are plain
 * data and the registrar takes the Monaco namespace as an argument, so this
 * package adds no bytes to a bundle that has not already paid for Monaco — and,
 * more usefully, it can be imported by a module that must stay Monaco-free.
 * `worktree/SourceControlView.tsx` is exactly that: it reaches `DiffView`
 * through a `lazy(() => import(...))` so that opening the source-control panel
 * does not drag Monaco in, and a static import of anything that touched Monaco
 * would undo that. `isTomlPath` is safe for it to call because of this rule.
 */
import { TOML_CONFIGURATION, TOML_EXTENSIONS, TOML_LANGUAGE, TOML_LANGUAGE_ID } from "./toml";

export { TOML_CONFIGURATION, TOML_EXTENSIONS, TOML_LANGUAGE, TOML_LANGUAGE_ID } from "./toml";

/**
 * The `monaco` namespace as `editor.api` exports it.
 *
 * Written as `typeof import(...)` rather than `import type * as monaco` and
 * `typeof monaco`, because the latter is not legal: a type-only import binds a
 * name in type space alone, and `typeof` needs a value to read a type off. The
 * import-type form is erased the same way and needs no value binding.
 *
 * `editor.api` deliberately, not `editor.main` — every consumer imports the
 * former (each header says why), and the three setters used below are on the
 * `languages` namespace that `editor.api` already exports in full. That is what
 * makes a hand-written Monarch grammar uniquely portable here: the diff editor
 * has no tokenizer for any *bundled* language precisely because it never pulled
 * `editor.main` in, and yet it can be handed this one.
 */
export type MonacoApi = typeof import("monaco-editor/editor/editor.api");

/**
 * Teach a Monaco instance TOML. Safe to call more than once.
 *
 * The guard is not defensive padding — it is the point of routing every editor
 * through one function. Two of the three consumers (`search/previewMonaco.ts`
 * and `diff/DiffView.tsx`) are shell-side, so both chunks can be live in one JS
 * context at once, and both would otherwise register the same id against the
 * same global registry. Monaco tolerates that by merging the extension lists and
 * letting the last tokens provider win, which is survivable only for as long as
 * the two registrations stay byte-identical; the theme names in those same two
 * files had to be pulled apart for the version of this hazard that is not
 * survivable. Registering once and never again sidesteps the question rather
 * than depending on the answer.
 *
 * (Files' editor lives behind an iframe boundary and shares no registry with
 * either, so for it the guard is simply never true.)
 */
export function registerToml(monaco: MonacoApi): void {
  if (monaco.languages.getLanguages().some((language) => language.id === TOML_LANGUAGE_ID)) return;

  monaco.languages.register({
    id: TOML_LANGUAGE_ID,
    // Declared on the language itself as well as in each consumer's
    // extension table. The tables are what the apps resolve through; this
    // declaration is what Monaco's own machinery reads, and a model created
    // by URI without an explicit language would otherwise find nothing.
    extensions: TOML_EXTENSIONS.map((extension) => `.${extension}`),
    aliases: ["TOML"],
  });
  monaco.languages.setLanguageConfiguration(TOML_LANGUAGE_ID, TOML_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(TOML_LANGUAGE_ID, TOML_LANGUAGE);
}

/**
 * Whether a path is one this package has a grammar for.
 *
 * For callers that need to name a language without owning an extension table —
 * the source-control panel, which knows a file's path and must hand `DiffView`
 * a language id, but whose whole reason for existing lazily is that it may not
 * import the module where such a table would live.
 *
 * Matches the last dot-segment only, and only when there is one after the final
 * path separator, so a directory with a dot in it does not turn every file under
 * it into TOML. Same rule as the `extensionOf` helpers on both sides of the
 * boundary, restated here because neither is reachable from the other.
 */
export function isTomlPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (dot === -1 || dot <= separator + 1) return false;

  const extension = path.slice(dot + 1).toLowerCase();
  return (TOML_EXTENSIONS as readonly string[]).includes(extension);
}
