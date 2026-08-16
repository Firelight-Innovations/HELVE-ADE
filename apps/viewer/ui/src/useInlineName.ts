/**
 * Naming something in place: the behaviour, without the markup.
 *
 * Two places in this app ask a user to type a name — a row in the tree
 * (`explorer/DraftRow.tsx`) and a chip in the tab strip (`tabs/TabStrip.tsx`) —
 * and they look nothing alike. What they share is every rule about *how the
 * question behaves*: Enter takes the answer, Escape abandons it, clicking away
 * takes it, an empty answer is a cancel, a rename to the name it already had is
 * a cancel, and a failed attempt leaves the field exactly where it was with the
 * text still in it.
 *
 * That list is the thing worth having once. It was written for the tree first,
 * and when the tab strip needed a rename the choice was to copy it or to lift
 * it — and a copy of a five-rule state machine is a copy that will disagree
 * with the original the first time either is touched. So this hook is the
 * gesture and the two components are its renderings.
 *
 * What it deliberately does not own: validation. Every rule about what a name
 * may contain lives in `src-tauri/src/apps/files.rs`, and a copy here would be
 * the second implementation of path semantics that `rpc.ts`'s header refuses.
 * This sends whatever was typed.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

export interface InlineNameOptions {
  /** What the field starts with. `""` when naming something new. */
  initial: string;
  /**
   * `rename` preselects the basename and treats an unchanged answer as a
   * cancel. `create` selects everything, which for an empty field is nothing.
   */
  mode: "create" | "rename";
  /** A call is in flight. The field freezes rather than closing. */
  busy: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export interface InlineName {
  value: string;
  setValue: (next: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

export function useInlineName({
  initial,
  mode,
  busy,
  onCommit,
  onCancel,
}: InlineNameOptions): InlineName {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Whether this field has already had its answer taken.
   *
   * Enter commits and then — a beat later, when the owner re-renders — the
   * field is unmounted, which fires `blur`. Without this the blur would commit
   * the same name a second time, or, on the Escape path, resurrect a name the
   * user had just abandoned.
   */
  const settled = useRef(false);

  /** Whether the opening selection has been made. See the effect below. */
  const aimed = useRef(false);

  /**
   * Take the focus, and on the way in put the selection where it is useful.
   *
   * `autoFocus` would cover the first mount and nothing else. An attempt that
   * *failed* leaves the field up with its message showing, and the cursor has
   * to come back to the thing the user is being asked to fix — so this runs
   * whenever the field stops being busy.
   *
   * The selection is the part worth explaining. Renaming `TransformRow.tsx`
   * selects `TransformRow` and leaves `.tsx` alone, so typing a new name does
   * not silently destroy the extension and, with it, the file's language and
   * its icon. That is VS Code's behaviour, and it is the difference between
   * rename being safe to use quickly and being one you have to be careful with.
   *
   * It happens once. After a failed attempt the user's own edit is worth more
   * than a helpful reselection of it.
   */
  useEffect(() => {
    const input = inputRef.current;
    if (!input || busy) return;
    input.focus();
    if (aimed.current) return;
    aimed.current = true;

    const dot = input.value.lastIndexOf(".");
    // A leading dot begins a name rather than an extension — `.gitignore`
    // selects whole, the same rule `extensionOf` in `./rpc` applies.
    if (mode === "rename" && dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [busy, mode]);

  const finish = (take: boolean) => {
    if (settled.current) return;
    // A call already went out. This is reached because disabling a focused
    // field blurs it, and `onBlur` is the commit — so without this, pressing
    // Enter sends the name twice.
    if (busy) return;

    const trimmed = value.trim();
    // An empty name is a cancel however it arrived: there is nothing to send,
    // and refusing here saves a round trip to hear the backend say "a name is
    // required" about a field nobody filled in.
    //
    // A rename to the name it already has is the same. The backend accepts it
    // as a no-op, but going through with it would re-list a folder and move
    // the cursor for a change nobody made — opening rename and clicking away
    // has to be free.
    if (!take || !trimmed || (mode === "rename" && trimmed === initial)) {
      settled.current = true;
      onCancel();
      return;
    }

    // Not settled: the call can fail, and the field has to still be here with
    // the name in it when it does. The owner unmounts this on success, which
    // is what makes the flag unnecessary in that direction.
    onCommit(trimmed);
  };

  return {
    value,
    setValue,
    inputRef,
    onKeyDown: (event) => {
      // Both hosts sit inside something that claims the arrows, Home, End and
      // Enter for its own navigation — the tree's scrollport, the tab strip's
      // roving focus. Every one of those is something a text field needs, so
      // nothing from in here is allowed to reach them.
      event.stopPropagation();

      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    },
    onBlur: () => finish(true),
  };
}
