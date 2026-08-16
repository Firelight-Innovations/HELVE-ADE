/**
 * The query field's grammar: parsing what's typed, serializing it back, and
 * turning the leftover search term into something that can actually match.
 *
 * "Just do what VS Code does" is the brief, but VS Code splits this across two
 * boxes — a search term and a separate glob-only include/exclude field. This
 * overlay has one field for both, because the filter buttons and the field
 * share state (see `toQueryString`'s header): a click has to write into the
 * same string a keystroke edits, so there is only one string to parse. What
 * follows is that single grammar: bare globs, a trailing-slash directory,
 * `path:`/`ext:`/`kind:` prefixes, `!`/`-` negation, and a quoted phrase, all
 * mixed with plain words that are the thing being searched *for* rather than
 * filtered *by*.
 *
 * Pure by design — no React, no Monaco, no Tauri, no DOM (the one exception,
 * `RegExp`, is a language builtin, not a platform one). That is what lets a
 * Rust-backed search source and a React hook both depend on it without either
 * dragging the other's runtime along, and what makes every function here
 * testable by construction rather than by mounting something.
 *
 * What this module does not do: it does not run a search. `compilePathFilter`
 * answers "does this path pass," and `compileNeedle` turns a needle into a
 * `RegExp`, but walking a tree or reading a file is `searchSource.ts`'s job
 * (today a name-only walk; a content index later). This module only compiles
 * intent into something a walker can apply per file.
 */
import { ALL_KINDS, extensionOf, kindOf } from "./kinds";
import type { SearchKind } from "./types";

/**
 * The query field parsed into its parts.
 *
 * `parseQuery` produces one of these from raw field text; `toQueryString`
 * produces the field text back from one of these. The type-filter popover and
 * every other button in the overlay only ever touch this shape — the string
 * grammar is an implementation detail of how it gets in and out of a text
 * field, not something the rest of the UI needs to know.
 */
export interface ParsedQuery {
  /** The search term itself, with every token stripped out. */
  needle: string;
  /** Glob patterns the file path must match, e.g. `*.md`, `**\/*.ts`. */
  include: string[];
  /** Negated globs — the `!foo` / `-foo` forms. */
  exclude: string[];
  /** Directory scopes, e.g. `src/` or `path:src/shell`. */
  paths: string[];
  /** `kind:script` — must validate against SearchKind in ./types. */
  kinds: SearchKind[];
  /** `ext:rs` — bare extension filters, lowercased, dot-less. */
  extensions: string[];
}

/** Runtime membership check for `kind:` values, built off the same list
 *  `kinds.ts` draws its filter buttons from — one source of truth for what a
 *  valid kind name is, rather than restating the four strings here too. */
const KNOWN_KINDS = new Set<string>(ALL_KINDS);

function isSearchKind(value: string): value is SearchKind {
  return KNOWN_KINDS.has(value);
}

/** A token carries a `path:`/`ext:`/`kind:` prefix if it starts with one of
 *  these three keywords, case-insensitively, followed by a colon and at least
 *  one more character. The keyword is normalized; the value after the colon
 *  is taken verbatim, case and all — `ext:RS` and `path:Src` differ only in
 *  which half of the colon gets folded. */
const PREFIX_TOKEN = /^(path|ext|kind):(.+)$/i;

/** What marks a token as glob-shaped rather than a plain search word. `]`
 *  alone does not — an unmatched `]` with no `[` is just a character, and
 *  treating it as glob-shaped would misclassify ordinary words containing
 *  one. */
const GLOB_CHARS = /[*?[]/;

// --- tokenizing --------------------------------------------------------

/** One token off the raw field text, plus whether it came from a quoted span. */
interface RawToken {
  text: string;
  quoted: boolean;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Splits raw field text into tokens, respecting `"quoted phrases"`.
 *
 * A quoted span always becomes one token, spaces and all, and is never run
 * through the filter grammar below — `parseQuery` treats every quoted token
 * as needle text unconditionally, which is what makes `"path:not-a-filter"`
 * search for that literal string instead of being read as a path scope.
 * `\"` and `\\` are recognized inside a quoted span so a needle can contain a
 * literal quote or backslash; nothing else is escaped, since nothing else
 * needs to be — unquoted tokens have no escape syntax of their own, matching
 * the glob/prefix grammar's own plainness.
 *
 * An unterminated quote runs to the end of the string rather than erroring —
 * the user is still typing, and a search field that throws on an odd number
 * of `"` mid-keystroke would be unusable.
 */
function tokenize(raw: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  const n = raw.length;

  while (i < n) {
    while (i < n && isSpace(raw[i])) i++;
    if (i >= n) break;

    if (raw[i] === '"') {
      i++;
      let text = "";
      while (i < n && raw[i] !== '"') {
        if (raw[i] === "\\" && i + 1 < n && (raw[i + 1] === '"' || raw[i + 1] === "\\")) {
          text += raw[i + 1];
          i += 2;
        } else {
          text += raw[i];
          i++;
        }
      }
      if (i < n) i++; // consume the closing quote, if there was one
      tokens.push({ text, quoted: true });
      continue;
    }

    const start = i;
    while (i < n && !isSpace(raw[i])) i++;
    tokens.push({ text: raw.slice(start, i), quoted: false });
  }

  return tokens;
}

// --- classifying ---------------------------------------------------------

/** The buckets a token gets sorted into. `needleParts` is joined once, at the
 *  end, rather than concatenated per token, so word order is preserved
 *  without repeated string copies. */
interface Buckets {
  include: string[];
  exclude: string[];
  paths: string[];
  kinds: SearchKind[];
  extensions: string[];
  needleParts: string[];
}

/**
 * Sorts one unquoted token into `out`.
 *
 * Negation (`!`/`-`) only strips its marker when the remainder is something
 * `exclude` has a slot for — a glob or a directory scope. A `path:`/`ext:`/
 * `kind:` token has no negative counterpart in `ParsedQuery` (there is no
 * "excluded extension" list), and neither does a plain word (there is no
 * "must not match this text" — that would be a content-exclusion, and
 * `exclude` holds path globs, not content). In both of those cases the
 * *whole original token*, marker included, is kept as needle text: nothing
 * is silently dropped, and `-verbose` typed as a literal search term is not
 * quietly eaten by a filter grammar it never intended to invoke.
 *
 * The same "don't drop it" rule applies to an unrecognized `foo:bar` prefix
 * and to a `kind:` value that isn't one of `ALL_KINDS` — both fall through to
 * needle text rather than being parsed as a token and discarded.
 */
function classifyToken(token: string, out: Buckets): void {
  const marker = token[0];
  const negated = (marker === "!" || marker === "-") && token.length > 1;
  const body = negated ? token.slice(1) : token;

  const prefixed = body.match(PREFIX_TOKEN);
  if (prefixed) {
    if (negated) {
      out.needleParts.push(token);
      return;
    }
    const keyword = prefixed[1].toLowerCase();
    const value = prefixed[2];
    if (keyword === "path") {
      out.paths.push(value);
      return;
    }
    if (keyword === "ext") {
      out.extensions.push(value.replace(/^\.+/, "").toLowerCase());
      return;
    }
    if (keyword === "kind") {
      if (isSearchKind(value)) {
        out.kinds.push(value);
      } else {
        out.needleParts.push(token);
      }
      return;
    }
  }

  if (body.length > 1 && body.endsWith("/")) {
    if (negated) out.exclude.push(body);
    else out.paths.push(body);
    return;
  }

  if (GLOB_CHARS.test(body)) {
    if (negated) out.exclude.push(body);
    else out.include.push(body);
    return;
  }

  out.needleParts.push(token);
}

/**
 * Parses raw query-field text into its filters and search term.
 *
 * Empty input parses to an all-empty `ParsedQuery` — no special-casing, since
 * an empty token stream naturally produces empty buckets and an empty
 * `needle`.
 */
export function parseQuery(raw: string): ParsedQuery {
  const buckets: Buckets = {
    include: [],
    exclude: [],
    paths: [],
    kinds: [],
    extensions: [],
    needleParts: [],
  };

  for (const token of tokenize(raw)) {
    if (token.quoted) {
      buckets.needleParts.push(token.text);
      continue;
    }
    classifyToken(token.text, buckets);
  }

  return {
    needle: buckets.needleParts.join(" "),
    include: buckets.include,
    exclude: buckets.exclude,
    paths: buckets.paths,
    kinds: buckets.kinds,
    extensions: buckets.extensions,
  };
}

// --- serializing -----------------------------------------------------------

/**
 * Renders a `ParsedQuery` back to field text.
 *
 * This is the half the type-filter popover actually depends on: clicking
 * "Rust" toggles `kinds`, and the popover writes the field by calling this on
 * the updated `ParsedQuery`, not by string-splicing the old field text. For
 * that to read back correctly on the next keystroke, `parseQuery(toQueryString(p))`
 * must deep-equal `p` for every `p` `parseQuery` can produce. The cases worth
 * writing down:
 *
 * - **Empty needle.** Omitted entirely rather than emitted as `""` — an empty
 *   token stream parses back to `needle: ""` on its own, so there is nothing
 *   to round-trip.
 * - **A needle that looks like a token** (`*.md`, `path:x`, a lone `-`
 *   followed by more text). `needsQuoting` below flags exactly the shapes
 *   `classifyToken` would otherwise misparse and `serializeNeedle` wraps the
 *   needle in a quoted phrase, which `parseQuery` always reads as needle text
 *   regardless of what's inside. Both checks are written to mirror each
 *   other's thresholds (`length > 1` before treating a leading `!`/`-` as a
 *   marker, same for a trailing `/`) — under-quoting a needle that needed it
 *   is a parse bug, so the mirrored check leans safe wherever the two could
 *   disagree.
 * - **A multi-word needle** (`render scene`). Emitted as bare words, not as
 *   one quoted phrase — see `serializeNeedle`. Quoting here would round-trip
 *   correctly and still be wrong, because it rewrites text the user typed.
 * - **A quoted phrase**, including one containing `"` or `\`. `quoteNeedle`
 *   backslash-escapes both before wrapping, and `tokenize` reverses exactly
 *   that escaping — this is not a lossy case, just one that needs the escape
 *   pass to not be.
 * - **An extension that is also a kind name** (`ext:script` alongside
 *   `kind:script`). No collision: `extensions` and `kinds` are always spelled
 *   with their own prefix keyword on both ends of the round trip, so the two
 *   arrays never share a token's meaning even when they share a token's text.
 *
 * **Where the round trip is genuinely lossy:** a glob, directory, extension,
 * or path scope value that contains whitespace. The needle has quoting to
 * fall back on; nothing else does, matching how VS Code's and GitHub's own
 * filter syntaxes don't support embedded spaces in a bare pattern either.
 * `parseQuery` can't produce such a value from typed text in the first place
 * (a space always ends the token), so this only bites a `ParsedQuery` built
 * by hand rather than by `parseQuery` — which is outside what the round-trip
 * guarantee above promises to cover.
 */
export function toQueryString(parsed: ParsedQuery): string {
  const parts: string[] = [
    ...parsed.include,
    ...parsed.exclude.map((glob) => `!${glob}`),
    ...parsed.paths.map((path) => `path:${path}`),
    ...parsed.kinds.map((kind) => `kind:${kind}`),
    ...parsed.extensions.map((ext) => `ext:${ext}`),
  ];

  if (parsed.needle !== "") {
    parts.push(serializeNeedle(parsed.needle));
  }

  return parts.join(" ");
}

/**
 * The needle, written so it reads back as itself.
 *
 * A multi-word needle is **not** quoted just for containing spaces. It arrived
 * as several plain-word tokens joined with a space, and emitting it as several
 * plain words is what reads back identically — quoting it would round-trip
 * correctly but *visibly rewrite the user's own text*, turning `render scene`
 * into `"render scene"` the first time they clicked a filter chip. That is the
 * one thing the shared-state design must never do: a click rewrites the field,
 * so a click must leave everything it did not change byte-identical.
 *
 * Quoting is therefore per-needle rather than per-word: if any single word
 * would misparse on its own (`*.md`, `path:x`, `-v`), the whole needle is
 * quoted, because splitting it into some bare words and some quoted ones would
 * parse back to the same needle but look nothing like what was typed.
 *
 * The shape guard is what keeps the bare path honest. A needle holding a tab, a
 * newline, or a run of two spaces cannot be written as space-joined words
 * without changing it, so it is quoted. `parseQuery` can never produce such a
 * needle — it joins on a single space — so this only guards a hand-built
 * `ParsedQuery`.
 */
function serializeNeedle(value: string): string {
  if (!/^\S+(?: \S+)*$/.test(value)) return quoteNeedle(value);

  const words = value.split(" ");
  return words.every((word) => !needsQuoting(word)) ? value : quoteNeedle(value);
}

/** Would this single word, written bare into the field, be reparsed as
 *  something other than needle text? See `toQueryString`'s header for why each
 *  check here mirrors a threshold in `classifyToken`.
 *
 *  Takes one word, never a phrase — whitespace is `serializeNeedle`'s problem,
 *  and a check for it here would make every multi-word needle look unsafe. */
function needsQuoting(value: string): boolean {
  if (value === "") return false;
  if (value[0] === '"') return true;
  if (value.length > 1 && (value[0] === "!" || value[0] === "-")) return true;
  if (PREFIX_TOKEN.test(value)) return true;
  if (GLOB_CHARS.test(value)) return true;
  if (value.length > 1 && value.endsWith("/")) return true;
  return false;
}

function quoteNeedle(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// --- match flags and compilation --------------------------------------------

/** The three toggle buttons next to the field. Never parsed out of the query
 *  string — they sit beside it in the UI, not inside it, so they travel
 *  alongside a `ParsedQuery` rather than as one of its fields. */
export interface MatchFlags {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/**
 * `compileNeedle`'s result. A discriminated union rather than a thrown
 * exception because the caller is a text field on every keystroke: the user
 * typing `(` on the way to `(foo)` produces a syntactically invalid regex for
 * every keystroke in between, and that is a normal, expected, non-exceptional
 * state for the field to be in — not a bug to unwind the stack over.
 */
export type CompiledNeedle = { ok: true; regex: RegExp } | { ok: false; error: string };

/** Escapes a literal string for safe embedding inside a `RegExp` source. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns a needle plus its match flags into a `RegExp` a caller can run
 * per-line to produce `SearchMatch`es, or reports why it couldn't.
 *
 * The returned pattern always carries the `g` flag — a caller finds every
 * match on a line via repeated `.exec()`, not just the first, which is what
 * `SearchMatch[]` and "417 results in 32 files" both need. `i` is added only
 * when `caseSensitive` is false.
 *
 * `wholeWord` wraps the *whole* pattern in a non-capturing `\b(?:...)\b`
 * rather than only bounding a literal needle. That is what makes it correct
 * for a regex needle too: wrapping preserves whatever alternation or
 * grouping the user's own pattern contains (`\b(?:foo|bar)\b` bounds each
 * alternative as a whole, not just `bar`), where naively appending `\b` after
 * an unwrapped `foo|bar` would only bound the last alternative. `\b` is JS
 * regex's default ASCII notion of a word character — no Unicode-aware
 * boundary is attempted, matching the rest of this module's plainness.
 */
export function compileNeedle(needle: string, flags: MatchFlags): CompiledNeedle {
  const source = flags.regex ? needle : escapeLiteral(needle);
  const bounded = flags.wholeWord ? `\\b(?:${source})\\b` : source;
  const regexFlags = flags.caseSensitive ? "g" : "gi";

  try {
    return { ok: true, regex: new RegExp(bounded, regexFlags) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --- glob matching -----------------------------------------------------------

/** Chars a glob translation must escape for literal use in a `RegExp`. `ch`
 *  is never `*`, `?`, or `[` when this runs — those are consumed by their own
 *  branches in `globToRegExpSource` before reaching here — but the set lists
 *  them anyway so it reads as "everything regex-special," not as a list
 *  quietly depending on caller order to stay correct. */
const REGEX_SPECIAL = /[.*+^${}()|[\]\\]/;

/**
 * Translates one glob pattern into a `RegExp` source fragment (no anchors, no
 * flags — `compileGlob` adds `^...$`).
 *
 * Implemented: `*` (a run of zero or more non-`/` characters), `**` (a run of
 * zero or more characters *including* `/` — what lets `**\/*.ts` cross
 * directories), `?` (exactly one non-`/` character), and `[...]` character
 * classes — both glob's `[!abc]` and regex's own `[^abc]` spelling of
 * negation are accepted.
 *
 * Not implemented: a literal `]` as a class's first (otherwise-special)
 * member (`[]abc]` in POSIX glob dialects — here a `]` always closes the
 * class it opened), brace expansion (`{a,b}`), extended globs (`@(...)`,
 * `+(...)`), and POSIX named classes (`[:alpha:]`). None of VS Code's,
 * GitHub's, or a file explorer's filter fields support these either — this
 * is the same subset, not a smaller one.
 */
function globToRegExpSource(pattern: string): string {
  let out = "";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 2;
      } else {
        out += "[^/]*";
        i += 1;
      }
      continue;
    }

    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\[";
        i += 1;
        continue;
      }
      let body = pattern.slice(i + 1, close);
      let negate = false;
      if (body.startsWith("!") || body.startsWith("^")) {
        negate = true;
        body = body.slice(1);
      }
      // Escaped for JS class safety, not glob semantics: a `\` or `]`
      // surviving into an unescaped class would break out of it.
      const escaped = body.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
      out += `[${negate ? "^" : ""}${escaped}]`;
      i = close + 1;
      continue;
    }

    out += REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }

  return out;
}

/** A compiled glob plus whether it should be tested against the full path or
 *  just the basename — decided once, at compile time, from whether the
 *  pattern itself contains a `/`. */
interface CompiledGlob {
  regex: RegExp;
  hasSlash: boolean;
}

/**
 * Compiles one glob pattern.
 *
 * A pattern with no `/` (`*.md`) matches the basename only, at any depth —
 * that is the whole point of a bare extension glob. A pattern with a `/`
 * (`src/*.ts`, `**\/*.spec.ts`) matches the full normalized path instead,
 * anchored from its start; a leading `**\/` is what opens that anchor back up
 * to "at any depth," via `**`'s own translation to `.*` rather than any
 * special-casing here. This split is ripgrep's and `.gitignore`'s convention,
 * not an invented one.
 *
 * A pattern ending in `/` is `.gitignore`'s other convention: it names a
 * *directory*, not a file, so `compileDirectoryGlob` handles it separately —
 * this general path is never reached with a trailing slash still on it.
 */
function compileGlob(pattern: string): CompiledGlob {
  if (pattern.length > 1 && pattern.endsWith("/")) {
    return compileDirectoryGlob(pattern.slice(0, -1));
  }
  return {
    regex: new RegExp(`^${globToRegExpSource(pattern)}$`),
    hasSlash: pattern.includes("/"),
  };
}

/**
 * Compiles a directory-scoped pattern — one that ended in `/` before
 * `compileGlob` stripped it — as "this directory, and everything beneath
 * it," not as an exact full-path match.
 *
 * That distinction is the difference between `node_modules/` actually
 * excluding a project's dependency tree and it excluding nothing at all: the
 * naive `^node_modules$` this would otherwise become never matches
 * `repo/node_modules/pkg/index.js`, only a path that equals the four
 * characters `node_modules` exactly. The leading `(?: .* /)?` group below (no
 * space in the real pattern — one is inserted here so this comment doesn't
 * read as closing itself) anchors the directory name at a path-segment
 * boundary while still allowing it at any depth — the same "unqualified name
 * matches everywhere" rule a bare `*.md` follows for files — and the
 * trailing `(?:/.*)?` is what pulls in everything the directory contains
 * rather than stopping at the directory entry itself.
 */
function compileDirectoryGlob(directory: string): CompiledGlob {
  const inner = globToRegExpSource(directory);
  return {
    regex: new RegExp(`^(?:.*/)?${inner}(?:/.*)?$`),
    hasSlash: true,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function basenameOf(normalized: string): string {
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function pathSegments(normalized: string): string[] {
  return normalized.split("/").filter((segment) => segment.length > 0);
}

/**
 * Is `needle`'s segment sequence a contiguous run somewhere inside
 * `haystack`'s? What makes a `path:` scope of `src/shell` match
 * `.../orchestrator/src/shell/query.ts` without the scope having to be
 * root-anchored or the caller having to know the search root at all — this
 * module never sees `SearchRequest.root`, only the paths it is asked to
 * judge.
 */
function containsSubsequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Precompiles a `ParsedQuery`'s path-shaped filters — `include`, `exclude`,
 * `paths`, `kinds`, `extensions` — into one reusable predicate.
 *
 * A factory rather than a one-shot `(path, parsed) => boolean` because the
 * intended caller is `runSearch`'s directory walk: one query, up to
 * `MAX_HITS` files and `MAX_DIRECTORIES` listings, and recompiling every
 * glob's `RegExp` on every single entry would make the filter the slow part
 * of the walk. Call this once per search and reuse the returned function.
 *
 * `include`/`exclude`/`paths`/`kinds`/`extensions` being empty each means "no
 * restriction on that axis," not "match nothing." In particular an empty
 * `kinds` array does not reject every path here — `useSearchSession` already
 * treats "no kind selected" as "stop the search before it starts" for its own
 * UI reason, and baking that same policy into a general-purpose predicate
 * would make it wrong for any other caller that wants "unfiltered" to mean
 * what it says.
 *
 * Case-sensitive throughout — for glob text as much as for `path:` segments
 * — matching the rest of this module's plainness rather than guessing at the
 * filesystem's own case sensitivity, which differs by platform and even by
 * volume.
 */
export function compilePathFilter(parsed: ParsedQuery): (path: string) => boolean {
  const includeGlobs = parsed.include.map(compileGlob);
  const excludeGlobs = parsed.exclude.map(compileGlob);
  const pathScopes = parsed.paths.map((scope) => pathSegments(scope));
  const extensionSet = new Set(parsed.extensions);
  const kindSet = new Set<SearchKind>(parsed.kinds);

  const matchesGlob = (compiled: CompiledGlob, normalized: string, name: string): boolean =>
    compiled.regex.test(compiled.hasSlash ? normalized : name);

  return (path: string): boolean => {
    const normalized = normalizePath(path);
    const name = basenameOf(normalized);

    if (excludeGlobs.some((glob) => matchesGlob(glob, normalized, name))) return false;
    if (
      includeGlobs.length > 0 &&
      !includeGlobs.some((glob) => matchesGlob(glob, normalized, name))
    ) {
      return false;
    }

    if (pathScopes.length > 0) {
      const segments = pathSegments(normalized);
      if (!pathScopes.some((scope) => containsSubsequence(segments, scope))) return false;
    }

    if (extensionSet.size > 0 && !extensionSet.has(extensionOf(name))) return false;
    if (kindSet.size > 0 && !kindSet.has(kindOf(path))) return false;

    return true;
  };
}
