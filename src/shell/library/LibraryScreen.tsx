import { useState } from "react";
import { motion } from "framer-motion";
import { settingsBackdrop, settingsScreen } from "../motion";
import { closeLibrary } from "../librarySurface";
import { Close, Check, Plus, WarningTriangle } from "../../ui/Icon";
import { useLibrary } from "./useLibrary";
import type { CatalogRow, InstallProgress } from "../../bindings";
import "./library.css";

/**
 * The app library: three ways in, and what is already installed.
 *
 * Covers the band between the two bars rather than the window, and borrows the
 * settings screen's motion and backdrop rather than defining its own — the two
 * are the same kind of surface, and `settings.css` has the whole argument for
 * why the title bar and status bar stay uncovered.
 *
 * The three sources are laid out as three sections of one screen rather than as
 * tabs. There are exactly three, they are short, and a tab bar over three items
 * hides two of them to save no space at all.
 */
export default function LibraryScreen({ open }: { open: boolean }) {
  const session = useLibrary(open);
  const [typed, setTyped] = useState("");
  const [token, setToken] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const submitRepo = (event: React.FormEvent) => {
    event.preventDefault();
    const input = typed.trim();
    if (!input) return;
    session.installFromRepo(input);
    setTyped("");
  };

  const submitToken = (event: React.FormEvent) => {
    event.preventDefault();
    session.signIn(token);
    setToken("");
    setSigningIn(false);
  };

  const notices = (
    <ul className="library__notices">
      {session.notices.map((notice) => (
        <li key={notice.id} className={`library__notice library__notice--${notice.kind}`}>
          {notice.kind === "error" ? <WarningTriangle /> : <Check />}
          <span>{notice.text}</span>
          <button onClick={() => session.dismiss(notice.id)} aria-label="Dismiss">
            <Close />
          </button>
        </li>
      ))}
    </ul>
  );

  // Mounted whether or not the screen is open, unlike the settings screen, and
  // for one reason: the first run installs the catalog's default apps before
  // anybody has opened anything. Those need somewhere to report to, so when the
  // screen is closed this collapses to a stack of toasts in the corner.
  if (!open) {
    return session.notices.length > 0 ? <aside className="library__toasts">{notices}</aside> : null;
  }

  return (
    <motion.div className="library__backdrop" {...settingsBackdrop} onClick={closeLibrary}>
      <motion.div
        className="library__screen"
        {...settingsScreen}
        role="dialog"
        aria-label="Apps"
        // The backdrop closes on click; the screen is inside it, so without
        // this every click on a control would bubble out and dismiss it.
        onClick={(event) => event.stopPropagation()}
      >
        <header className="library__header">
          <h1 className="library__title">Apps</h1>
          <button className="library__close" onClick={closeLibrary} aria-label="Close">
            <Close />
          </button>
        </header>

        <div className="library__body">
          {session.notices.length > 0 && notices}

          <section className="library__section">
            <h2>Library</h2>
            <p className="library__hint">Apps this build knows about.</p>
            <ul className="library__grid">
              {session.catalog.map((row) => (
                <CatalogCard
                  key={row.id}
                  row={row}
                  progress={session.running.get(row.id)}
                  onInstall={() => session.installFromCatalog(row)}
                />
              ))}
              {session.catalog.length === 0 && <li className="library__empty">Nothing listed.</li>}
            </ul>
          </section>

          <section className="library__section">
            <h2>From a repository</h2>
            <p className="library__hint">
              A GitHub address, or <code>owner/name</code>. Installs the latest release.
            </p>
            <form className="library__row" onSubmit={submitRepo}>
              <input
                className="library__input"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="https://github.com/owner/name"
                aria-label="Repository address"
              />
              <button className="library__button" type="submit" disabled={!typed.trim()}>
                <Plus />
                Install
              </button>
            </form>
            {[...session.running.entries()]
              .filter(([key]) => !session.catalog.some((row) => row.id === key))
              .map(([key, progress]) => (
                <ProgressBar key={key} progress={progress} />
              ))}
            <p className="library__hint">
              {session.signedIn ? "Signed in to GitHub." : "Not signed in — public repos only."}{" "}
              <button className="library__link" onClick={() => setSigningIn((was) => !was)}>
                {session.signedIn ? "Change token" : "Sign in"}
              </button>
            </p>
            {signingIn && (
              <form className="library__row" onSubmit={submitToken}>
                <input
                  className="library__input"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="GitHub personal access token"
                  aria-label="GitHub token"
                />
                <button className="library__button" type="submit">
                  Save
                </button>
              </form>
            )}
          </section>

          <section className="library__section">
            <h2>From a folder</h2>
            <p className="library__hint">
              A checkout on this machine. The folder stays yours — removing the app leaves it.
            </p>
            <button className="library__button" onClick={session.installFromFolder}>
              Choose a folder…
            </button>
          </section>

          <section className="library__section">
            <h2>Installed</h2>
            <ul className="library__installed">
              {session.installed.map((row) => (
                <li key={row.id} className="library__item">
                  <div className="library__itemMain">
                    <span className="library__itemName">{row.resolved?.name ?? row.id}</span>
                    {row.resolved && (
                      <span className="library__version">{row.resolved.version}</span>
                    )}
                    {row.running && <span className="library__badge">running</span>}
                    <span className="library__path">{row.error ?? row.path}</span>
                  </div>
                  <div className="library__itemActions">
                    <label className="library__toggle">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) => session.toggle(row.id, event.target.checked)}
                      />
                      Enabled
                    </label>
                    <button className="library__button" onClick={() => session.reload(row.id)}>
                      Reload
                    </button>
                    <button
                      className="library__button library__button--danger"
                      onClick={() => session.remove(row.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
              {session.installed.length === 0 && (
                <li className="library__empty">Nothing installed yet.</li>
              )}
            </ul>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** One library entry, with whichever of the three states it is in. */
function CatalogCard({
  row,
  progress,
  onInstall,
}: {
  row: CatalogRow;
  progress: InstallProgress | undefined;
  onInstall: () => void;
}) {
  return (
    <li className="library__card">
      <span className="library__cardName">{row.name}</span>
      <span className="library__cardDescription">{row.description}</span>
      <span className="library__cardRepo">{row.repo}</span>
      {progress ? (
        <ProgressBar progress={progress} />
      ) : row.installed ? (
        <span className="library__installedTag">
          <Check />
          Installed
        </span>
      ) : (
        <button className="library__button" onClick={onInstall}>
          <Plus />
          Install
        </button>
      )}
    </li>
  );
}

/**
 * One in-flight install.
 *
 * A `total` of zero means the server sent no content length, which is rendered
 * as an indeterminate bar rather than as 0% — a bar frozen at zero for the whole
 * download reads as a hang.
 */
function ProgressBar({ progress }: { progress: InstallProgress }) {
  const determinate = progress.phase === "downloading" && progress.total > 0;
  const percent = determinate ? Math.round((progress.received / progress.total) * 100) : 0;

  return (
    <div className="library__progress">
      <div
        className={`library__track${determinate ? "" : " library__track--indeterminate"}`}
        role="progressbar"
        aria-valuenow={determinate ? percent : undefined}
      >
        <div className="library__fill" style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
      <span className="library__phase">
        {progress.phase}
        {determinate ? ` ${percent}%` : ""}
      </span>
    </div>
  );
}
