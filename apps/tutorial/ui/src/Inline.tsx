/**
 * The two inline spans a tutorial paragraph is allowed: `**bold**` and
 * `` `code` ``.
 *
 * A ten-line parser rather than a Markdown dependency, because that is the
 * whole of the grammar and it does not nest. `marked` would be 40 KB in every
 * app bundle to support a syntax this file deliberately refuses — see
 * `content/blocks.ts` for why the block level is typed data instead.
 */

const SPAN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

/**
 * Split a paragraph into runs and draw each one.
 *
 * Keyed by index, which is safe here in a way it usually is not: the array is
 * derived from a constant string and never reorders. Unmatched `**` or a lone
 * backtick falls through as literal text rather than throwing — a tutorial with
 * a typo in it should render with the typo visible, not fail to render.
 */
export default function Inline({ children }: { children: string }) {
  const runs = children.split(SPAN).filter((run) => run !== "");

  return (
    <>
      {runs.map((run, index) => {
        if (run.startsWith("**") && run.endsWith("**")) {
          return <strong key={index}>{run.slice(2, -2)}</strong>;
        }
        if (run.startsWith("`") && run.endsWith("`")) {
          return (
            <code key={index} className="tut__code-span">
              {run.slice(1, -1)}
            </code>
          );
        }
        return <span key={index}>{run}</span>;
      })}
    </>
  );
}

/**
 * A chord, drawn as the keys it is.
 *
 * Split on `+` so each key gets its own cap, with the separators kept as text
 * between them — "Ctrl+Shift+P" is three keys and two plus signs, and drawing
 * it as one long cap reads as a single key with a strange name.
 */
export function Keys({ chord }: { chord: string }) {
  const keys = chord.split("+");

  return (
    <span className="tut__chord">
      {keys.map((key, index) => (
        <span key={index}>
          {index > 0 && <span className="tut__chord-plus">+</span>}
          <kbd className="tut__key">{key}</kbd>
        </span>
      ))}
    </span>
  );
}
