/**
 * File-type icons for the Files tree, from VS Code's Material Icon Theme.
 *
 * ## This is a deliberate carve-out from the icon rule
 *
 * `src/ui/Icon.tsx` says every glyph in this codebase is hand-authored inline
 * JSX, strokes `currentColor`, and hardcodes no hex. These do the opposite:
 * they are external, multi-colour, flat SVG files loaded over a URL.
 *
 * The reason is that for these icons the colour *is* the information. A tree of
 * fifty rows is scanned, not read — the orange of a `.rs` against the blue-grey
 * of a `.toml` against the yellow of a `.json` is what lets you find the file
 * you want without reading a single filename. Recolouring them to
 * `currentColor` would delete the entire point and leave fifty identical grey
 * shapes. That is a different argument from "an icon package is convenient",
 * and it applies to nothing else in the app.
 *
 * So the carve-out is bounded: **file-type icons inside the Files tree, and
 * nowhere else.** Chrome — the tree's expand chevron, toolbar glyphs, anything
 * that is furniture rather than content — stays hand-authored inline SVG at
 * `currentColor` under the existing rule.
 *
 * `material-icon-theme` is MIT, and its LICENSE travels with the dependency in
 * `node_modules`. This app is internal and is not redistributed.
 *
 * ## Mechanics
 *
 * The SVGs and the lookup tables are both generated at build time by
 * `scripts/generate-file-icons.mjs` and are not in git. Icons live in
 * `public/icons/material/`, so they are served as static files rather than
 * bundled — see that script's header for why that matters. Render the result
 * as `<img src={fileIconUrl(name)} alt="" />`.
 */

import { defaultIcons, fileExtensions, fileNames, folderNames, folderNamesExpanded } from "./manifest.generated";

/** Root-relative, so it resolves the same under Vite and under Tauri's asset host. */
const BASE = "/icons/material/";

/**
 * The theme's own order: an exact filename beats an extension, and a longer
 * extension beats a shorter one.
 *
 * The extension pass walks the dots left to right, so `component.spec.ts` tries
 * `spec.ts` before `ts` and lands on the test glyph. A `split(".").pop()` would
 * only ever see `ts` — the theme's extension keys are frequently multi-part
 * (`spec.ts`, `d.ts`, `test.js`, `sln.dotsettings.user`) and that is the whole
 * reason the walk exists.
 *
 * Dots at index 0 are skipped: a leading dot begins a *name*. `.gitignore` is
 * resolved by `fileNames`, and must never fall through to an extension lookup
 * for `gitignore`.
 */
export function fileIconUrl(name: string): string {
  const lower = name.toLowerCase();

  const exact = fileNames[lower];
  if (exact) return BASE + exact;

  for (let i = lower.indexOf(".", 1); i !== -1; i = lower.indexOf(".", i + 1)) {
    const byExtension = fileExtensions[lower.slice(i + 1)];
    if (byExtension) return BASE + byExtension;
  }

  return BASE + defaultIcons.file;
}

/**
 * Strip the decoration a folder name may be wearing, in this order:
 *
 *   1. **surrounding** double underscores — `__tests__` -> `tests`. Only when
 *      the name both opens and closes with them, and only the one pair.
 *   2. **leading** `.`, `_` or `-`, any number of them — `.github` -> `github`,
 *      `_shared` -> `shared`, `-legacy` -> `legacy`.
 *
 * Order matters, and step 1 is not a special case of step 2: stripping leading
 * characters first would take `__tests__` to `tests__`, which is nothing.
 * Nothing is ever stripped from the end except as the closing half of step 1.
 *
 * This exists because the theme ships every folder name in all five decorated
 * spellings — `dev`, `.dev`, `_dev`, `-dev`, `__dev__` — and emitting them all
 * costs 320 KB of object literal parsed at startup to say what these two
 * `replace`s say. `scripts/generate-file-icons.mjs` emits only the bare keys and
 * holds the identical rule; the two must move together, and the script fails the
 * build if an alias ever disagrees with its bare form.
 */
function bareFolderName(name: string): string {
  return name.replace(/^__(.+)__$/, "$1").replace(/^[._-]+/, "");
}

/**
 * Folders match on the whole name — there is no suffix rule for them.
 *
 * The exact lookup runs first so a name that *is* its own key still wins. The
 * generator keeps any alias whose stripped form is missing from the table
 * (`__pycache__` with no bare `pycache`, say), and normalising before looking up
 * would turn those into a silent fallback to the plain folder icon.
 */
export function folderIconUrl(name: string, expanded: boolean): string {
  const table = expanded ? folderNamesExpanded : folderNames;
  const lower = name.toLowerCase();

  const exact = table[lower];
  if (exact) return BASE + exact;

  const bare = bareFolderName(lower);
  if (bare && bare !== lower) {
    const stripped = table[bare];
    if (stripped) return BASE + stripped;
  }

  return BASE + (expanded ? defaultIcons.folderExpanded : defaultIcons.folder);
}

/**
 * The tree's root row, if it draws one. The theme has `rootFolderNames` for
 * per-name overrides but ships it empty in 5.37.0, so this is the plain root
 * glyph and takes no name.
 */
export function rootFolderIconUrl(expanded: boolean): string {
  return BASE + (expanded ? defaultIcons.rootFolderExpanded : defaultIcons.rootFolder);
}
