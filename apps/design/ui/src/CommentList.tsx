/**
 * The comments on this machine, and the two turns a person can take on one.
 *
 * Split from `App.tsx` because it is the half of the panel that has nothing to
 * do with the frame: it draws whether or not anything is picked, whether or not
 * a page is loaded, and it is the surface an agent's answer arrives on. What
 * order the rows come in and what a status is called are in `comments.ts`, so
 * this file is markup and two text boxes.
 */
import { useState } from "react";
import {
  STATUS_WORDING,
  elementLabel,
  elsewhere,
  forDisplay,
  pendingQuestion,
  type Comment,
} from "./comments";

interface CommentListProps {
  comments: readonly Comment[];
  /** The page in the frame, so a comment left on another one can say so. */
  showing: string | null;
  onReply: (id: string, text: string) => void;
  onResolve: (id: string) => void;
  onForget: (id: string) => void;
}

export default function CommentList({
  comments,
  showing,
  onReply,
  onResolve,
  onForget,
}: CommentListProps) {
  const ordered = forDisplay(comments);

  if (ordered.length === 0) {
    return (
      <p className="design__nocomments">
        No comments yet. Pick an element and describe the change you want — an agent reads them over
        MCP, with no copying and pasting.
      </p>
    );
  }

  return (
    <ul className="design__comments">
      {ordered.map((comment) => (
        <CommentRow
          key={comment.id}
          comment={comment}
          showing={showing}
          onReply={onReply}
          onResolve={onResolve}
          onForget={onForget}
        />
      ))}
    </ul>
  );
}

interface CommentRowProps extends Omit<CommentListProps, "comments"> {
  comment: Comment;
}

function CommentRow({ comment, showing, onReply, onResolve, onForget }: CommentRowProps) {
  const [answer, setAnswer] = useState("");
  const question = pendingQuestion(comment);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    if (answer.trim() === "") return;
    onReply(comment.id, answer);
    setAnswer("");
  };

  return (
    <li className="design__comment" data-status={comment.status}>
      <header className="design__commenthead">
        <span className="design__commentid">{comment.id}</span>
        <span className="design__commentwhere">{elementLabel(comment)}</span>
        <span className="design__commentstatus">{STATUS_WORDING[comment.status]}</span>
      </header>

      {elsewhere(comment, showing) ? (
        <p className="design__commentpage">{comment.page.url}</p>
      ) : null}

      <p className="design__commentrequest">{comment.request}</p>

      {comment.thread.length > 0 ? (
        <ol className="design__thread">
          {comment.thread.map((remark, at) => (
            // The index is the key because a thread is append-only and a remark
            // has no id of its own — nothing here reorders, so there is nothing
            // for a positional key to get wrong.
            <li key={at} className="design__remark" data-author={remark.author}>
              <span className="design__remarkwho">
                {remark.author === "agent" ? "Agent" : "You"}
              </span>
              {remark.text}
            </li>
          ))}
        </ol>
      ) : null}

      {question ? (
        <form className="design__answer" onSubmit={send}>
          <textarea
            className="design__answerbox"
            value={answer}
            rows={2}
            placeholder="Answer it…"
            aria-label={`Answer the question on comment ${comment.id}`}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <button className="design__go" type="submit" disabled={answer.trim() === ""}>
            Reply
          </button>
        </form>
      ) : null}

      <div className="design__commentactions">
        {comment.status === "resolved" ? null : (
          <button className="design__plain" type="button" onClick={() => onResolve(comment.id)}>
            Close
          </button>
        )}
        <button className="design__plain" type="button" onClick={() => onForget(comment.id)}>
          Delete
        </button>
      </div>
    </li>
  );
}
