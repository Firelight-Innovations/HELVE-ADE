/**
 * The Decision log (PRD §5.9, §12.18, S-22): "The log draws as a table
 * filtered by `status`. A new decision adds a row. A superseding decision
 * adds a row and marks the prior row `SUPERSEDED`. The surface offers no
 * edit control on an existing row and no remove control on any row."
 *
 * That last sentence is a UI rule and this component honors it — no row
 * below carries an edit or delete affordance, active or superseded — but
 * the real enforcement is server-side: `src-tauri/src/apps/schematify.rs`'s
 * `write_decision` and `supersede_decision` refuse the write even if a
 * client tried, which is the acceptance condition this wave is measured
 * against. See that file's own doc comments and the wave 10c handoff.
 */
import { useState } from "react";
import { uuidv7 } from "../engine/ids";
import {
  decisionDisplaySlug,
  filterDecisions,
  sortDecisions,
  type DecisionStatusFilter,
  type RawDecision,
} from "./index";

export interface DecisionLogProps {
  decisions: readonly RawDecision[];
  onCreate: (decision: RawDecision) => Promise<void>;
  onSupersede: (priorId: string, decision: RawDecision) => Promise<void>;
}

const FILTERS: readonly DecisionStatusFilter[] = ["ALL", "ACTIVE", "SUPERSEDED"];

interface DraftDecision {
  slug: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  date: string;
}

function blankDraft(): DraftDecision {
  return { slug: "", title: "", context: "", decision: "", consequences: "", date: "" };
}

function isCompleteDraft(draft: DraftDecision): boolean {
  return Boolean(
    draft.slug.trim() &&
    draft.title.trim() &&
    draft.context.trim() &&
    draft.decision.trim() &&
    draft.consequences.trim() &&
    draft.date.trim(),
  );
}

export function DecisionLog({ decisions, onCreate, onSupersede }: DecisionLogProps) {
  const [filter, setFilter] = useState<DecisionStatusFilter>("ALL");
  const [newDraft, setNewDraft] = useState<DraftDecision | null>(null);
  const [supersedeTarget, setSupersedeTarget] = useState<RawDecision | null>(null);
  const [supersedeDraft, setSupersedeDraft] = useState<DraftDecision>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = sortDecisions(filterDecisions(decisions, filter));

  async function submitNew() {
    if (!newDraft || !isCompleteDraft(newDraft)) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        id: uuidv7(),
        kind: "decision",
        slug: newDraft.slug,
        title: newDraft.title,
        context: newDraft.context,
        decision: newDraft.decision,
        consequences: newDraft.consequences,
        status: "ACTIVE",
        supersedes: null,
        superseded_by: null,
        date: newDraft.date,
      });
      setNewDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function startSupersede(row: RawDecision) {
    setSupersedeTarget(row);
    setSupersedeDraft({
      slug: row.slug,
      title: row.title,
      context: row.context,
      decision: row.decision,
      consequences: row.consequences,
      date: "",
    });
    setError(null);
  }

  async function submitSupersede() {
    if (!supersedeTarget || !isCompleteDraft(supersedeDraft)) return;
    setSaving(true);
    setError(null);
    try {
      await onSupersede(supersedeTarget.id, {
        id: uuidv7(),
        kind: "decision",
        slug: supersedeDraft.slug,
        title: supersedeDraft.title,
        context: supersedeDraft.context,
        decision: supersedeDraft.decision,
        consequences: supersedeDraft.consequences,
        // status/supersedes/superseded_by are decided server-side
        // regardless of what is sent — see supersede_decision's own doc
        // comment — these are placeholders honest about that.
        status: "ACTIVE",
        supersedes: null,
        superseded_by: null,
        date: supersedeDraft.date,
      });
      setSupersedeTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kv-registry">
      <div className="kv-panel-header">
        DECISION LOG <span className="kv-panel-count">{decisions.length} decisions</span>
      </div>

      <div className="kv-decision-filter" role="tablist">
        {FILTERS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === filter}
            className={
              entry === filter
                ? "kv-decision-filter__tab kv-decision-filter__tab--active"
                : "kv-decision-filter__tab"
            }
            onClick={() => setFilter(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      <table className="kv-registry__table">
        <thead>
          <tr>
            <th>SLUG</th>
            <th>TITLE</th>
            <th>STATUS</th>
            <th>DATE</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="kv-registry__row">
              <td className="kv-registry__slug">{decisionDisplaySlug(row)}</td>
              <td>{row.title}</td>
              <td>{row.status}</td>
              <td>{row.date}</td>
              <td>
                {row.status === "ACTIVE" ? (
                  <button
                    type="button"
                    className="kv-toolbar__button"
                    onClick={() => startSupersede(row)}
                  >
                    Supersede
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {newDraft ? (
        <DecisionForm
          draft={newDraft}
          onChange={setNewDraft}
          onCancel={() => setNewDraft(null)}
          onSubmit={submitNew}
          submitLabel="Create decision"
          saving={saving}
        />
      ) : (
        <button
          type="button"
          className="kv-listfield__add-button"
          onClick={() => setNewDraft(blankDraft())}
        >
          + new decision
        </button>
      )}

      {supersedeTarget ? (
        <div className="kv-registry__form">
          <div className="kv-panel-header">Supersede {decisionDisplaySlug(supersedeTarget)}</div>
          <DecisionForm
            draft={supersedeDraft}
            onChange={setSupersedeDraft}
            onCancel={() => setSupersedeTarget(null)}
            onSubmit={submitSupersede}
            submitLabel="Supersede"
            saving={saving}
          />
        </div>
      ) : null}

      {error ? <p className="kv-panel-error">{error}</p> : null}
    </div>
  );
}

function DecisionForm({
  draft,
  onChange,
  onCancel,
  onSubmit,
  submitLabel,
  saving,
}: {
  draft: DraftDecision;
  onChange: (draft: DraftDecision) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  saving: boolean;
}) {
  return (
    <div className="kv-registry__form">
      <label className="kv-field">
        <span className="kv-field__label">SLUG</span>
        <input
          className="kv-field__input"
          value={draft.slug}
          placeholder="DEC-AREA-TOPIC-001"
          onChange={(event) => onChange({ ...draft, slug: event.target.value })}
        />
      </label>
      <label className="kv-field">
        <span className="kv-field__label">TITLE</span>
        <input
          className="kv-field__input"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
      </label>
      <label className="kv-field">
        <span className="kv-field__label">CONTEXT</span>
        <textarea
          className="kv-field__textarea"
          value={draft.context}
          onChange={(event) => onChange({ ...draft, context: event.target.value })}
        />
      </label>
      <label className="kv-field">
        <span className="kv-field__label">DECISION</span>
        <textarea
          className="kv-field__textarea"
          value={draft.decision}
          onChange={(event) => onChange({ ...draft, decision: event.target.value })}
        />
      </label>
      <label className="kv-field">
        <span className="kv-field__label">CONSEQUENCES</span>
        <textarea
          className="kv-field__textarea"
          value={draft.consequences}
          onChange={(event) => onChange({ ...draft, consequences: event.target.value })}
        />
      </label>
      <label className="kv-field">
        <span className="kv-field__label">DATE</span>
        <input
          className="kv-field__input"
          type="date"
          value={draft.date}
          onChange={(event) => onChange({ ...draft, date: event.target.value })}
        />
      </label>
      <div className="kv-decision-form__actions">
        <button
          type="button"
          className="kv-panel-save"
          disabled={!isCompleteDraft(draft) || saving}
          onClick={onSubmit}
        >
          {saving ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="kv-toolbar__button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
