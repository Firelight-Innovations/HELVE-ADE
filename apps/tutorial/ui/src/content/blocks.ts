/**
 * What a tutorial is made of.
 *
 * A closed set of block kinds rather than Markdown, so a malformed tutorial is a
 * type error. `docs/tutorials.md` §3 has that argument, the table of what each
 * kind draws as, and the conventions for writing one; §5 has the house style.
 *
 * Inside a block's own text, two spans are borrowed from Markdown: `**bold**`
 * and backticked code. `Inline.tsx` is the whole of that parser, and they do not
 * nest — so a paragraph naming the backquote key cannot wrap it in backticks.
 */

/** A key chord, said the way the tutorial says it out loud: `"Ctrl+Shift+P"`. */
export type Chord = string;

export type Block =
  | { kind: "text"; body: string }
  | { kind: "heading"; body: string }
  // Steps are numbered by position at render time, so inserting one in the
  // middle does not renumber the rest.
  | { kind: "step"; body: string; chord?: Chord }
  | { kind: "note"; body: string }
  // `soon` is its own kind rather than a `note` with different words: it is the
  // block most likely to go stale, and one that looks distinct is one somebody
  // notices when it stops being true.
  | { kind: "soon"; body: string }
  | { kind: "code"; body: string }
  | { kind: "keys"; rows: { chord: Chord; what: string }[] };

/**
 * One tutorial's body. The catalog entry — title, blurb, minutes, section —
 * lives in `src-tauri/src/apps/tutorial.rs`, because Home draws it too.
 *
 * `takeaway` is required rather than optional so that writing a tutorial forces
 * an answer to "what was this for". It is drawn above the "mark as done" button.
 */
export interface Body {
  blocks: Block[];
  takeaway: string;
}
