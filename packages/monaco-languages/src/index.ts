/**
 * Grammars for languages Monaco does not ship, plus the one function that installs them.
 * Nothing here imports `monaco-editor` at runtime, so a Monaco-free module can still call
 * `isTomlPath`. Full rationale: `docs/design-notes/monaco-languages.md`.
 */
import { TOML_CONFIGURATION, TOML_EXTENSIONS, TOML_LANGUAGE, TOML_LANGUAGE_ID } from "./toml";

export { TOML_CONFIGURATION, TOML_EXTENSIONS, TOML_LANGUAGE, TOML_LANGUAGE_ID } from "./toml";

/**
 * The `monaco` namespace as `editor.api` exports it — deliberately not `editor.main`, and
 * deliberately `typeof import(...)` rather than `typeof monaco`. Design notes say why each.
 */
export type MonacoApi = typeof import("monaco-editor/editor/editor.api");

/**
 * Teach a Monaco instance TOML. Safe to call more than once — two shell-side consumers share
 * one global registry; the design notes say why the guard sidesteps that hazard, not survives it.
 */
export function registerToml(monaco: MonacoApi): void {
  if (monaco.languages.getLanguages().some((language) => language.id === TOML_LANGUAGE_ID)) return;

  monaco.languages.register({
    id: TOML_LANGUAGE_ID,
    // Declared here as well as in each consumer's extension table: this is what
    // Monaco reads when a model is created by URI with no explicit language.
    extensions: TOML_EXTENSIONS.map((extension) => `.${extension}`),
    aliases: ["TOML"],
  });
  monaco.languages.setLanguageConfiguration(TOML_LANGUAGE_ID, TOML_CONFIGURATION);
  monaco.languages.setMonarchTokensProvider(TOML_LANGUAGE_ID, TOML_LANGUAGE);
}

/**
 * Whether a path is one this package has a grammar for. Matches the last dot-segment only,
 * and only after the final path separator — a dotted directory does not make its files TOML.
 */
export function isTomlPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (dot === -1 || dot <= separator + 1) return false;

  const extension = path.slice(dot + 1).toLowerCase();
  return (TOML_EXTENSIONS as readonly string[]).includes(extension);
}
