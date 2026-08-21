/**
 * Turning review notes into the text an agent is handed.
 *
 * Adapted from `src/shared/diff-comments-format.ts` in `stablyai/orca`, which is
 * MIT-licensed, © Stably AI. The three-line block below and its escaping rule
 * are that file's; the names, the scope line and the multi-note preamble are
 * this one's.
 *
 * **This format is a contract**, and that is the whole reason it lives in its
 * own module with its own tests rather than inline in a click handler. On one
 * side is a person writing prose in a panel; on the other is a coding agent
 * reading it out of a terminal or a paste buffer, with no schema between them
 * but the shape of these lines. It has to stay deterministic — the same notes
 * always produce the same string — and it has to survive being pasted into a
 * shell.
 *
 * Surviving a shell is what [`escapeBody`] is for and why the body ends up on
 * one line inside quotes: a newline in a pasted string is a submitted line, so
 * an unescaped two-paragraph note would hand the agent its first paragraph and
 * run the second as a command.
 */
import type { ReviewComment } from "../contract";

/**
 * The body, flattened to a single quoted line.
 *
 * Backslash first, or every escape added after it gets escaped a second time.
 * `\r` before `\n` for the same ordering reason on a Windows-authored note.
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

/**
 * Which diff the note was written against, in words an agent can act on.
 *
 * Included because the same path at the same line means different code in each
 * of the three, and an agent told only "line 12 of src/a.rs" would go looking in
 * the working tree even when the note was about what the branch changed.
 */
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
 * Several notes as one message, blank-line separated, with a sentence saying
 * what they are.
 *
 * The preamble is the one thing here Orca does not do, and it earns its place
 * because of where this text lands. Orca has an agent chat pane and can put a
 * batch of notes into it as a labelled message; HELVE has a terminal, so this
 * string arrives as raw typing at whatever prompt is sitting there, with
 * nothing around it to say that a list of file-and-line blocks is a review
 * rather than a paste accident.
 *
 * Empty in, empty out — the caller renders a disabled button rather than
 * sending a preamble with nothing under it.
 */
export function formatComments(comments: readonly ReviewComment[]): string {
  if (comments.length === 0) return "";

  const blocks = comments.map(formatComment).join("\n\n");
  if (comments.length === 1) {
    return `Here is a review note on the code you just changed. Please address it.\n\n${blocks}`;
  }
  return `Here are ${comments.length} review notes on the code you just changed. Please address each one.\n\n${blocks}`;
}
