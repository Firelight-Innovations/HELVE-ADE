/**
 * A diff you can write on: `DiffView` with the notes for that file under it,
 * and every call that changes one.
 *
 * Mounted instead of `DiffView` when the diff in front of the user is one an
 * agent produced. `DiffView` stays usable bare — `CommitGraph`'s history diffs
 * have nothing to annotate.
 *
 * Why the list is fetched per mounted diff rather than hoisted into
 * `WindowRoot` the way `useGitStatus` is, and why re-reading is the whole
 * update model: `docs/design-notes/shell-worktree.md`, under this path.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ReviewComment,
  ReviewControl,
  ReviewScope,
  ReviewSend,
  ReviewSendTarget,
} from "../contract";
import DiffView, { type DiffAnnotations } from "./DiffView";
import ReviewNotes from "./ReviewNotes";
import { commentsFor, decorations, unsent } from "./reviewComments";
import { formatComments } from "./reviewPrompt";
import "./annotatedDiff.css";

export interface AnnotatedDiffProps {
  original: string;
  modified: string;
  language?: string;
  renderSideBySide?: boolean;
  /** Repo-relative, as `GitFileChange.path` gives it. */
  path: string;
  /** Which of the three diffs this is — part of a note's identity, not a
   *  filter, so a staged note never surfaces against the unstaged view. */
  scope: ReviewScope;
  clusterId: string;
  control: ReviewControl;
  send: ReviewSend;
}

/** A range with nothing typed into it yet. */
interface Anchor {
  startLine: number;
  endLine: number;
}

export default function AnnotatedDiff({
  original,
  modified,
  language,
  renderSideBySide,
  path,
  scope,
  clusterId,
  control,
  send,
}: AnnotatedDiffProps) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState<Anchor>({ startLine: 1, endLine: 1 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards the same race `useGitStatus` guards: switch files twice quickly and
  // the first list can still resolve last, leaving notes for the wrong file on
  // screen against this one's line numbers.
  useEffect(() => {
    let live = true;
    control.list(clusterId).then(
      (next) => {
        if (live) setComments(next);
      },
      (reason: unknown) => {
        if (live) setError(reviewMessage(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [control, clusterId]);

  // A composer left open across a file switch would save its note against the
  // new file at the old file's line number, which is the one failure here that
  // silently produces a wrong answer rather than an error.
  useEffect(() => {
    setAnchor(null);
    setDraft("");
    setFocusedId(null);
    setReveal(null);
    setError(null);
  }, [path, scope]);

  const notes = useMemo(() => commentsFor(comments, path, scope), [comments, path, scope]);
  const marks = useMemo(() => decorations(notes), [notes]);
  const sendable = useMemo(() => unsent(notes), [notes]);

  /** Every mutation is this: run it, put the fresh list up, report a failure. */
  const run = useCallback(
    async (change: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await change();
        setComments(await control.list(clusterId));
        return true;
      } catch (reason: unknown) {
        setError(reviewMessage(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [control, clusterId],
  );

  const focus = useCallback((note: ReviewComment) => {
    setFocusedId(note.id);
    setReveal((previous) => ({ line: note.startLine, nonce: (previous?.nonce ?? 0) + 1 }));
  }, []);

  const submit = useCallback(async () => {
    if (anchor === null) return;
    const saved = await run(() =>
      control.add(clusterId, {
        path,
        scope,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
        body: draft,
      }),
    );
    // The draft survives a rejection on purpose. The refusals the backend can
    // give — an empty body, a range that is not one — are all things the person
    // can fix in the box that is still in front of them, and clearing it would
    // throw away the sentence they wrote to punish them for a bad line number.
    if (saved) {
      setAnchor(null);
      setDraft("");
    }
  }, [anchor, clusterId, control, draft, path, run, scope]);

  /**
   * Put the unsent notes for this file where an agent will see them, then stamp
   * them.
   *
   * Stamped *after* the text has landed, and only then, so a clipboard the
   * platform refused does not leave every note marked as delivered. The stamp
   * itself is allowed to fail quietly — by that point the agent has the notes,
   * and an error saying otherwise would be the wrong answer.
   */
  const sendNotes = useCallback(
    async (target: ReviewSendTarget) => {
      if (sendable.length === 0) return;
      const text = formatComments(sendable);

      setBusy(true);
      setError(null);
      try {
        if (target === "terminal") {
          if (send.terminalId === null) return;
          send.toTerminal(send.terminalId, text);
        } else {
          await send.toClipboard(text);
        }
      } catch (reason: unknown) {
        setError(reviewMessage(reason));
        setBusy(false);
        return;
      }
      setBusy(false);

      await run(() =>
        control.markSent(
          clusterId,
          sendable.map((note) => note.id),
        ),
      );
    },
    [clusterId, control, run, send, sendable],
  );

  const annotations: DiffAnnotations = useMemo(
    () => ({
      marks,
      active: anchor ?? activeRangeOf(notes, focusedId),
      onAnchor: (next) => {
        setFocusedId(null);
        setAnchor(next);
        setDraft("");
      },
      onPick: (mark) => {
        setAnchor(null);
        const first = mark.comments[0];
        if (first) focus(first);
      },
      onSelection: setSelection,
      reveal,
    }),
    [anchor, focus, focusedId, marks, notes, reveal],
  );

  return (
    <div className="annotated">
      <div className="annotated__diff">
        <DiffView
          original={original}
          modified={modified}
          language={language}
          renderSideBySide={renderSideBySide}
          annotations={annotations}
        />
      </div>
      <ReviewNotes
        notes={notes}
        focusedId={focusedId}
        anchor={anchor}
        draft={draft}
        sendable={sendable}
        terminalId={send.terminalId}
        busy={busy}
        error={error}
        onDraft={setDraft}
        onSubmit={() => void submit()}
        onCancel={() => {
          setAnchor(null);
          setDraft("");
        }}
        onStartNote={() => {
          setFocusedId(null);
          setAnchor(selection);
          setDraft("");
        }}
        onFocus={focus}
        onEdit={(note, body) => void run(() => control.update(clusterId, note.id, body))}
        onResolve={(note, resolved) =>
          void run(() => control.resolve(clusterId, note.id, resolved))
        }
        onRemove={(note) => {
          if (note.id === focusedId) setFocusedId(null);
          void run(() => control.remove(clusterId, note.id));
        }}
        onSend={(target) => void sendNotes(target)}
      />
    </div>
  );
}

/** The range the diff should wash: whichever note the list is focused on. */
function activeRangeOf(notes: ReviewComment[], focusedId: string | null): Anchor | null {
  if (focusedId === null) return null;
  const note = notes.find((n) => n.id === focusedId);
  return note ? { startLine: note.startLine, endLine: note.endLine } : null;
}

/**
 * What a rejected `ReviewControl` call is carrying.
 *
 * The same three shapes `gitMessage` handles in `worktree/useGitStatus.ts`, and
 * a deliberate copy of it rather than an import: a region may not import
 * another region's source (STANDARDS.md §1.2), and five lines is a much smaller
 * thing to duplicate than the module that would have to move up to
 * `src/shell/` to be shared.
 */
function reviewMessage(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
