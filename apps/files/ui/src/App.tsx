import { useCallback, useEffect, useRef, useState } from "react";
import { HelveRpcError, host, invoke } from "@helve/bridge";

/**
 * What `files/list` and `files/read` answer with. Mirrors `src-tauri/src/apps/
 * files.rs`, and — as in Home — is restated here rather than imported from the
 * shell's source: an app knows its host only through `@helve/bridge`.
 */
interface Entry {
  name: string;
  path: string;
  kind: "dir" | "file" | "other";
  /** `null` for anything that is not a file. */
  size: number | null;
}

interface Listing {
  path: string;
  /** `null` at a drive root — there is no "up" from there. */
  parent: string | null;
  entries: Entry[];
}

interface FileText {
  path: string;
  text: string;
  /** The file was longer than the backend's read cap; this is its first part. */
  truncated: boolean;
}

/**
 * Files — browse the checkout, read what is in it.
 *
 * The skeleton of a file viewer: a directory on the left, the selected file's
 * text on the right, and the two backend calls that feed them. No editing, no
 * search, no syntax highlighting, no watching for changes on disk — each of
 * those is a decision that deserves making on its own rather than falling out
 * of a scaffold.
 *
 * Every call is guarded by a sequence number rather than only by an unmount
 * flag. Clicking through directories quickly means several `files/list` calls
 * are in flight at once, and they can land out of order; without this, the
 * slower of two would win and the pane would show a directory the user has
 * already left.
 */
export default function App() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [file, setFile] = useState<FileText | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listSeq = useRef(0);
  const readSeq = useRef(0);
  // Set on unmount. Every `.then` checks it, so a call still in flight when the
  // pane goes away resolves into nothing rather than into a warning.
  const dead = useRef(false);
  useEffect(
    () => () => {
      dead.current = true;
    },
    [],
  );

  const openDir = useCallback((path: string | null) => {
    const seq = ++listSeq.current;
    // The selection belongs to the directory it was made in. Clearing both
    // *before* the call means the viewer never shows a file from the previous
    // directory beside the new one's listing, however long the call takes.
    setSelected(null);
    setFile(null);

    void invoke<Listing>("files/list", { path })
      .then((result) => {
        if (dead.current || seq !== listSeq.current) return;
        setListing(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (dead.current || seq !== listSeq.current) return;
        setError(describe("files/list", err));
      });
  }, []);

  const openFile = useCallback((path: string) => {
    const seq = ++readSeq.current;
    setSelected(path);
    setFile(null);

    void invoke<FileText>("files/read", { path })
      .then((result) => {
        if (dead.current || seq !== readSeq.current) return;
        setFile(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (dead.current || seq !== readSeq.current) return;
        // A binary file and a permission error both land here, and the
        // backend's message is the only thing that distinguishes them — so it
        // is shown verbatim rather than replaced with a generic line.
        setError(describe("files/read", err));
      });
  }, []);

  // `null` asks the backend for its default directory: the root of the checkout
  // the running manifest was found in. The frontend deliberately doesn't know
  // what that path is — when projects exist, this call is what will change, and
  // nothing here has to.
  useEffect(() => openDir(null), [openDir]);

  return (
    <div className="app">
      <header className="app__head">
        <h1 className="app__title">Files</h1>
        <span className="app__sub">{listing ? listing.path : "reading…"}</span>
        <span className="app__host">host: {host()}</span>
      </header>

      <div className="app__body">
        {error && <p className="app__error">{error}</p>}

        <div className="app__split">
          <section className="app__pane">
            <div className="app__crumbs">
              <button
                type="button"
                className="app__up"
                onClick={() => listing?.parent && openDir(listing.parent)}
                disabled={!listing?.parent}
              >
                ↑ up
              </button>
              <span className="app__meta">{listing ? `${listing.entries.length} items` : ""}</span>
            </div>

            <div className="app__scroll">
              <ul className="app__rows">
                {listing?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="app__row"
                      aria-current={entry.path === selected}
                      onClick={() =>
                        entry.kind === "dir" ? openDir(entry.path) : openFile(entry.path)
                      }
                      // A socket or a broken symlink has nothing to show, and a
                      // click that opens an error is a worse answer than a
                      // control that says up front it does nothing.
                      disabled={entry.kind === "other"}
                    >
                      <span className="app__name">
                        {entry.kind === "dir" ? `${entry.name}/` : entry.name}
                      </span>
                      <span className="app__meta">
                        {entry.size === null ? "" : formatSize(entry.size)}
                      </span>
                    </button>
                  </li>
                ))}
                {listing?.entries.length === 0 && (
                  <li className="app__row">
                    <span className="app__name app__sub">empty directory</span>
                  </li>
                )}
              </ul>
            </div>
          </section>

          <section className="app__pane">
            {file ? (
              <>
                <div className="app__crumbs">
                  <span className="app__path">{file.path}</span>
                  {file.truncated && <span className="app__meta">first 256 KiB</span>}
                </div>
                <pre className="app__code">{file.text}</pre>
              </>
            ) : (
              <p className="app__note">
                {selected ? "Reading…" : "Select a file to read it."}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Bytes as a person reads them. Binary units, since these are file sizes. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above — enough to tell 1.2 MiB from 1.9 MiB
  // without printing a precision the number doesn't carry.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The failing method, plus whatever the host said about why. */
function describe(method: string, err: unknown): string {
  if (err instanceof HelveRpcError) return `${method} — [${err.code}] ${err.message}`;
  return `${method} — ${String(err)}`;
}
