/**
 * A number, with a field between two steppers.
 *
 * Not `<input type="number">`. The native spinner is drawn by the platform, is
 * a different size and colour in every webview, and cannot be told to use the
 * shell's tokens — on a screen whose whole job is to look like the rest of the
 * window that is disqualifying. A text field plus two buttons is the same
 * affordance in this shell's own drawing.
 *
 * The field's text is local while it is being typed; see `useDraft` for why, and
 * for why the answer Rust sends back is what ends up on screen.
 */
import { useDraft } from "./useDraft";
import { Plus } from "../../../ui/Icon";

export default function NumberControl({
  value,
  min,
  max,
  step,
  unit,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Drawn after the field. Empty for a count, which needs no noun. */
  unit: string;
  label: string;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useDraft(String(value));

  // A step of zero would make both buttons inert without saying so. Rust should
  // never send one, and a stepper that quietly does nothing is a worse way to
  // find that out than one that moves by one.
  const stride = step > 0 ? step : 1;

  const commit = () => {
    const text = draft.trim();
    const parsed = Number(text);
    // Nothing usable. Put the stored value back rather than writing a guess —
    // an empty field means "I am not finished", not "make this zero".
    if (text === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    // Seeded from what was typed rather than left alone, so `0050` reads back as
    // `50` even though the stored value never changed and the effect in
    // `useDraft` therefore never fires.
    setDraft(String(parsed));
    onChange(parsed);
  };

  const nudge = (direction: number) => {
    const next = Math.min(max, Math.max(min, value + direction * stride));
    if (next === value) return;
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className="settings-stepper">
      <button
        type="button"
        className="settings-stepper__button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => nudge(-1)}
      >
        <Minus />
      </button>
      <input
        className="settings-stepper__field"
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(keepNumeric(event.target.value, min))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      <button
        type="button"
        className="settings-stepper__button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => nudge(1)}
      >
        <Plus size={13} />
      </button>
      {unit !== "" && <span className="settings-stepper__unit">{unit}</span>}
    </div>
  );
}

/**
 * The other half of `Plus`, drawn here rather than added to `src/ui/Icon.tsx`
 * because a bare minus has exactly one caller in the shell — this stepper — and
 * `Icon.tsx` is the handoff's glyph set rather than a general icon package.
 *
 * Same 24×24 box, same 2px stroke on `currentColor`, so it sits at the identical
 * weight as the `Plus` on the button beside it.
 */
function Minus({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

/**
 * Digits only, plus one leading `-` when the range actually reaches below zero.
 *
 * No decimal point, and that is the schema's decision rather than this control's
 * — `settings::Control::Number` declares `default`, `min`, `max` and `step` as
 * `i64`, so a fractional entry has nowhere to be stored and would be rounded
 * away on the way through Rust.
 *
 * Filtering on the way in rather than validating on commit, because a field that
 * accepts letters and then silently discards the whole entry on blur looks like
 * it lost what was typed. A key that cannot contribute to a number simply never
 * appears.
 */
function keepNumeric(text: string, min: number): string {
  const digits = text.replace(/[^0-9]/g, "");
  return min < 0 && text.startsWith("-") ? `-${digits}` : digits;
}
