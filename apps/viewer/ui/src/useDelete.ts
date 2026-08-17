/**
 * Deleting something, with the question that has to come first.
 *
 * Both places that can start a delete — a row in the tree, a chip in the tab
 * strip — need the identical sequence: ask, count what is at stake, call the
 * backend, close whatever tabs the file leaves behind, and report a failure in
 * a way the user can act on. That sequence is here once. `NoticeBar` is the
 * only thing either caller has to render.
 *
 * ## What the confirmation is careful about
 *
 * - **It names the file.** "Are you sure?" on its own is a dialog people learn
 *   to dismiss without reading.
 * - **It says where the file goes**, from what the backend reports rather than
 *   an assumption: `files/delete` moves to the Recycle Bin and refuses when it
 *   cannot. If that changes, `Deleted.trashed` does, and so does this sentence.
 * - **It counts a folder's contents** before asking, because a recursive delete
 *   is an amount the user cannot see from the row they right-clicked.
 * - **It names unsaved work by file.** Deleting a file with unsaved changes
 *   discards them, and that must never be a surprise afterwards.
 * - **Cancel is first, and `NoticeBar` focuses it.** Delete is marked
 *   destructive, drawn in `--err`, and last. Return cancels; Escape cancels.
 * - **It can be switched off**, by `files.confirmDelete` — with one exception
 *   that stays. Argued for at `ask` below.
 */
import { useCallback, useEffect, useState } from "react";
import type { Notice } from "./NoticeBar";
import { describe, remove, treeSize, type EntryKind } from "./rpc";
import { loadSettings } from "./settings";

/** What is about to be deleted. */
export interface DeleteTarget {
  path: string;
  name: string;
  kind: EntryKind;
}

export interface DeleteFlow {
  /** The bar to render, or `null` when nothing is being asked or reported. */
  notice: Notice | null;
  /** Begin. Puts the question up; nothing has been touched yet. */
  ask: (target: DeleteTarget) => void;
  /** Take the question down, having done nothing. */
  cancel: () => void;
}

export function useDelete({
  unsavedUnder,
  dropUnder,
  onDeleted,
}: {
  /** Names of open files at or under a path that hold unsaved work. */
  unsavedUnder: (path: string) => string[];
  /** Close every tab at or under a path, unprompted. */
  dropUnder: (path: string) => void;
  /** A delete landed. The caller re-reads whatever it shows. */
  onDeleted: (target: DeleteTarget) => void;
}): DeleteFlow {
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  /**
   * What is inside the folder being deleted, once the count comes back.
   *
   * `null` while it is in flight, which the wording handles rather than waiting
   * on — a confirmation that appeared a beat after the click would be a
   * confirmation people click through, and the count is a detail of the
   * sentence rather than the point of it.
   */
  const [inside, setInside] = useState<{ total: number; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * `files.confirmDelete`, from the settings screen.
   *
   * `true` until the read lands, and `true` again if it fails. Asking is the
   * safe answer, and a delete that skipped the question because a bridge call
   * had not come back yet would be the one race in this file that costs the
   * user something.
   */
  const [confirmDelete, setConfirmDelete] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((settings) => {
      if (!cancelled) setConfirmDelete(settings.toggle("files.confirmDelete", true));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Clear the bar unconditionally. Internal: the success path uses this. */
  const reset = useCallback(() => {
    setTarget(null);
    setInside(null);
    setBusy(false);
    setFailure(null);
  }, []);

  /**
   * Take the question down, having done nothing.
   *
   * Inert while a delete is in flight, and that is not an oversight: the call
   * is already out and there is nothing to call back. A Cancel that cleared the
   * bar mid-delete would tell the user it had been stopped when it had not —
   * the worst possible lie for this particular button. The bar closes itself on
   * success (through `reset`, which has no such guard) and turns into a report
   * on failure.
   */
  const cancel = useCallback(() => {
    if (busy) return;
    reset();
  }, [busy, reset]);

  const confirm = useCallback(
    (next: DeleteTarget) => {
      setBusy(true);
      setFailure(null);

      void remove(next.path)
        .then(() => {
          // Tabs first, so nothing is left polling a path that is gone and
          // marking itself missing a moment after the user watched it go.
          dropUnder(next.path);
          onDeleted(next);
          reset();
        })
        .catch((err: unknown) => {
          // The real reason, not a shrug. On Windows this is usually "the file
          // is open in another program" or a volume with no Recycle Bin, and
          // both are things the user can do something about — but only if they
          // are told which one happened.
          setBusy(false);
          setFailure(describe("files/delete", err));
        });
    },
    [dropUnder, onDeleted, reset],
  );

  /**
   * Begin, and go straight to the delete when the question has been switched
   * off — with one exception, which is not a hedge.
   *
   * `files.confirmDelete`'s own description argues that the confirmation is "a
   * speed bump rather than a safety net" because `files/delete` moves things to
   * the Recycle Bin either way. That is true of what is on disk and false of
   * what is not: unsaved edits in an open buffer were never written, so a
   * restore brings back the last *saved* version and the typing is gone with
   * nothing left to undo it from. The one thing the question genuinely protects
   * is therefore the one thing switching it off must not silently discard, so a
   * target with unsaved work under it is still asked about.
   *
   * The bar does not vanish on the skipped path — `target` is set either way,
   * so the delete draws "Deleting …" while it is in flight and still turns into
   * a report if it fails.
   */
  const ask = useCallback(
    (next: DeleteTarget) => {
      setTarget(next);
      setInside(null);
      setBusy(false);
      setFailure(null);

      if (!confirmDelete && unsavedUnder(next.path).length === 0) {
        confirm(next);
        return;
      }

      if (next.kind !== "dir") return;

      // Only a folder needs a count, and the answer is allowed to arrive late.
      // A count that fails is simply not shown: the confirmation is still
      // correct without it, and refusing to ask because the folder could not be
      // walked would be worse than asking with one sentence less.
      void treeSize(next.path)
        .then((size) => setInside({ total: size.files + size.dirs, truncated: size.truncated }))
        .catch(() => {
          /* No number, no sentence about a number. */
        });
    },
    [confirm, confirmDelete, unsavedUnder],
  );

  const notice = ((): Notice | null => {
    if (!target) return null;

    if (failure !== null) {
      return {
        tone: "err",
        message: failure,
        // A report rather than a question by this point: the delete did not
        // happen, so there is nothing to cancel and nothing to confirm. The
        // only thing left is to stop showing it.
        actions: [{ label: "Dismiss", run: cancel }],
      };
    }

    return {
      tone: "warn",
      message: confirmation(target, inside, unsavedUnder(target.path), busy),
      actions: [
        { label: "Cancel", run: cancel },
        {
          label: busy ? "Deleting…" : "Delete",
          danger: true,
          run: () => {
            if (!busy) confirm(target);
          },
        },
      ],
    };
  })();

  return { notice, ask, cancel };
}

/**
 * The sentence the user reads before they lose something.
 *
 * Assembled from what is actually known rather than from a template with holes
 * — a folder whose count has not arrived says "everything inside it", which is
 * true, instead of "0 items", which is not.
 */
function confirmation(
  target: DeleteTarget,
  inside: { total: number; truncated: boolean } | null,
  unsaved: string[],
  busy: boolean,
): string {
  if (busy) return `Deleting ${target.name}…`;

  const parts: string[] = [];

  if (target.kind === "dir") {
    const contents =
      inside === null
        ? "everything inside it"
        : inside.total === 0
          ? "which is empty"
          : `the ${inside.truncated ? "more than " : ""}${inside.total} item${
              inside.total === 1 ? "" : "s"
            } inside it`;
    parts.push(`Delete the folder ${target.name} and ${contents}?`);
  } else {
    parts.push(`Delete ${target.name}?`);
  }

  // Said plainly, and said second, because it is the part that makes the answer
  // recoverable and people should read it before deciding rather than after.
  // One sentence for both kinds: `files/delete` treats a file and a folder the
  // same way, so promising anything different would be inventing a difference.
  parts.push(
    target.kind === "dir"
      ? "The folder and its contents will be moved to the Recycle Bin."
      : "It will be moved to the Recycle Bin.",
  );

  if (unsaved.length === 1) {
    parts.push(`Unsaved changes in ${unsaved[0]} will be lost.`);
  } else if (unsaved.length > 1) {
    parts.push(
      `Unsaved changes in ${unsaved.length} open files will be lost: ${unsaved.join(", ")}.`,
    );
  }

  return parts.join(" ");
}
