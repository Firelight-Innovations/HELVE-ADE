/**
 * The Flow editor (PRD §5.8, §12.17, S-21): "an ordered step list. Each
 * step names 1 screen and 1 action." `[P]` in its layout — no wireframe
 * draws this surface.
 */
import { useState } from "react";
import { uuidv7 } from "../engine/ids";
import { resolveFlowSteps, screenUri, type RawFlow, type RawScreen } from "./index";

export interface FlowEditorProps {
  flows: readonly RawFlow[];
  screens: readonly RawScreen[];
  onSave: (flow: RawFlow) => Promise<void>;
}

function draftFlow(): RawFlow {
  return {
    id: uuidv7(),
    kind: "flow",
    slug: "",
    title: "",
    trigger: "",
    steps: [],
    outcome: "",
  };
}

export function FlowEditor({ flows, screens, onSave }: FlowEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RawFlow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = draft ?? (selectedId ? (flows.find((f) => f.id === selectedId) ?? null) : null);

  function select(flow: RawFlow) {
    setSelectedId(flow.id);
    setDraft(null);
    setError(null);
  }

  function startNew() {
    const next = draftFlow();
    setDraft(next);
    setSelectedId(next.id);
    setError(null);
  }

  function edit(patch: Partial<RawFlow>) {
    if (!selected) return;
    setDraft({ ...selected, ...patch });
  }

  function addStep() {
    if (!selected || screens.length === 0) return;
    edit({ steps: [...selected.steps, { screen: screenUri(screens[0]), action: "" }] });
  }

  function updateStep(index: number, patch: Partial<{ screen: string; action: string }>) {
    if (!selected) return;
    edit({
      steps: selected.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    });
  }

  function removeStep(index: number) {
    if (!selected) return;
    edit({ steps: selected.steps.filter((_, i) => i !== index) });
  }

  function moveStep(index: number, direction: -1 | 1) {
    if (!selected) return;
    const target = index + direction;
    if (target < 0 || target >= selected.steps.length) return;
    const steps = [...selected.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    edit({ steps });
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const resolvedSteps = selected ? resolveFlowSteps(selected, screens) : [];

  return (
    <div className="kv-registry">
      <div className="kv-panel-header">
        FLOW EDITOR <span className="kv-panel-count">{flows.length} flows</span>
      </div>

      <ul className="kv-flow-list">
        {flows.map((flow) => (
          <li
            key={flow.id}
            className={
              flow.id === selectedId
                ? "kv-flow-list__row kv-flow-list__row--selected"
                : "kv-flow-list__row"
            }
            onClick={() => select(flow)}
          >
            <span className="kv-registry__slug">{flow.slug}</span>
            <span>{flow.title}</span>
            <span className="kv-panel-count">{flow.steps.length} steps</span>
          </li>
        ))}
      </ul>
      <button type="button" className="kv-listfield__add-button" onClick={startNew}>
        + new flow
      </button>

      {selected ? (
        <div className="kv-registry__form">
          <label className="kv-field">
            <span className="kv-field__label">SLUG</span>
            <input
              className="kv-field__input"
              value={selected.slug}
              onChange={(event) => edit({ slug: event.target.value })}
            />
          </label>
          <label className="kv-field">
            <span className="kv-field__label">TITLE</span>
            <input
              className="kv-field__input"
              value={selected.title}
              onChange={(event) => edit({ title: event.target.value })}
            />
          </label>
          <label className="kv-field">
            <span className="kv-field__label">TRIGGER</span>
            <textarea
              className="kv-field__textarea"
              value={selected.trigger}
              onChange={(event) => edit({ trigger: event.target.value })}
            />
          </label>

          <div className="kv-field__label">STEPS</div>
          <ol className="kv-flow-steps">
            {resolvedSteps.map((resolved, index) => (
              <li key={index} className="kv-flow-steps__row">
                <span className="kv-flow-steps__index">{index + 1}</span>
                <select
                  className="kv-flow-steps__screen"
                  value={resolved.step.screen}
                  onChange={(event) => updateStep(index, { screen: event.target.value })}
                >
                  {screens.map((screen) => (
                    <option key={screen.id} value={screenUri(screen)}>
                      {screen.slug}
                    </option>
                  ))}
                </select>
                {resolved.screenTitle === null ? (
                  <span className="kv-metrics__warning">screen not found</span>
                ) : null}
                <input
                  className="kv-flow-steps__action"
                  value={resolved.step.action}
                  placeholder="What the person does…"
                  onChange={(event) => updateStep(index, { action: event.target.value })}
                />
                <button
                  type="button"
                  className="kv-listfield__remove"
                  disabled={index === 0}
                  aria-label="Move step up"
                  onClick={() => moveStep(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="kv-listfield__remove"
                  disabled={index === resolvedSteps.length - 1}
                  aria-label="Move step down"
                  onClick={() => moveStep(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="kv-listfield__remove"
                  aria-label="Remove step"
                  onClick={() => removeStep(index)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="kv-listfield__add-button"
            disabled={screens.length === 0}
            onClick={addStep}
          >
            + add step
          </button>

          <label className="kv-field">
            <span className="kv-field__label">OUTCOME</span>
            <textarea
              className="kv-field__textarea"
              value={selected.outcome}
              onChange={(event) => edit({ outcome: event.target.value })}
            />
          </label>

          {error ? <p className="kv-panel-error">{error}</p> : null}
          <button
            type="button"
            className="kv-panel-save"
            disabled={!selected.slug || !selected.title || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save flow"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
