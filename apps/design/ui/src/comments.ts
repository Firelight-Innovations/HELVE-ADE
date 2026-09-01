/**
 * Comments as this app reads them: the shapes the backend stores, and the pure
 * decisions about how a list of them is shown.
 *
 * The types mirror `src-tauri/src/design_comments.rs` and are restated rather
 * than imported, for the reason `rpc.ts` gives. Everything else here is a
 * function of a comment and nothing else, so the ordering and the wording can be
 * tested without a backend — `useComments` owns the fetching, this owns what the
 * answer means. `docs/design-notes/design-comments.md` has the reasoning.
 */

/** Whose turn it is. Mirrors `design_comments::Status`. */
export type Status = "open" | "question" | "resolved";

/** Mirrors `design_comments::Author`. */
export type Author = "user" | "agent";

export interface Remark {
  author: Author;
  text: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export interface CommentPage {
  url: string;
  title: string;
}

export interface CommentElement {
  tag: string;
  selector: string;
  ancestors: string;
  text: string;
  html: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
}

/** Mirrors `design_comments::Comment`. */
export interface Comment {
  id: string;
  status: Status;
  page: CommentPage;
  element: CommentElement;
  request: string;
  thread: Remark[];
  created: number;
  updated: number;
  hasShot: boolean;
}

/**
 * How urgent each status is to the person looking at the list.
 *
 * A question is first because it is the only state that is *blocked on them*.
 * Open is second — the agent has it, but the request is still live. Resolved is
 * last and is only there so somebody can check what was already asked.
 */
const URGENCY: Record<Status, number> = { question: 0, open: 1, resolved: 2 };

/** What the badge on a row says. Written from the reader's side: "you" is the
 *  person in the app, not the agent. */
export const STATUS_WORDING: Record<Status, string> = {
  question: "Needs you",
  open: "With the agent",
  resolved: "Done",
};

/** Whether a comment was left somewhere other than the page now in the frame.
 *  Used to *label* a row, never to hide one — the two URLs reach this app by
 *  different routes and agree in the ordinary case, not in every case. */
export function elsewhere(comment: Comment, showing: string | null): boolean {
  return showing !== null && comment.page.url !== showing;
}

/**
 * The order a person reads them in: what is blocked on them, then what is live,
 * then history — and inside each group, whatever moved most recently.
 *
 * Not the order the backend returns, which is oldest first because that is the
 * order an *agent* should work through them in. The two readers want opposite
 * things and neither is wrong, so the sort happens where it is displayed.
 */
export function forDisplay(comments: readonly Comment[]): Comment[] {
  return [...comments].sort(
    (a, b) => URGENCY[a.status] - URGENCY[b.status] || b.updated - a.updated,
  );
}

/** The question a comment is waiting on an answer to, if it is waiting on one.
 *  Reads the *thread* rather than trusting the status alone: the reply box this
 *  drives has to show what is being replied to, and a `question` whose last word
 *  came from the user is a state the backend does not produce. */
export function pendingQuestion(comment: Comment): string | null {
  if (comment.status !== "question") return null;
  const last = comment.thread.at(-1);
  return last?.author === "agent" ? last.text : null;
}

/** A one-line name for the element a comment is against, for a row heading. */
export function elementLabel(comment: Comment): string {
  return comment.element.selector || comment.element.tag;
}

/** What closing a comment from the app records on its thread. A fixed sentence
 *  rather than a box to fill in; the *agent's* resolutions do carry a note, and
 *  `resolve_comment` requires one, because that is the direction where the other
 *  party has no other way of finding out what happened. */
export const CLOSED_BY_HAND = "Closed in Design Mode.";
