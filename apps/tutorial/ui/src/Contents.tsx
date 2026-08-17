/**
 * The sidebar: every tutorial, grouped by section, with what is finished ticked.
 *
 * Always the full list rather than a filtered one. Ten tutorials fit, and a
 * reader who cannot see how much is left cannot tell whether they are three
 * pages into a short thing or a long one — which is the question the progress
 * line at the bottom exists to answer.
 */
import type { Catalog } from "./useCatalog";
import { Check } from "./icons";

export default function Contents({
  catalog,
  openId,
  isDone,
  onOpen,
  onReset,
}: {
  catalog: Catalog;
  openId: string | null;
  isDone: (id: string) => boolean;
  onOpen: (id: string | null) => void;
  onReset: () => void;
}) {
  const sections = [...catalog.sections].sort((a, b) => a.order - b.order);
  const done = catalog.completed.length;
  const total = catalog.tutorials.length;

  return (
    <nav className="tut__contents" aria-label="Tutorials">
      <button
        type="button"
        className={`tut__home${openId === null ? " tut__home--on" : ""}`}
        onClick={() => onOpen(null)}
      >
        All tutorials
      </button>

      {sections.map((section) => (
        <section key={section.id} className="tut__section">
          <h2 className="tut__section-title">{section.title}</h2>
          <ul className="tut__list">
            {catalog.tutorials
              .filter((tutorial) => tutorial.section === section.id)
              .map((tutorial) => (
                <li key={tutorial.id}>
                  <button
                    type="button"
                    className={`tut__link${tutorial.id === openId ? " tut__link--on" : ""}`}
                    onClick={() => onOpen(tutorial.id)}
                  >
                    <span className="tut__tick" aria-hidden="true">
                      {isDone(tutorial.id) && <Check size={11} />}
                    </span>
                    <span className="tut__link-title">{tutorial.title}</span>
                    <span className="tut__link-min">{tutorial.minutes}m</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <footer className="tut__progress">
        <span>
          {done} of {total} done
        </span>
        {/* Only offered once there is something to undo. A permanently visible
            reset on a screen where nothing has happened is an invitation to
            wonder what it would have cleared. */}
        {done > 0 && (
          <button type="button" className="tut__reset" onClick={onReset}>
            Reset
          </button>
        )}
      </footer>
    </nav>
  );
}
