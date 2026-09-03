/**
 * The Screen registry (PRD §12.17, S-20): "lists every screen with slug,
 * title, purpose, state count, backing module count, and design-link state.
 * The per-screen form edits purpose, states, acceptance conditions, design
 * link, and backing modules." Every count is computed at draw time (PRD
 * §0.4) — `screenStateCount`/`screenBackingModuleCount`, never a stored
 * field.
 *
 * `[P]` in its layout: no wireframe draws this surface. Backing modules are
 * edited as a raw list of `schematify://node/<id>` references rather than
 * through a module picker — this app has no such picker built anywhere yet
 * (a Schematic's own multi-select is a different gesture, over a different
 * kind of node), and inventing one is out of this wave's scope. Recorded in
 * the wave 10c handoff.
 */
import { useEffect, useState } from "react";
import { uuidv7 } from "../engine/ids";
import {
  screenBackingModuleCount,
  screenDesignLinkState,
  screenStateCount,
  screenUri,
  type RawScreen,
} from "./index";
import { ListField } from "./ListField";

export interface ScreenRegistryProps {
  screens: readonly RawScreen[];
  nodeIds: ReadonlySet<string>;
  onSave: (screen: RawScreen) => Promise<void>;
  /** Set by the screen chip / module-root path click-through
   *  (`../engine/SchematicCanvas.tsx`), so opening the registry from a
   *  reference lands on the referenced screen rather than the first row. */
  initialSelectedId?: string | null;
}

function draftScreen(): RawScreen {
  return {
    id: uuidv7(),
    kind: "screen",
    slug: "",
    title: "",
    purpose: "",
    states: [],
    acceptance: [],
    backed_by: [],
  };
}

export function ScreenRegistry({
  screens,
  nodeIds,
  onSave,
  initialSelectedId,
}: ScreenRegistryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [draft, setDraft] = useState<RawScreen | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);

  const selected =
    draft ?? (selectedId ? (screens.find((s) => s.id === selectedId) ?? null) : null);

  function select(screen: RawScreen) {
    setSelectedId(screen.id);
    setDraft(null);
    setError(null);
  }

  function startNew() {
    const next = draftScreen();
    setDraft(next);
    setSelectedId(next.id);
    setError(null);
  }

  function edit(patch: Partial<RawScreen>) {
    if (!selected) return;
    setDraft({ ...selected, ...patch });
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

  return (
    <div className="kv-registry">
      <div className="kv-panel-header">
        SCREEN REGISTRY <span className="kv-panel-count">{screens.length} screens</span>
      </div>

      <table className="kv-registry__table">
        <thead>
          <tr>
            <th>SLUG</th>
            <th>TITLE</th>
            <th>STATES</th>
            <th>MODULES</th>
            <th>DESIGN</th>
          </tr>
        </thead>
        <tbody>
          {screens.map((screen) => (
            <tr
              key={screen.id}
              className={
                screen.id === selectedId
                  ? "kv-registry__row kv-registry__row--selected"
                  : "kv-registry__row"
              }
              onClick={() => select(screen)}
            >
              <td className="kv-registry__slug">{screen.slug}</td>
              <td>{screen.title}</td>
              <td>{screenStateCount(screen)}</td>
              <td>{screenBackingModuleCount(screen, nodeIds)}</td>
              <td>{screenDesignLinkState(screen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="kv-listfield__add-button" onClick={startNew}>
        + new screen
      </button>

      {selected ? (
        <div className="kv-registry__form">
          <div className="kv-panel-header">{screenUri(selected)}</div>
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
            <span className="kv-field__label">PURPOSE</span>
            <textarea
              className="kv-field__textarea"
              value={selected.purpose}
              onChange={(event) => edit({ purpose: event.target.value })}
            />
          </label>
          <ListField
            label="STATES"
            values={selected.states}
            onChange={(states) => edit({ states })}
            placeholder="empty, filled, error…"
          />
          <ListField
            label="ACCEPTANCE"
            values={selected.acceptance}
            onChange={(acceptance) => edit({ acceptance })}
            placeholder="A locked account shall show the recovery path…"
          />
          <label className="kv-field">
            <span className="kv-field__label">DESIGN LINK</span>
            <input
              className="kv-field__input"
              value={selected.design_ref ?? ""}
              placeholder="https://claude.ai/design/p/…"
              onChange={(event) => edit({ design_ref: event.target.value || null })}
            />
          </label>
          <ListField
            label="BACKING MODULES"
            values={selected.backed_by}
            onChange={(backed_by) => edit({ backed_by })}
            placeholder="schematify://node/<uuid>"
          />

          {error ? <p className="kv-panel-error">{error}</p> : null}
          <button
            type="button"
            className="kv-panel-save"
            disabled={!selected.slug || !selected.title || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save screen"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
