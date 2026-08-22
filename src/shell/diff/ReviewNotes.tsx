/**
 * The notes on the open diff, drawn under it: a header that counts them and
 * sends them, a composer, and one card per note.
 *
 * **Under the diff rather than inline in it**, which is the one substantial
 * departure from the review host this feature is modelled on. Orca floats a
 * card in a Monaco view zone at the commented line, and in a wide editor that
 * is plainly the better answer — the note sits against the code it is about.
 * This diff is mounted in a panel whose default width is 380 pixels
 * (`--w-panel-default`), where a card of prose inserted between two lines of
 * code pushes most of the visible diff off screen and takes the surrounding
 * lines — the ones that give the note its meaning — with it. A list below keeps
 * both readable at that width, and the margin marker plus
 * `DiffAnnotations.reveal` are what keep a note and its line findable from each
 * other.
 *
 * Presentational: everything here is props, and every mutation is somebody
 * else's. `AnnotatedDiff.tsx` owns the state and the calls.
 */
import { useEffect, useRef, useState } from "react";
import type { ReviewComment, ReviewSendTarget } from "../contract";
import { countLabel, describeRange } from "./reviewComments";
import "./reviewNotes.css";

export interface ReviewNotesProps {
  /** Already filtered to this file and this diff, in file order. */
  notes: ReviewComment[];
  /** The note the diff is currently highlighting, if any. */
  focusedId: string | null;
  /** The range a new note would be anchored to, or `null` for no composer. */
  anchor: { startLine: number; endLine: number } | null;
  draft: string;
  /** Notes on this file the agent has not been given yet. */
  sendable: ReviewComment[];
  /** `null` when the cluster's band has no terminal — the button stays visible
   *  and disabled, because why it cannot be used is worth showing. */
  terminalId: string | null;
  busy: boolean;
  error: string | null;
  onDraft: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Start a note on whatever the editor's caret or selection covers. */
  onStartNote: () => void;
  onFocus: (note: ReviewComment) => void;
  onEdit: (note: ReviewComment, body: string) => void;
  onResolve: (note: ReviewComment, resolved: boolean) => void;
  onRemove: (note: ReviewComment) => void;
  onSend: (target: ReviewSendTarget) => void;
}

export default function ReviewNotes({
  notes,
  focusedId,
  anchor,
  draft,
  sendable,
  terminalId,
  busy,
  error,
  onDraft,
  onSubmit,
  onCancel,
  onStartNote,
  onFocus,
  onEdit,
  onResolve,
  onRemove,
  onSend,
}: ReviewNotesProps) {
  return (
    <div className="notes">
      <div className="notes__head">
        <span className="notes__count">
          {notes.length === 0 ? "No notes" : countLabel(notes.length)}
        </span>
        <span className="notes__spacer" />
        <button type="button" className="notes__action" disabled={busy} onClick={onStartNote}>
          Add note
        </button>
        <button
          type="button"
          className="notes__action"
          disabled={busy || sendable.length === 0}
          title={
            sendable.length === 0
              ? "Every note on this file has been sent already"
              : `Copy ${countLabel(sendable.length)} to the clipboard`
          }
          onClick={() => onSend("clipboard")}
        >
          Copy
        </button>
        <button
          type="button"
          className="notes__action notes__action--primary"
          disabled={busy || sendable.length === 0 || terminalId === null}
          title={
            terminalId === null
              ? "This cluster has no terminal open to send to"
              : sendable.length === 0
                ? "Every note on this file has been sent already"
                : `Type ${countLabel(sendable.length)} at the terminal`
          }
          onClick={() => onSend("terminal")}
        >
          Send to terminal
        </button>
      </div>

      {error !== null && <div className="notes__error">{error}</div>}

      {anchor !== null && (
        <Composer
          anchor={anchor}
          draft={draft}
          busy={busy}
          onDraft={onDraft}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}

      {notes.length === 0 && anchor === null ? (
        <p className="notes__empty">
          Click the margin beside a line, or select lines and use Add note.
        </p>
      ) : (
        <div className="notes__list">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              focused={note.id === focusedId}
              busy={busy}
              onFocus={onFocus}
              onEdit={onEdit}
              onResolve={onResolve}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The box a new note is typed into.
 *
 * Focused on mount, because it is only ever mounted in response to somebody
 * asking for it — a click in the margin or on Add note — and making them click
 * a second time to type would be the kind of small tax that stops people
 * leaving notes at all.
 */
function Composer({
  anchor,
  draft,
  busy,
  onDraft,
  onSubmit,
  onCancel,
}: {
  anchor: { startLine: number; endLine: number };
  draft: string;
  busy: boolean;
  onDraft: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    box.current?.focus();
  }, [anchor.startLine, anchor.endLine]);

  return (
    <div className="notes__composer">
      <div className="notes__where">
        {anchor.startLine === anchor.endLine
          ? `Line ${anchor.startLine}`
          : `Lines ${anchor.startLine}-${anchor.endLine}`}
      </div>
      <textarea
        ref={box}
        className="notes__box"
        placeholder="What should the agent change here?"
        rows={3}
        value={draft}
        disabled={busy}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => onComposerKey(e, onSubmit, onCancel)}
      />
      <div className="notes__composer-row">
        <span className="notes__hint">Ctrl+Enter to save</span>
        <span className="notes__spacer" />
        <button type="button" className="notes__action" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="notes__action notes__action--primary"
          disabled={busy || draft.trim() === ""}
          onClick={onSubmit}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * Ctrl+Enter saves and Escape cancels, in a textarea where plain Enter has to
 * stay a newline — a review note is prose and routinely runs to a paragraph.
 *
 * `stopPropagation` on Escape so closing the composer does not also close the
 * diff behind it: `SourceControlView` has its own Escape handling, and one key
 * press dismissing two things is the kind of bug that reads as the app losing
 * the user's work.
 */
function onComposerKey(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  onSubmit: () => void,
  onCancel: () => void,
) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    onSubmit();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }
}

/**
 * One note: where it is, what it says, and what can be done to it.
 *
 * Edit mode is local rather than lifted, because a half-typed edit is not a
 * fact anything outside this card needs — and keeping it here means switching
 * files throws the draft away with the card, which is the honest outcome for
 * text nobody saved.
 */
function NoteCard({
  note,
  focused,
  busy,
  onFocus,
  onEdit,
  onResolve,
  onRemove,
}: {
  note: ReviewComment;
  focused: boolean;
  busy: boolean;
  onFocus: (note: ReviewComment) => void;
  onEdit: (note: ReviewComment, body: string) => void;
  onResolve: (note: ReviewComment, resolved: boolean) => void;
  onRemove: (note: ReviewComment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);

  const classes = ["notes__card"];
  if (focused) classes.push("notes__card--focused");
  if (note.resolved) classes.push("notes__card--resolved");

  return (
    <div className={classes.join(" ")}>
      <div className="notes__card-head">
        <button
          type="button"
          className="notes__where notes__where--button"
          title="Show this line in the diff"
          onClick={() => onFocus(note)}
        >
          {describeRange(note)}
        </button>
        <span className="notes__spacer" />
        {note.sentAt !== undefined && (
          <span className="notes__tag" title="This note has been given to an agent">
            sent
          </span>
        )}
        <input
          type="checkbox"
          className="notes__check"
          checked={note.resolved}
          disabled={busy}
          aria-label={note.resolved ? "Mark unresolved" : "Mark resolved"}
          title={note.resolved ? "Mark unresolved" : "Mark resolved"}
          onChange={() => onResolve(note, !note.resolved)}
        />
      </div>

      {editing ? (
        <>
          <textarea
            className="notes__box"
            rows={3}
            value={body}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) =>
              onComposerKey(
                e,
                () => {
                  onEdit(note, body);
                  setEditing(false);
                },
                () => {
                  setBody(note.body);
                  setEditing(false);
                },
              )
            }
          />
          <div className="notes__composer-row">
            <span className="notes__spacer" />
            <button
              type="button"
              className="notes__action"
              disabled={busy}
              onClick={() => {
                setBody(note.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="notes__action notes__action--primary"
              disabled={busy || body.trim() === ""}
              onClick={() => {
                onEdit(note, body);
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="notes__body">{note.body}</p>
          <div className="notes__card-foot">
            <button
              type="button"
              className="notes__link"
              disabled={busy}
              onClick={() => {
                setBody(note.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="notes__link notes__link--danger"
              disabled={busy}
              onClick={() => onRemove(note)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
