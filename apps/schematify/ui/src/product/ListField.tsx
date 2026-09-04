/**
 * A small editable list of strings — one row per item, an `×` to remove it,
 * and an `+ add` row at the foot. Shared by the Project brief (`users`,
 * `goals`, `non_goals`, `constraints`) and the Screen registry (`states`,
 * `acceptance`), the same free-text array shape PRD §5.7 and §5.12 both
 * use. `[P]`: no wireframe draws either surface (WIREFRAME-EXTRACT.md §8.1
 * lists S-19 and S-20 as undrawn), so this widget's shape is this wave's own
 * choice, recorded in the wave 10c handoff.
 */
import { useState } from "react";

export interface ListFieldProps {
  label: string;
  values: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function ListField({ label, values, onChange, placeholder }: ListFieldProps) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div className="kv-listfield">
      <div className="kv-listfield__label">{label}</div>
      <ul className="kv-listfield__items">
        {values.map((value, index) => (
          <li key={`${index}-${value}`} className="kv-listfield__item">
            <span className="kv-listfield__item-text">{value}</span>
            <button
              type="button"
              className="kv-listfield__remove"
              aria-label={`Remove ${value}`}
              onClick={() => removeAt(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="kv-listfield__add">
        <input
          className="kv-listfield__input"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="kv-listfield__add-button" onClick={add}>
          + add
        </button>
      </div>
    </div>
  );
}
