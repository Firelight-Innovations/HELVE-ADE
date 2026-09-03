/**
 * PRD §17 Wave 2's acceptance condition, made a regression rather than a
 * one-time grep: "`packages/schematify-ui` holds no literal hex value" —
 * resolved to `apps/schematify/ui/` per `docs/audits/schematify-baseline.md`
 * §8. 2 files are exempt: `./tokens.css` (its own header comment says why)
 * and this file itself (its positive-control tests below need literal color
 * strings as fixtures, or the scan would flag itself). Every other `.ts`,
 * `.tsx`, and `.css` file under this app must hold no literal color.
 *
 * "Literal color" is wider than hex: a first review of this file's original,
 * hex-only version pointed out it would miss `rgb()`/`rgba()`/`hsl()`/
 * `hsla()`/`color-mix()` and CSS named colors (`red`, `rebeccapurple`, …) —
 * every one of those bypasses `--kv-*` tokens exactly as a hex literal
 * would, and WIREFRAME-EXTRACT.md §1.3 records a drawn badge background
 * written in `rgba(...)`, so a later wave reaching for that form is a real
 * risk, not a hypothetical one. All 3 shapes are checked below.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..");
// tokens.css is the 1 documented color-literal exception (its own header
// says why). This file is the 2nd: its own positive-control tests below
// necessarily contain literal color strings as test fixtures, or the scan
// would flag itself.
const EXEMPT = new Set([
  join(APP_ROOT, "src", "tokens.css"),
  join(APP_ROOT, "src", "noLiteralHex.test.ts"),
]);

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/i;

/** The CSS Color Module Level 4 named-color keywords, minus `transparent`
 *  and `currentcolor` — both are structural keywords with no color of their
 *  own to route through a token, and both are already used legitimately in
 *  `shell/shell.css`. */
const NAMED_COLORS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

/**
 * Named colors are checked only where they sit in *value position* —
 * immediately after `:`, `(`, or `,` and immediately before `;`, `)`, `,`,
 * a quote, or whitespace, give or take whitespace of its own — rather than
 * as a bare word search. A bare search would flag this codebase's own prose
 * (a comment that says "blending `--kv-accent` toward white", or the CSS
 * property `white-space`) as if it were a color literal.
 */
const NAMED_COLOR = new RegExp(
  `[:(,]\\s*["']?(${NAMED_COLORS.join("|")})["']?(?=[\\s,;)'"]|$)`,
  "i",
);

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      out.push(...collectFiles(path));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * True for a line that is, or is part of, a comment — `//`, a block
 * comment's opener, or a continuation line inside one. Mutates `state` to
 * track whether a `/* … *\/` block is still open across lines.
 *
 * Used below to exclude comment lines from the named- and functional-color
 * checks only — prose describing a color is not a color literal. The hex
 * check stays comment-inclusive: a real hex value has no legitimate reason
 * to appear even in a comment in this app.
 */
function isCommentLine(line: string, state: { inBlock: boolean }): boolean {
  const trimmed = line.trim();
  if (state.inBlock) {
    if (trimmed.includes("*/")) state.inBlock = false;
    return true;
  }
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) state.inBlock = true;
    return true;
  }
  return false;
}

describe("no literal color in Schematify's UI", () => {
  const hexOffenders: Array<{ file: string; line: number; text: string }> = [];
  const otherOffenders: Array<{ file: string; line: number; text: string }> = [];

  for (const file of collectFiles(join(APP_ROOT, "src"))) {
    if (EXEMPT.has(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    const commentState = { inBlock: false };
    lines.forEach((line, index) => {
      if (HEX_COLOR.test(line)) {
        hexOffenders.push({ file, line: index + 1, text: line.trim() });
      }
      const inComment = isCommentLine(line, commentState);
      if (inComment) return;
      if (FUNCTIONAL_COLOR.test(line) || NAMED_COLOR.test(line)) {
        otherOffenders.push({ file, line: index + 1, text: line.trim() });
      }
    });
  }

  it("finds no #hex literal outside tokens.css", () => {
    expect(hexOffenders).toEqual([]);
  });

  it("finds no rgb()/hsl()/color-mix() or named-color literal outside tokens.css", () => {
    expect(otherOffenders).toEqual([]);
  });
});

describe("positive control — the widened patterns actually catch what they claim to", () => {
  it("catches a functional color form", () => {
    expect(FUNCTIONAL_COLOR.test("background: rgba(217, 138, 63, 0.14);")).toBe(true);
    expect(FUNCTIONAL_COLOR.test("color: hsl(210 40% 50%);")).toBe(true);
    expect(FUNCTIONAL_COLOR.test("background: color-mix(in srgb, red, blue);")).toBe(true);
  });

  it("catches a named color in value position", () => {
    expect(NAMED_COLOR.test("background: tomato;")).toBe(true);
    expect(NAMED_COLOR.test('style={{ color: "rebeccapurple" }}')).toBe(true);
  });

  it("does not flag transparent, or a color name inside a CSS property name or prose", () => {
    expect(NAMED_COLOR.test("background: transparent;")).toBe(false);
    expect(NAMED_COLOR.test("white-space: nowrap;")).toBe(false);
    expect(NAMED_COLOR.test(" * blending --kv-accent 18% toward white.")).toBe(false);
  });
});
