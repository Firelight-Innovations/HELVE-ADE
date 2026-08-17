/**
 * One choice out of a handful, drawn as a stack of rows rather than a dropdown.
 *
 * A native `<select>` is the one control the platform draws entirely by itself:
 * its popup is an OS menu in the OS's own colours and metrics, which in a
 * frameless dark shell reads as a piece of a different application. Every other
 * menu in this window is drawn by the shell, so this one is too.
 *
 * Rows rather than a shell-drawn dropdown because the options carry
 * descriptions. A dropdown hides them until it is opened, which turns "what does
 * `compact` mean" into a click; four rows answer it before anyone asks. That
 * only holds while the lists stay short — a select with thirty options would
 * need the dropdown back, and would be the moment to write it.
 */
import { Check } from "../../../ui/Icon";
import type { SelectOption } from "../../../bindings";

export default function SelectControl({
  options,
  value,
  label,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  label: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="settings-choices" role="listbox" aria-label={label}>
      {options.map((option) => {
        const current = option.value === value;
        return (
          <button
            type="button"
            key={option.value}
            className="settings-choices__row"
            role="option"
            aria-selected={current}
            data-current={current || undefined}
            onClick={() => onChange(option.value)}
          >
            {/* A colour is its own best label, so an option whose *value* is one
                shows it. Detected from the value's shape rather than from the
                setting's key: `appearance.accentColor` is the only such setting
                today, and a control that had to be told which key it was serving
                would be a control with a list of keys in it. */}
            {isColour(option.value) && (
              <span className="settings-choices__swatch" style={{ background: option.value }} />
            )}
            <span className="settings-choices__text">
              <span className="settings-choices__label">{option.label}</span>
              {option.description !== "" && (
                <span className="settings-choices__description">{option.description}</span>
              )}
            </span>
            {current && <Check size={11} className="settings-choices__check" />}
          </button>
        );
      })}
    </div>
  );
}

/** Whether an option's value is literally the colour it names. */
function isColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
