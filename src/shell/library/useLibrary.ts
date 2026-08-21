/**
 * Everything the library screen reads and does.
 *
 * One hook rather than several, because the three lists it holds move together:
 * an install changes what is in the catalog's `installed` column, what is in the
 * installed list, and what the switcher offers. `plugins:changed` is the single
 * signal for all of it, so a component that subscribed to only one would show a
 * stale half.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  chooseAndInstallPlugin,
  hasGithubToken,
  installPluginRepo,
  listCatalog,
  listPlugins,
  onInstallProgress,
  onPluginsChanged,
  reloadPlugin,
  setGithubToken,
  setPluginEnabled,
  uninstallPlugin,
  type CatalogRow,
  type InstallProgress,
  type PluginRow,
} from "../../bindings";

/** A message the screen is showing, from an install that finished or failed. */
export interface Notice {
  id: number;
  kind: "ok" | "error";
  text: string;
}

export interface LibrarySession {
  catalog: CatalogRow[];
  installed: PluginRow[];
  /** In-flight installs, keyed by `InstallProgress.key`. */
  running: Map<string, InstallProgress>;
  notices: Notice[];
  signedIn: boolean;
  dismiss: (id: number) => void;
  installFromCatalog: (row: CatalogRow) => void;
  installFromRepo: (input: string) => void;
  installFromFolder: () => void;
  remove: (id: string) => void;
  reload: (id: string) => void;
  toggle: (id: string, enabled: boolean) => void;
  signIn: (token: string) => void;
}

export function useLibrary(active: boolean): LibrarySession {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [installed, setInstalled] = useState<PluginRow[]>([]);
  const [running, setRunning] = useState<Map<string, InstallProgress>>(new Map());
  const [notices, setNotices] = useState<Notice[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  // Monotonic, so two notices with the same text are still two rows. `Date.now`
  // would collide when an install fails twice inside a millisecond, which is
  // exactly what a bad repository address does.
  const nextNotice = useRef(1);

  const say = useCallback((kind: Notice["kind"], text: string) => {
    setNotices((current) => [...current, { id: nextNotice.current++, kind, text }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const refresh = useCallback(() => {
    void listCatalog().then(setCatalog);
    void listPlugins().then(setInstalled);
  }, []);

  // Read once when the screen opens, and again whenever the installed set
  // moves. Not on an interval: nothing changes it but this window and the
  // first-run seeding, and both announce themselves.
  useEffect(() => {
    if (!active) return;
    refresh();
    void hasGithubToken().then(setSignedIn);
  }, [active, refresh]);

  useEffect(() => {
    const stop = onPluginsChanged(refresh);
    return () => {
      void stop.then((off) => off());
    };
  }, [refresh]);

  // Subscribed always, not only while the screen is open, so an install started
  // from the library and then dismissed still reports its outcome — and so the
  // first-run seeding is visible if somebody opens the screen mid-download.
  useEffect(() => {
    const stop = onInstallProgress((progress) => {
      setRunning((current) => {
        const next = new Map(current);
        if (progress.phase === "done" || progress.phase === "failed") {
          next.delete(progress.key);
        } else {
          next.set(progress.key, progress);
        }
        return next;
      });
      if (progress.phase === "done") say("ok", `${progress.name} installed.`);
      if (progress.phase === "failed") {
        say("error", progress.error ?? `${progress.name} could not be installed.`);
      }
    });
    return () => {
      void stop.then((off) => off());
    };
  }, [say]);

  const installFromCatalog = useCallback((row: CatalogRow) => {
    void installPluginRepo(row.repo, row.id, row.private).catch(() => {
      // The progress event already carried the reason and `say` has shown it.
      // Swallowed here so a rejected promise does not also reach the console as
      // an unhandled rejection.
    });
  }, []);

  const installFromRepo = useCallback((input: string) => {
    void installPluginRepo(input).catch(() => {});
  }, []);

  const installFromFolder = useCallback(() => {
    void chooseAndInstallPlugin()
      .then((row) => {
        // `null` is a cancelled dialog, which is not worth a notice.
        if (row) say("ok", `${row.resolved?.name ?? row.id} installed.`);
      })
      .catch((err: unknown) => say("error", String(err)));
  }, [say]);

  const remove = useCallback(
    (id: string) => {
      void uninstallPlugin(id)
        .then(() => say("ok", `${id} removed.`))
        .catch((err: unknown) => say("error", String(err)));
    },
    [say],
  );

  const reload = useCallback(
    (id: string) => {
      void reloadPlugin(id)
        .then(() => say("ok", `${id} reloaded.`))
        .catch((err: unknown) => say("error", String(err)));
    },
    [say],
  );

  const toggle = useCallback(
    (id: string, enabled: boolean) => {
      void setPluginEnabled(id, enabled).catch((err: unknown) => say("error", String(err)));
    },
    [say],
  );

  const signIn = useCallback(
    (token: string) => {
      void setGithubToken(token)
        .then(() => {
          setSignedIn(token.trim().length > 0);
          say("ok", token.trim() ? "Signed in to GitHub." : "Signed out of GitHub.");
        })
        .catch((err: unknown) => say("error", String(err)));
    },
    [say],
  );

  return {
    catalog,
    installed,
    running,
    notices,
    signedIn,
    dismiss,
    installFromCatalog,
    installFromRepo,
    installFromFolder,
    remove,
    reload,
    toggle,
    signIn,
  };
}
