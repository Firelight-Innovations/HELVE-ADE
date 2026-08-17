/**
 * One setting: what it is on the left, what it is set to on the right.
 *
 * The row is the same in a section and in a filtered flat list, which is why it
 * knows nothing about either — it takes a `Setting` and the session, and the two
 * callers arrange them.
 *
 * ## Why "when it applies" is drawn rather than dropped
 *
 * Most settings on this screen are read when something is *made*: a pty spawned,
 * an editor mounted, a window opened. A control that visibly moves and changes
 * nothing on screen is how a settings screen loses trust — the natural reading
 * is that the toggle is broken, not that the value is waiting for the next
 * terminal. `applies` is Rust saying which of those it is, and the line under
 * the control is the only place a person can find out.
 *
 * Nothing is drawn for `now`, deliberately. "Applies immediately" under every
 * control on the screen is noise that trains people to stop reading the line,
 * which costs exactly the settings where it matters.
 */
import ControlFor from "./controls/ControlFor";
import type { Setting, SettingApplies } from "../../bindings";
import type { SettingsSession } from "./useSettings";

export default function SettingRow({
  setting,
  session,
}: {
  setting: Setting;
  session: SettingsSession;
}) {
  const changed = session.isChanged(setting.key);
  const applies = appliesNote(setting.applies);

  return (
    // The 2px accent bar down the left edge is the shell's existing mark for
    // "this row is the one that stands out" — the file explorer's current row
    // and the search overlay's active row both draw it. Reused rather than
    // invented so a changed setting reads as the same kind of emphasis.
    // `data-kind` is read by settings.css, which gives a select the full width
    // under its label — a stack of described options does not fit in the narrow
    // right-hand column the other three controls share.
    <div className="setting" data-kind={setting.control.kind} data-changed={changed || undefined}>
      <div className="setting__label">
        <span className="setting__title">{setting.title}</span>
        {setting.description !== "" && (
          <span className="setting__description">{setting.description}</span>
        )}
      </div>

      <div className="setting__side">
        <div className="setting__control-row">
          {/* Only when the setting has actually been moved. A reset on every row
              would be a column of buttons that mostly do nothing, and its
              presence is the clearest signal that this row is one of the ones
              you changed. */}
          {changed && (
            <button
              type="button"
              className="setting__reset"
              title="Reset to default"
              aria-label={`Reset ${setting.title} to its default`}
              onClick={() => session.reset(setting)}
            >
              <Revert />
            </button>
          )}
          <ControlFor setting={setting} session={session} />
        </div>
        {applies !== null && <span className="setting__applies">{applies}</span>}
      </div>
    </div>
  );
}

/**
 * A counter-clockwise circular arrow: put this back the way it shipped.
 *
 * Local rather than an export in `src/ui/Icon.tsx` because nothing else in the
 * shell has anything to revert — this is the only surface with a stored value a
 * person can move off a default. It follows Icon.tsx's conventions anyway: a
 * 24×24 box, a 2px stroke, and `currentColor` so the button's own token colours
 * it.
 */
function Revert({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 315° of circle with the gap at the top left, so the arrowhead has
          somewhere to point. Drawn counter-clockwise — the direction is the
          whole meaning of the glyph. */}
      <path d="M6.7 6.7A7.5 7.5 0 1 0 12 4.5" />
      <path d="M15 1.9 12 4.5l2.6 3" />
    </svg>
  );
}

/** The sentence under the control, or null when the change is already in force. */
function appliesNote(applies: SettingApplies): string | null {
  switch (applies.when) {
    case "now":
      return null;
    case "next":
      return `Applies to ${applies.what}.`;
    case "restart":
      return "Applies after a restart.";
  }
}
