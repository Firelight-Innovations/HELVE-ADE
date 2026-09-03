/**
 * The Stack Schematic's first-run empty state (PRD §12.20): "A new project
 * opens on an empty Stack Schematic with 1 action: create the first
 * service." Not the default view this wave — `App.tsx` opens the populated
 * `auth-service` Service Schematic per PRD §17 Wave 2's acceptance
 * conditions — reachable with `?view=empty-stack` for a human to look at
 * (`docs/overnight-jobs/overnight-2/handoffs/w2-shell.md` says so). The
 * action is drawn disabled: writing the first service needs
 * `schematify_write_node`, which is Wave 1's crate wired in by a later wave,
 * not this one.
 */
export const EMPTY_STACK_LEAD = "A new project. Nothing is drawn yet.";
export const EMPTY_STACK_ACTION = "Create the first service";

export function EmptyStack() {
  return (
    <div className="kv-empty-stack">
      <p className="kv-empty-stack__lead">{EMPTY_STACK_LEAD}</p>
      <button type="button" className="kv-empty-stack__action" disabled>
        {EMPTY_STACK_ACTION}
      </button>
    </div>
  );
}
