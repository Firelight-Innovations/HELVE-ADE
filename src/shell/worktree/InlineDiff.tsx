/**
 * A unified, read-only line diff.
 *
 * STAND-IN FOR `src/shell/diff/DiffView.tsx`, which the implementation plan
 * expects to exist and which is not on this branch: `DiffView` and its
 * `monaco-editor` dependency landed on `main` in 4b84238, six commits after
 * the base this branch was cut from (c08983c). Rather than copy that file in —
 * which would guarantee an add/add conflict when this branch merges — this
 * takes `DiffView`'s props verbatim (`{ original, modified, language? }`) so
 * swapping the two is one import line in `SourceControlView.tsx` and deleting
 * this file.
 *
 * Unified rather than side-by-side on purpose. The panel is 380px wide by
 * default (`--w-panel-default`), and two columns of code in half of that is
 * not readable — this is the form the width wants regardless of which
 * renderer is behind it.
 */
import { useMemo } from "react";
import "./worktree.css";

export interface InlineDiffProps {
  original: string;
  modified: string;
  /** Accepted and ignored — see `DiffViewProps`. Syntax highlighting is not
   *  wired up on either renderer yet. */
  language?: string;
}

type Sign = " " | "-" | "+";

interface Row {
  sign: Sign;
  text: string;
}

/**
 * Past this many lines on either side the O(n·m) table below stops being
 * something to run on a keystroke — a 5000-line file against itself is 25M
 * cells. Git's own diff drivers punt on large inputs too; this punts to
 * showing the new text with no marks rather than freezing the panel.
 */
const MAX_LINES = 1500;

export default function InlineDiff({ original, modified }: InlineDiffProps) {
  const rows = useMemo(() => {
    const a = splitLines(original);
    const b = splitLines(modified);
    if (a.length > MAX_LINES || b.length > MAX_LINES) {
      return b.map((text): Row => ({ sign: " ", text }));
    }
    return diffLines(a, b);
  }, [original, modified]);

  return (
    <div className="worktree__diff-body">
      {rows.map((row, i) => (
        <div key={i} className={`worktree__diff-line worktree__diff-line--${SIGN_CLASS[row.sign]}`}>
          <span className="worktree__diff-sign">{row.sign}</span>
          <span className="worktree__diff-text">{row.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

const SIGN_CLASS: Record<Sign, string> = { " ": "same", "-": "del", "+": "add" };

/**
 * A trailing newline is a line terminator, not an empty final line — splitting
 * on it directly would show every file as ending with a phantom blank row, and
 * make "added a trailing newline" look like "added an empty line".
 */
function splitLines(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n");
}

/**
 * Longest common subsequence over whole lines, walked back into a unified
 * list. The table is filled from the end so the walk runs forwards, which is
 * the order the rows are rendered in — the alternative fills forwards and
 * emits backwards, and then has to reverse.
 */
function diffLines(a: string[], b: string[]): Row[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j] ? dp[(i + 1) * w + (j + 1)] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ sign: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      rows.push({ sign: "-", text: a[i] });
      i++;
    } else {
      rows.push({ sign: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ sign: "-", text: a[i++] });
  while (j < m) rows.push({ sign: "+", text: b[j++] });
  return rows;
}
