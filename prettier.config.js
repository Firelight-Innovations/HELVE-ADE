/**
 * Prettier configuration.
 *
 * Nearly every option here is Prettier's default, because Prettier's defaults
 * already match what this codebase was writing by hand: double quotes (445 of
 * 445 import statements), semicolons, two-space indent. Only `printWidth` is
 * set, and only to align TypeScript with rustfmt's `max_width` so the two
 * halves of the repo wrap at the same column.
 *
 * Prettier does not touch the inside of comments, so the prose STANDARDS.md §4
 * asks for survives formatting unchanged.
 */
export default {
  printWidth: 100,
  trailingComma: "all",

  // Paired with `.gitattributes`, which pins the working tree to LF. Leaving
  // this at "auto" would let a Windows checkout reintroduce CRLF and make
  // `--check` disagree with `--write`. See .gitattributes for the full story.
  endOfLine: "lf",
};
