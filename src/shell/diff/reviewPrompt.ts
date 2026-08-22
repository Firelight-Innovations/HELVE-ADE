/**
 * Turning review notes into the text an agent is handed.
 *
 * Adapted from `src/shared/diff-comments-format.ts` in `stablyai/orca`, which
 * is MIT-licensed, © Stably AI. The block below and its escaping rule are that
 * file's; the scope line and the multi-note preamble are this one's. `NOTICE`
 * carries the attribution in full.
 *
 * **This format is a contract** between a person writing prose in a panel and
 * an agent reading it out of a terminal, with no schema between them but the
 * shape of these lines — which is why it lives in its own module with its own
 * tests rather than inline in a click handler. The full argument, and what
 * pasting into a shell demands of it, is in
 * `docs/design-notes/shell-worktree.md` under this path.
 */
import type { ReviewComment } from "../contract";

/**
 * The body, flattened to a single quoted line — because a newline in a pasted
 * string is a submitted line, so a two-paragraph note would otherwise hand the
 * agent its first paragraph and run the second as a command.
 *
 * Backslash first, or every escape added after it gets escaped a second time.
 */
function escapeBody(body: string): string {
  return body
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/** `Line: 12`, or `Lines: 12-18` when the note covers a range. */
function locationLine(comment: ReviewComment): string {
  return comment.startLine === comment.endLine
    ? `Line: ${comment.startLine}`
    : `Lines: ${comment.startLine}-${comment.endLine}`;
}

/** Which diff the note was written against, in words an agent can act on — the
 *  same line in the same file is different code in each of the three. */
function scopeLine(comment: ReviewComment): string {
  const where =
    comment.scope === "staged"
      ? "the staged changes"
      : comment.scope === "branch"
        ? "this branch's changes since it forked"
        : "the uncommitted changes";
  return `Diff: ${where}`;
}

/** One note as the four lines an agent reads. */
export function formatComment(comment: ReviewComment): string {
  return [
    `File: ${comment.path}`,
    locationLine(comment),
    scopeLine(comment),
    `User comment: "${escapeBody(comment.body)}"`,
  ].join("\n");
}

/**
 * Several notes as one message, blank-line separated, behind a sentence saying
 * what they are. Why that sentence exists when Orca needs none is in the design
 * note named in the file header.
 *
 * Empty in, empty out — the caller draws a disabled button rather than sending
 * a preamble with nothing under it.
 */
export function formatComments(comments: readonly ReviewComment[]): string {
  if (comments.length === 0) return "";

  const blocks = comments.map(formatComment).join("\n\n");
  if (comments.length === 1) {
    return `Here is a review note on the code you just changed. Please address it.\n\n${blocks}`;
  }
  return `Here are ${comments.length} review notes on the code you just changed. Please address each one.\n\n${blocks}`;
}
