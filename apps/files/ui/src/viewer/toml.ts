/**
 * A TOML grammar, because Monaco does not ship one.
 *
 * `monaco-editor` 0.56 bundles 84 basic languages and TOML is not among them
 * (checked, not assumed: `esm/vs/languages/definitions/` has `ini`, `yaml`,
 * `xml` and no `toml`). Until this file existed, `monaco.ts` mapped `.toml` to
 * the `ini` grammar as an admitted stand-in, and its own comment named the
 * follow-up: "a ~30-line Monarch tokenizer registered next to this table under
 * a real `toml` id". This is that.
 *
 * ## Why it was worth writing rather than aliasing again
 *
 * `.helve` is TOML. `src-tauri/src/project/marker.rs` parses a project marker
 * with `raw.parse::<toml::Table>()`, and `manifest.rs` does the same for
 * `helve.toml`. So the three files anyone working in this product opens most —
 * `<project>.helve`, `helve.toml`, `Cargo.toml` — are all one format, and all
 * three were being coloured by a grammar for a different one.
 *
 * The `ini` stand-in is not merely imprecise on them, it is wrong on their
 * actual contents:
 *
 * - Its key rule is `/(^\w+)(\s*)(\=)/`, and `\w` does not include `-`. Every
 *   kebab-case key HELVE writes — `created-with`, `created-unix-ms`,
 *   `checkout-root` — is therefore not highlighted as a key at all.
 * - Its section rule is `/^\[[^\]]*\]/`, which on `helve.toml`'s `[[tool]]`
 *   matches `[[tool]` and leaves a stray `]` behind.
 * - Its comment rule is `/^\s*[#;].*$/`, so a comment after a value on the same
 *   line is not a comment.
 * - Arrays, inline tables, multi-line strings and datetimes are all untokenized.
 *
 * Those five are the exact list the old comment admitted to, so this grammar is
 * measured against them rather than against TOML in the abstract.
 *
 * ## Token names are borrowed, not invented
 *
 * Every token this emits is one `vs-dark` already colours — `key`, `metatag`,
 * `comment`, `string`, `number`, `number.hex`, `keyword`, `delimiter` (read out
 * of `editor/standalone/common/themes.js`). That is deliberate and it is what
 * lets `helve-dark` keep `rules: []`: the theme's header in `monaco.ts` forbids
 * inventing a token colour, on the grounds that the handoff palette names UI
 * surfaces rather than grammar scopes. Borrowing scopes the base theme already
 * styles means a `.helve` file is coloured by exactly the machinery that colours
 * a `.py` or a `.md`, and this file introduces no palette of its own.
 *
 * ## What it deliberately does not do
 *
 * No validation, no folding provider, no language service. A Monarch tokenizer
 * is a lexer: it says what a run of characters *looks* like, not whether the
 * document is well-formed. A `.helve` with a duplicate table is coloured
 * perfectly and is still rejected by Rust, which is the half that gets to have
 * an opinion — the same division `monaco.ts` draws for every other language
 * here except JSON.
 */
import type * as monaco from "monaco-editor/editor/editor.api";

/**
 * Comments, brackets, and what the editor auto-closes.
 *
 * `#` only. TOML has no block comment and no `;` — that second one is an `ini`
 * habit, and inheriting it would let this grammar quietly accept a character
 * that makes the file fail to parse in Rust.
 */
export const TOML_CONFIGURATION: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "#" },
  brackets: [
    ["[", "]"],
    ["{", "}"],
  ],
  autoClosingPairs: [
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export const TOML_LANGUAGE: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".toml",

  /**
   * TOML's escape set, which is shorter than most: `\b \t \n \f \r \" \\`, plus
   * the two unicode forms. Notably **not** `\'` — a literal string is literal,
   * and there is nothing to escape inside one.
   */
  escapes: /\\(?:[btnfr"\\]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      // --- table headers ------------------------------------------------
      // `[[tool]]` before `[tool]`: they start with the same character, and the
      // shorter rule would take half of the longer one and leave a stray
      // bracket — which is precisely the bug the `ini` stand-in has on
      // `helve.toml`.
      //
      // Anchored with `^` so a header is told apart from an array *value* by
      // where it sits rather than by what is inside it. `ini.js` and `yaml.js`
      // both anchor this way, so the support is the grammar engine's own.
      // Every capture group is spelled out because Monarch maps an array of
      // tokens onto groups one for one and requires them to cover the match.
      [/^(\s*)(\[\[)([^[\]]*)(\]\])/, ["", "metatag", "metatag", "metatag"]],
      [/^(\s*)(\[)([^[\]]*)(\])/, ["", "metatag", "metatag", "metatag"]],

      // --- keys ---------------------------------------------------------
      // Deliberately not anchored, so the keys inside an inline table
      // (`{ a = 1, b = 2 }`) are keys too. A table header cannot be caught by
      // this rule because it has no `=`.
      //
      // The character class is TOML's bare-key set, `A-Za-z0-9_-`. The `-` is
      // the whole reason this rule is not `ini`'s: every key HELVE writes has
      // one in it.
      [/("(?:[^"\\]|\\.)*"|'[^']*')(\s*)(=)/, ["key", "", "delimiter"]],
      [/([A-Za-z0-9_-]+(?:\s*\.\s*[A-Za-z0-9_-]+)*)(\s*)(=)/, ["key", "", "delimiter"]],

      { include: "@whitespace" },

      // --- strings ------------------------------------------------------
      // Triple quotes first, or `"""` opens and immediately closes an empty
      // basic string and the body of the document is tokenized as code.
      [/"""/, { token: "string", next: "@multilineBasic" }],
      [/'''/, { token: "string", next: "@multilineLiteral" }],
      [/"/, { token: "string", next: "@basic" }],
      [/'/, { token: "string", next: "@literal" }],

      // --- dates and times ----------------------------------------------
      // Before the numbers, and that ordering is the entire point: `1979-05-27`
      // begins with four digits, so a number rule reaching it first would
      // shred a date into an integer, a minus, and two more integers.
      //
      // Offset date-time, local date-time, and local date, in one rule; the
      // trailing parts are optional because TOML makes them so.
      [
        /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/,
        "number",
      ],
      // Local time, which has no date in front of it at all.
      [/\d{2}:\d{2}:\d{2}(?:\.\d+)?/, "number"],

      // --- numbers ------------------------------------------------------
      // `inf` and `nan` are floats in TOML, signed like any other.
      [/[+-]?(?:inf|nan)\b/, "number.float"],
      [/0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*/, "number.hex"],
      [/0o[0-7](?:_?[0-7])*/, "number.octal"],
      [/0b[01](?:_?[01])*/, "number.binary"],
      // Float before integer, or `3.14` is read as `3` and then `.14`. The
      // `_?` between digits is TOML's readability separator — `1_000_000`.
      [/[+-]?\d(?:_?\d)*(?:\.\d(?:_?\d)*)?[eE][+-]?\d(?:_?\d)*/, "number.float"],
      [/[+-]?\d(?:_?\d)*\.\d(?:_?\d)*/, "number.float"],
      [/[+-]?\d(?:_?\d)*/, "number"],

      // --- the rest -----------------------------------------------------
      [/\b(?:true|false)\b/, "keyword"],
      // Arrays and inline tables. No state for either: their contents are the
      // same values this state already knows, and TOML lets an array span
      // lines, so a state that popped at end of line would be wrong anyway.
      [/[[\]{}]/, "delimiter"],
      [/,/, "delimiter"],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ""],
      // Anywhere on the line, not just at the start of one — TOML allows a
      // comment after a value, and `helve.toml` uses that.
      [/#.*$/, "comment"],
    ],

    basic: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string", next: "@pop" }],
    ],

    literal: [
      // No escapes at all: that is what makes it literal, and it is why a
      // Windows path is usually written in one.
      [/[^']+/, "string"],
      [/'/, { token: "string", next: "@pop" }],
    ],

    multilineBasic: [
      // The closing delimiter is matched before the bulk rule can eat it, and
      // the lone `"` rule below it lets a quote inside the body stay a quote.
      [/"""/, { token: "string", next: "@pop" }],
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string"],
    ],

    multilineLiteral: [
      [/'''/, { token: "string", next: "@pop" }],
      [/[^']+/, "string"],
      [/'/, "string"],
    ],
  },
};
