/**
 * The Project brief (PRD §5.12, §12.17, S-19): "one field per brief key," a
 * plain form over `brief.json`'s 7 fields. `[P]` in its layout — no
 * wireframe draws this surface — but every field and every validation rule
 * traces to §5.12's own text: "A `success_metric` field rejects a value
 * with no unit."
 */
import { useState } from "react";
import {
  emptyBrief,
  isValidSuccessMetric,
  type RawProjectBrief,
  type RawSuccessMetric,
} from "./index";
import { ListField } from "./ListField";

export interface ProjectBriefViewProps {
  brief: RawProjectBrief | null;
  onSave: (brief: RawProjectBrief) => Promise<void>;
}

export function ProjectBriefView({ brief, onSave }: ProjectBriefViewProps) {
  const [draft, setDraft] = useState<RawProjectBrief>(brief ?? emptyBrief());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidMetric = draft.success_metrics.find((metric) => !isValidSuccessMetric(metric));
  const canSave =
    draft.product_name.trim().length > 0 && draft.problem.trim().length > 0 && !invalidMetric;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function updateMetric(index: number, patch: Partial<RawSuccessMetric>) {
    setDraft({
      ...draft,
      success_metrics: draft.success_metrics.map((metric, i) =>
        i === index ? { ...metric, ...patch } : metric,
      ),
    });
  }

  return (
    <div className="kv-brief">
      <div className="kv-panel-header">PROJECT BRIEF</div>

      <label className="kv-field">
        <span className="kv-field__label">PRODUCT NAME</span>
        <input
          className="kv-field__input"
          value={draft.product_name}
          onChange={(event) => setDraft({ ...draft, product_name: event.target.value })}
        />
      </label>

      <label className="kv-field">
        <span className="kv-field__label">PROBLEM</span>
        <textarea
          className="kv-field__textarea"
          value={draft.problem}
          onChange={(event) => setDraft({ ...draft, problem: event.target.value })}
        />
      </label>

      <ListField
        label="USERS"
        values={draft.users}
        onChange={(users) => setDraft({ ...draft, users })}
        placeholder="Who is this for…"
      />
      <ListField
        label="GOALS"
        values={draft.goals}
        onChange={(goals) => setDraft({ ...draft, goals })}
        placeholder="What it sets out to do…"
      />
      <ListField
        label="NON-GOALS"
        values={draft.non_goals}
        onChange={(non_goals) => setDraft({ ...draft, non_goals })}
        placeholder="What it deliberately does not do…"
      />
      <ListField
        label="CONSTRAINTS"
        values={draft.constraints}
        onChange={(constraints) => setDraft({ ...draft, constraints })}
        placeholder="What it has to work within…"
      />

      <div className="kv-field">
        <span className="kv-field__label">SUCCESS METRICS</span>
        <ul className="kv-metrics">
          {draft.success_metrics.map((metric, index) => (
            <li key={index} className="kv-metrics__row">
              <input
                className="kv-metrics__name"
                value={metric.name}
                placeholder="metric"
                onChange={(event) => updateMetric(index, { name: event.target.value })}
              />
              <input
                className="kv-metrics__value"
                type="number"
                value={metric.value}
                onChange={(event) => updateMetric(index, { value: Number(event.target.value) })}
              />
              <input
                className="kv-metrics__unit"
                value={metric.unit}
                placeholder="unit"
                onChange={(event) => updateMetric(index, { unit: event.target.value })}
              />
              {!isValidSuccessMetric(metric) ? (
                <span className="kv-metrics__warning">needs a name and a unit</span>
              ) : null}
              <button
                type="button"
                className="kv-listfield__remove"
                aria-label={`Remove ${metric.name || "metric"}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    success_metrics: draft.success_metrics.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="kv-listfield__add-button"
          onClick={() =>
            setDraft({
              ...draft,
              success_metrics: [...draft.success_metrics, { name: "", value: 0, unit: "" }],
            })
          }
        >
          + add metric
        </button>
      </div>

      {error ? <p className="kv-panel-error">{error}</p> : null}
      <button type="button" className="kv-panel-save" disabled={!canSave || saving} onClick={save}>
        {saving ? "Saving…" : "Save brief"}
      </button>
    </div>
  );
}
