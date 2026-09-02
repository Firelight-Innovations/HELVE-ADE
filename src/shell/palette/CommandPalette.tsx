/**
 * The command palette: one field over a dimmed window, and every menu row in it.
 *
 * A sheet portalled to `document.body` rather than a band in the frame, and
 * that is the same call `SettingsScreen` made for the same reason — the palette
 * is not a place in the layout. It is opened, used and gone in a few seconds,
 * nothing may be dragged into it, and the window underneath must be exactly as
 * it was when it closes. Putting it in `Frame`'s slots would have meant every
 * region learning about a sixth band that is absent 99% of the time.
 *
 * Portalling also means the pane tree, the terminals and the app iframes below
 * are untouched — no remount, no reload, no re-layout of a Monaco editor
 * mid-keystroke.
 *
 * The surface is mounted fresh on every open, which is why nothing here resets
 * state: an unmount is the reset. Closing and reopening starts on an empty
 * field, at the top of the list, out of the prompt stage.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { settingsBackdrop, settingsScreen } from "../motion";
import { matchRuns } from "./fuzzy";
import { initialIndex, rankCommands, type Command, type RankedCommand } from "./registry";
import "./palette.css";

export interface CommandPaletteProps {
  open: boolean;
  /** Every command the shell has, flattened from the live menu tree. Rebuilt on
   *  every render of the window, so a row that has just become possible is
   *  possible here in the same frame. */
  commands: Command[];
  onClose: () => void;
}

/**
 * The portal is outside `AnimatePresence` and the surface inside it, which is
 * `ContextMenuHost`'s shape rather than a choice made again here — the wrapper
 * is always rendered so presence can watch the sheet leave, and an empty one
 * draws no DOM. The two motion elements nest exactly as `SettingsScreen`'s do,
 * so the sheet inherits the variant state its parent is in.
 */
export default function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          variants={settingsBackdrop}
          initial="initial"
          animate="animate"
          exit="exit"
          // Only a press that landed on the backdrop itself, compared the way
          // `SettingsScreen` compares it — a blanket `stopPropagation` on the
          // sheet would be a rule every control inside it has to work around.
          //
          // `onMouseDown` rather than `onClick`, because a click that began in
          // the field and ended out here is a selection dragged past the edge,
          // not a dismissal.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div className="palette__sheet" variants={settingsScreen}>
            <Palette commands={commands} onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** The sheet's contents: the field and the list, or the one field a command
 *  that needs an argument asked for. Mounted with the sheet, so its state is
 *  reset by the unmount rather than by an effect. */
function Palette({ commands, onClose }: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");

  // The command whose one line of text is being asked for, or `null` for the
  // list. Two stages in one surface rather than handing the person back to the
  // menu to find the row with the field on it — which is the opposite of what
  // opening a palette was for.
  const [asking, setAsking] = useState<Command | null>(null);

  const rows = useMemo(() => rankCommands(commands, query), [commands, query]);
  const [index, setIndex] = useState(() => initialIndex(rows));

  // Clamped rather than corrected in an effect. The list shrinks under a stored
  // index on every keystroke, and an effect that fixed it afterwards would let
  // one frame paint with the highlight off the end of the list.
  const active = rows.length === 0 ? 0 : Math.min(index, rows.length - 1);

  const onQuery = (value: string) => {
    setQuery(value);
    // Back to the first row that can run, in the same update as the text that
    // changed the list — a highlight left where it was would sit on whatever
    // command happens to have moved under it.
    setIndex(initialIndex(rankCommands(commands, value)));
  };

  const run = (row: RankedCommand | undefined) => {
    if (row === undefined || row.command.disabled) return;
    if (row.command.prompt) {
      setAsking(row.command);
      return;
    }
    row.command.onSelect?.();
    onClose();
  };

  if (asking !== null) {
    return <PromptStage command={asking} onDone={onClose} onBack={() => setAsking(null)} />;
  }

  return (
    <CommandList
      query={query}
      rows={rows}
      active={active}
      onQuery={onQuery}
      onMove={setIndex}
      onRun={run}
      onClose={onClose}
    />
  );
}

function CommandList({
  query,
  rows,
  active,
  onQuery,
  onMove,
  onRun,
  onClose,
}: {
  query: string;
  rows: RankedCommand[];
  active: number;
  onQuery: (value: string) => void;
  onMove: (index: number) => void;
  onRun: (row: RankedCommand | undefined) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  // `block: "nearest"` so a highlight already on screen does not scroll the
  // list under it — the arrow keys should move the highlight, and the list only
  // when the highlight has run out of room.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      onMove(rows.length === 0 ? 0 : (active + 1) % rows.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onMove(rows.length === 0 ? 0 : (active - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      onRun(rows[active]);
      return;
    }
    if (e.key === "Escape") {
      // Stopped here rather than left to bubble: `SearchSlot` listens for
      // Escape on the window to close search, and dismissing this should not
      // also close a search the palette was opened over.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <input
        ref={fieldRef}
        className="palette__field"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-label="Run a command"
        placeholder="Type a command"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {rows.length === 0 ? (
        <p className="palette__empty">No command matches that.</p>
      ) : (
        <ul id="palette-list" ref={listRef} className="palette__list" role="listbox">
          {rows.map((row, i) => (
            <Row
              // Indexed as well as labelled: two presets saved under one name
              // would otherwise be one key for two rows.
              key={`${row.command.label}-${i}`}
              row={row}
              active={i === active}
              // Focus follows the pointer, as it does in the search results and
              // the file explorer, so the row under the cursor is the row Enter
              // would run.
              onHover={() => onMove(i)}
              onRun={() => onRun(row)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function Row({
  row,
  active,
  onHover,
  onRun,
}: {
  row: RankedCommand;
  active: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  const { command } = row;

  return (
    /* The reason rides on the `<li>` for the reason `MenuItemList` gives: a
       `disabled` button receives no pointer events, so a `title` on the button
       would be readable on exactly the rows that never need explaining. */
    <li
      role="option"
      aria-selected={active}
      aria-disabled={command.disabled}
      title={command.hint}
      className="palette__row"
      data-active={active || undefined}
      data-disabled={command.disabled || undefined}
      onMouseEnter={onHover}
    >
      <button type="button" className="palette__button" disabled={command.disabled} onClick={onRun}>
        <span className="palette__label">
          {matchRuns(command.label, row.positions).map((part, i) =>
            part.hit ? (
              <mark key={i} className="palette__hit">
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </span>
        {command.accelerator !== undefined && (
          <span className="palette__accel">{command.accelerator}</span>
        )}
      </button>
    </li>
  );
}

/**
 * The second stage: one line of text for a command that needs one.
 *
 * The same shape `MenuItemList`'s `PromptField` uses, and for the same reasons —
 * the refusal is shown under the field because it is an answer to what was just
 * typed, and success closes the whole surface because the thing asked for
 * happened.
 */
function PromptStage({
  command,
  onDone,
  onBack,
}: {
  command: Command;
  onDone: () => void;
  onBack: () => void;
}) {
  const prompt = command.prompt;
  const [value, setValue] = useState(prompt?.initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  if (prompt === undefined) return null;

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    prompt
      .onSubmit(value)
      .then(onDone)
      .catch((err: unknown) => {
        // Rust's `AppError` serializes to its message and arrives as a bare
        // string; anything else is a fault rather than a refusal and still has
        // to say something, or the button would look broken.
        setError(typeof err === "string" ? err : String(err));
        setBusy(false);
        fieldRef.current?.focus();
      });
  };

  return (
    <form
      className="palette__prompt"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="palette__prompt-command">{command.label}</p>
      <label className="palette__prompt-label" htmlFor="palette-prompt-field">
        {prompt.label}
      </label>
      <input
        id="palette-prompt-field"
        ref={fieldRef}
        className="palette__field"
        value={value}
        placeholder={prompt.placeholder}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          if (error !== null) setError(null);
        }}
        // Escape backs out to the list rather than closing the surface: the
        // command was chosen deliberately and the field is one keystroke of
        // that choice, so undoing it should undo one step.
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }}
      />
      {error !== null && <p className="palette__error">{error}</p>}
      <button type="submit" className="palette__confirm" disabled={busy || value.trim() === ""}>
        {prompt.confirmLabel}
      </button>
    </form>
  );
}
