/**
 * Selecting and describing review notes — everything about a list of them that
 * is a calculation rather than a render.
 *
 * The model is `src-tauri/src/review/` and every mutation is a command; nothing
 * here changes anything. What lives here is the questions the surfaces ask of a
 * list they were handed.
 *
 * Separated from the components for the reason STANDARDS.md §8.3 gives: the
 * shell's runner is `node` with no DOM, so a pure module is the only part of a
 * region that can be covered — and an off-by-one in [`decorations`] draws a
 * marker against the wrong line of somebody's code.
 */
import type { ReviewComment, ReviewScope } from "../contract";

/** Which lines carry notes, and how many each. What the editor draws a marker per. */
export interface LineDecoration {
  startLine: number;
  endLine: number;
  /** Every note anchored to exactly this range, in the order they were written. */
  comments: ReviewComment[];
}

/**
 * The notes for one file in one diff, in file order then age.
 *
 * Filtered on scope as well as path: a note is anchored to one of the three
 * diffs rather than to the file (`review::ReviewScope`), and an unstaged note
 * shown against the staged view would point at a line measured from different
 * text.
 */
export function commentsFor(
  comments: readonly ReviewComment[],
  path: string,
  scope: ReviewScope,
): ReviewComment[] {
  return comments
    .filter((c) => c.path === path && c.scope === scope)
    .sort((a, b) => a.startLine - b.startLine || a.createdAt - b.createdAt);
}

/**
 * One entry per distinct line range, so two notes on the same line produce one
 * marker rather than two stacked on each other.
 *
 * Keyed on the pair rather than the start alone: a note on lines 3-9 and a note
 * on line 3 are anchored to different code, and merging them would let a click
 * on the marker reveal a note the marker is not about.
 */
export function decorations(comments: readonly ReviewComment[]): LineDecoration[] {
  const byRange = new Map<string, LineDecoration>();

  for (const comment of comments) {
    const key = `${comment.startLine}:${comment.endLine}`;
    const existing = byRange.get(key);
    if (existing) {
      existing.comments.push(comment);
      continue;
    }
    byRange.set(key, {
      startLine: comment.startLine,
      endLine: comment.endLine,
      comments: [comment],
    });
  }

  return [...byRange.values()].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

/**
 * The marker covering a line, if one does — the first, when ranges overlap.
 *
 * Named rather than written twice as a `.find`, because its two callers have to
 * agree: `DiffView`'s click handler asks it whether to open what is there, and
 * the hover affordance asks it to stay out of a drawn marker's way. They
 * disagreed once, and the design note records what that looked like.
 */
export function markAtLine(
  marks: readonly LineDecoration[],
  line: number,
): LineDecoration | undefined {
  return marks.find((mark) => line >= mark.startLine && line <= mark.endLine);
}

/**
 * Notes the agent has not been given yet.
 *
 * Unsent, not unresolved: those are different questions and the send buttons
 * ask this one. A note the person resolved themselves without ever sending it
 * is still unsent, and still goes in the batch — resolving is a mark about the
 * *work*, and nothing here is clever enough to second-guess it.
 */
export function unsent(comments: readonly ReviewComment[]): ReviewComment[] {
  return comments.filter((c) => c.sentAt === undefined);
}

/** Notes still standing as work: what the panel counts in its header. */
export function unresolved(comments: readonly ReviewComment[]): ReviewComment[] {
  return comments.filter((c) => !c.resolved);
}

/** `Line 12`, or `Lines 12-18`. The sentence form, not the agent's — see `reviewPrompt.ts`. */
export function describeRange(comment: ReviewComment): string {
  return comment.startLine === comment.endLine
    ? `Line ${comment.startLine}`
    : `Lines ${comment.startLine}-${comment.endLine}`;
}

/** `1 note` / `4 notes`, so no caller writes the plural rule out again. */
export function countLabel(count: number): string {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

/**
 * The line range a new note would be anchored to, given where the caret or the
 * selection is.
 *
 * A selection that ends at column 1 of a line is trimmed back to the line
 * above. Dragging a selection down through a file lands the cursor at the start
 * of the *next* line the moment it crosses the boundary, so a person who
 * selected three lines by dragging would otherwise have a note anchored to
 * four — and the fourth is the one they can see they did not select.
 *
 * A selection cannot trim back past its own start: selecting nothing at column 1
 * is a caret, and a caret anchors to the line it is on.
 */
export function anchorFor(selection: {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}): { startLine: number; endLine: number } {
  const trimmed =
    selection.endLineNumber > selection.startLineNumber && selection.endColumn === 1
      ? selection.endLineNumber - 1
      : selection.endLineNumber;

  return { startLine: selection.startLineNumber, endLine: trimmed };
}
