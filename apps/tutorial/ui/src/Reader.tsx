/**
 * One tutorial, open.
 *
 * The measured column is `tutorial.css`'s job and it is set in `ch` rather than
 * pixels, so the line length stays readable when somebody changes the interface
 * font in Settings — a fixed `max-width` would grow or shrink the words per line
 * with the font and undo the one thing the measure is for.
 */
import type { Body } from "./content/blocks";
import type { Tutorial } from "./useCatalog";
import Blocks from "./Blocks";
import { Check } from "./icons";

export default function Reader({
  tutorial,
  body,
  next,
  done,
  onDone,
  onOpen,
}: {
  tutorial: Tutorial;
  /** Absent when the catalog names a tutorial nothing has been written for. */
  body: Body | undefined;
  next: Tutorial | null;
  done: boolean;
  onDone: (done: boolean) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <article className="tut__reader">
      <header className="tut__reader-head">
        <h1>{tutorial.title}</h1>
        <p className="tut__reader-meta">
          {tutorial.minutes} min · {tutorial.blurb}
        </p>
      </header>

      {body === undefined ? (
        /* The one seam between the Rust catalog and the frontend's prose. An
           honest empty page rather than a crash — and the same page a tutorial
           that is genuinely unwritten would show, so there is nothing to build
           twice. */
        <p className="tut__unwritten">
          This one has not been written yet. It is in the catalog so the shape of what is coming is
          visible; there is nothing to read here.
        </p>
      ) : (
        <>
          <Blocks blocks={body.blocks} />

          <footer className="tut__finish">
            <p className="tut__takeaway">{body.takeaway}</p>
            <div className="tut__finish-row">
              <button
                type="button"
                className={`tut__done${done ? " tut__done--on" : ""}`}
                onClick={() => onDone(!done)}
              >
                <span className="tut__tick" aria-hidden="true">
                  {done && <Check size={11} />}
                </span>
                {done ? "Done" : "Mark as done"}
              </button>

              {next && (
                <button type="button" className="tut__next" onClick={() => onOpen(next.id)}>
                  Next: {next.title} →
                </button>
              )}
            </div>
          </footer>
        </>
      )}
    </article>
  );
}
