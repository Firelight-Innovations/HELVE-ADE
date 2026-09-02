/**
 * Subsequence matching with a score, for the command palette's field.
 *
 * Separate from `registry.ts` because it knows nothing about a command — it
 * scores one string against another, and every function here is pure, so the
 * ranking is testable without a DOM (STANDARDS.md §8.3).
 *
 * Each token is scanned greedily from every anchor its first character offers,
 * keeping the best — not the full alignment search fzf runs. A palette's
 * haystack is a menu: around sixty short, word-shaped labels rebuilt per
 * keystroke, where the anchor is what a full search would mostly be recovering
 * anyway. `matchToken` has the case that made the cheaper leftmost-only
 * version wrong.
 */

/** A hit: how good, and which characters to draw as matched. */
export interface FuzzyMatch {
  score: number;
  /** Indices into the haystack, ascending and without repeats. */
  positions: number[];
}

/** What ends a word, so the character after it starts one. */
const SEPARATORS = new Set([" ", "-", "_", "/", ".", ":", "\\", "(", "…"]);

const START_BONUS = 18;
const WORD_BONUS = 12;
const CAMEL_BONUS = 8;
const CONSECUTIVE_BONUS = 6;
const CHAR_SCORE = 1;

/** Charged per skipped character between two matches, up to `GAP_CAP` of them —
 *  uncapped, one long label would outweigh every bonus on the row. */
const GAP_PENALTY = 1;
const GAP_CAP = 6;

/** Breaks ties toward the shorter label, which is the more specific one:
 *  `Save` before `Save Current Layout…` for the needle `save`. */
const LENGTH_TIEBREAK = 0.05;

/** Where in the haystack a matched character is worth extra. */
function placeBonus(at: number, raw: string): number {
  if (at === 0) return START_BONUS;
  const before = raw[at - 1] ?? "";
  if (SEPARATORS.has(before)) return WORD_BONUS;
  const here = raw[at] ?? "";
  if (here !== here.toLowerCase() && before === before.toLowerCase()) return CAMEL_BONUS;
  return 0;
}

/** A greedy left-to-right scan of one token, anchored at `start`. */
function scanFrom(token: string, lower: string, raw: string, start: number): FuzzyMatch | null {
  const positions: number[] = [];
  let score = 0;
  let from = start;

  for (const char of token) {
    const at = lower.indexOf(char, from);
    if (at === -1) return null;

    score += CHAR_SCORE + placeBonus(at, raw);
    const previous = positions[positions.length - 1];
    if (previous !== undefined) {
      if (at === previous + 1) score += CONSECUTIVE_BONUS;
      else score -= Math.min(at - previous - 1, GAP_CAP) * GAP_PENALTY;
    }

    positions.push(at);
    from = at + 1;
  }

  return { score, positions };
}

/**
 * The best-scoring placement of one token: every occurrence of its first
 * character is tried as an anchor and the highest score wins.
 *
 * Anchoring only at the leftmost occurrence — which this did first — is what a
 * plain greedy scan does, and it puts the score somewhere arbitrary rather than
 * somewhere good: `in` inside `Terminal: Zoom In View` matched the `in` of
 * "Terminal", collected a consecutive-pair bonus for it, and outscored the same
 * needle against `View: Zoom In`, where the leftmost `i` is the one in "View"
 * and the `n` is eleven characters away. The label a person would pick came
 * second. Trying each anchor costs one more pass over a forty-character string
 * per token, which is nothing against a menu-sized list.
 */
function matchToken(token: string, lower: string, raw: string): FuzzyMatch | null {
  const first = token[0];
  if (first === undefined) return null;

  let best: FuzzyMatch | null = null;
  for (let at = lower.indexOf(first); at !== -1; at = lower.indexOf(first, at + 1)) {
    const hit = scanFrom(token, lower, raw, at);
    if (hit !== null && (best === null || hit.score > best.score)) best = hit;
  }
  return best;
}

/**
 * Score `needle` against `haystack`, or `null` when it does not match.
 *
 * The needle is split on whitespace and every run has to match somewhere,
 * independently — so `view zoom` finds `View: Zoom In` and so does `zoom
 * view`. Requiring one left-to-right subsequence instead would mean the order
 * words are typed in decides whether a command can be found, which is not
 * something anybody typing into a palette is thinking about.
 *
 * An empty needle matches everything at zero, so the caller can hand the raw
 * field text through without a special case for the palette's opening state.
 */
export function fuzzyMatch(needle: string, haystack: string): FuzzyMatch | null {
  const tokens = needle.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, positions: [] };

  const lower = haystack.toLowerCase();
  const positions = new Set<number>();
  let score = 0;

  for (const token of tokens) {
    const hit = matchToken(token, lower, haystack);
    if (hit === null) return null;
    score += hit.score;
    for (const at of hit.positions) positions.add(at);
  }

  return {
    score: score - haystack.length * LENGTH_TIEBREAK,
    positions: [...positions].sort((a, b) => a - b),
  };
}

/** A stretch of a label, drawn as matched or not. */
export interface Run {
  text: string;
  hit: boolean;
}

/**
 * `text` cut into alternating matched and unmatched stretches.
 *
 * Runs rather than one element per character, which is the shape this replaced:
 * a sixty-row list of forty-character labels is 2400 nodes rebuilt on every
 * keystroke, where the runs are rarely more than five. Pure, so what the rows
 * highlight is checkable without rendering one.
 */
export function matchRuns(text: string, positions: number[]): Run[] {
  const hits = new Set(positions);
  const runs: Run[] = [];

  for (let at = 0; at < text.length; at++) {
    const hit = hits.has(at);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.hit === hit) last.text += text[at];
    else runs.push({ text: text[at] ?? "", hit });
  }

  return runs;
}
