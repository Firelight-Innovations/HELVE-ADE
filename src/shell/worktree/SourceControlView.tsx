/**
 * The source-control tab's body — plugs into `SecondaryPanel`'s `worktreeView`
 * slot (src/shell/panel/SecondaryPanel.tsx, `worktreeView?: ReactNode`).
 *
 * Replaces `WorktreeView`, which rendered one flat change list from a
 * subscription and had nowhere to put the index. This is the whole MVP loop:
 * branch, staged and unstaged sections, a checkbox per file that stages or
 * unstages it, a click that shows that file's diff, and a commit box.
 *
 * The status itself is *not* owned here — see `useGitStatus.ts` for why it
 * lives in `WindowRoot` and arrives as a prop. Everything else (which file is
 * selected, its diff, the commit message) is view-local and deliberately reset
 * when the shown cluster changes: none of it means anything in another repo.
 *
 * ## Scoped to a cluster, not a tool
 *
 * This used to take a tool id, and every call it made resolved through
 * `git.rs`'s `repo()` — which looks an id up in `StackSnapshot.tools`, the
 * `helve.toml` stack-component pins. Those are a different id space from the
 * shell's own apps, and `discovery.rs`'s `ENABLED_TOOLS` is `&[]`, so that list
 * is empty for every project. The lookup could therefore only ever fail: every
 * call from here came back `UnknownTool`, and the panel rendered "Git
 * unavailable" where the change list should have been. A cluster id resolves
 * through `project::cluster_path` instead, which follows the worktree-or-project
 * precedence a cluster actually has.
 *
 * No motion, for the same reason `WorktreeView` had none — the handoff's
 * motion section is explicit that this list stays at native scroll speed.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { isTomlPath, TOML_LANGUAGE_ID } from "@helve/monaco-languages";
import type { GitControl, GitDiff, GitFileChange } from "../contract";
import { GIT_KIND_LETTER, GIT_KIND_TOKEN } from "../contract";
import { GitBranch } from "../../ui/Icon";
import { gitMessage, type GitStatusHandle } from "./useGitStatus";
import "./worktree.css";

/**
 * Lazy because `DiffView` pulls in Monaco and its worker chunk the moment the
 * module is evaluated, and `SecondaryPanel` keeps this view mounted for the
 * life of the window — a static import would make every window pay for Monaco
 * at startup to render a pane most sessions never open. The import starts on
 * the first click of a file, which is also when the diff request goes out.
 */
const DiffView = lazy(() => import("../diff/DiffView"));

export interface SourceControlViewProps {
  control: GitControl;
  /** `null` when no cluster is active — the empty state. */
  clusterId: string | null;
  git: GitStatusHandle;
}

/** Which row is open in the diff pane. The pair, not just the path: a path can
 *  be in both lists at once, and those are two different diffs. */
interface Selection {
  path: string;
  staged: boolean;
}

export default function SourceControlView({ control, clusterId, git }: SourceControlViewProps) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const { status, loading, refresh } = git;

  useEffect(() => {
    setSelected(null);
    setDiff(null);
    setMessage("");
    setFailure(null);
  }, [clusterId]);

  useEffect(() => {
    if (clusterId === null || selected === null) {
      setDiff(null);
      return;
    }

    let live = true;
    control.diff(clusterId, selected.path, selected.staged).then(
      (next) => {
        if (live) setDiff(next);
      },
      (reason: unknown) => {
        if (!live) return;
        setDiff(null);
        setFailure(gitMessage(reason));
      },
    );

    return () => {
      live = false;
    };
  }, [control, clusterId, selected]);

  const toggle = useCallback(
    async (change: GitFileChange) => {
      if (clusterId === null || busy) return;
      setBusy(true);
      setFailure(null);
      try {
        if (change.staged) await control.unstage(clusterId, [change.path]);
        else await control.stage(clusterId, [change.path]);
        // The row is about to move to the other list, which makes the open
        // diff the wrong side of the index. Close it rather than show a stale
        // one.
        if (selected?.path === change.path) setSelected(null);
        refresh();
      } catch (reason: unknown) {
        setFailure(gitMessage(reason));
      } finally {
        setBusy(false);
      }
    },
    [busy, control, refresh, selected, clusterId],
  );

  const commit = useCallback(async () => {
    if (clusterId === null || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await control.commit(clusterId, message.trim());
      setMessage("");
      setSelected(null);
      refresh();
    } catch (reason: unknown) {
      setFailure(gitMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [busy, control, message, refresh, clusterId]);

  if (clusterId === null) return <EmptyState kind="no-cluster" />;
  if (status === null) {
    // `loading` is what keeps this from flashing between a cluster being
    // selected and its status arriving.
    if (loading) return null;
    return git.error !== null ? <EmptyState kind="error" detail={git.error} /> : <EmptyState kind="not-a-repo" />;
  }

  const canCommit = !busy && status.staged.length > 0 && message.trim() !== "";

  return (
    <div className="worktree">
      <BranchRow branch={status.branch} ahead={status.ahead} behind={status.behind} count={changeCount(status)} />

      <div className="worktree__lists">
        <Section
          title="Staged Changes"
          changes={status.staged}
          selected={selected}
          busy={busy}
          onToggle={toggle}
          onSelect={setSelected}
        />
        <Section
          title="Changes"
          changes={status.unstaged}
          selected={selected}
          busy={busy}
          onToggle={toggle}
          onSelect={setSelected}
        />
        {changeCount(status) === 0 && <div className="worktree__quiet">No changes</div>}
      </div>

      {selected !== null && (
        <div className="worktree__diff">
          <div className="worktree__diff-head">
            <span className="worktree__diff-path">{selected.path}</span>
            <button
              type="button"
              className="worktree__diff-close"
              onClick={() => setSelected(null)}
              aria-label="Close diff"
            >
              ×
            </button>
          </div>
          {diff === null ? (
            <div className="worktree__quiet">Loading diff…</div>
          ) : (
            <Suspense fallback={<div className="worktree__quiet">Loading diff…</div>}>
              {/* Inline rather than side by side: see `renderSideBySide` in
                  DiffViewProps for why the panel's width settles this.

                  `language` is TOML or nothing, because that is the entire set
                  `DiffView` can tokenize — its header explains why. Decided
                  here from the path rather than inside `DiffView` because a
                  path is what this view has; asked of `@helve/monaco-languages`
                  rather than answered inline because that package owns which
                  extensions its grammar claims, and it is Monaco-free, so
                  importing it does not undo the `lazy` boundary above. */}
              <DiffView
                original={diff.original}
                modified={diff.modified}
                language={isTomlPath(selected.path) ? TOML_LANGUAGE_ID : undefined}
                renderSideBySide={false}
              />
            </Suspense>
          )}
        </div>
      )}

      <div className="worktree__commit">
        {failure !== null && <div className="worktree__error">{failure}</div>}
        <textarea
          className="worktree__commit-box"
          placeholder="Commit message"
          value={message}
          rows={2}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button type="button" className="worktree__commit-btn" disabled={!canCommit} onClick={() => void commit()}>
          Commit
        </button>
      </div>
    </div>
  );
}

function changeCount(status: { staged: GitFileChange[]; unstaged: GitFileChange[] }): number {
  return status.staged.length + status.unstaged.length;
}

/** Icon, branch name, its ahead/behind, then the total change count. Zeros are
 *  omitted rather than printed — a branch with no upstream would otherwise
 *  claim to be exactly level with one. */
function BranchRow({
  branch,
  ahead,
  behind,
  count,
}: {
  branch: string;
  ahead: number;
  behind: number;
  count: number;
}) {
  return (
    <div className="worktree__branch">
      <GitBranch size={13} />
      <span className="worktree__branch-name">{branch}</span>
      {(ahead > 0 || behind > 0) && (
        <span className="worktree__branch-track">
          ↑{ahead} ↓{behind}
        </span>
      )}
      <span className="worktree__branch-spacer" />
      <span className="worktree__branch-count">
        {count} {count === 1 ? "change" : "changes"}
      </span>
    </div>
  );
}

function Section({
  title,
  changes,
  selected,
  busy,
  onToggle,
  onSelect,
}: {
  title: string;
  changes: GitFileChange[];
  selected: Selection | null;
  busy: boolean;
  onToggle: (change: GitFileChange) => void;
  onSelect: (selection: Selection) => void;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="worktree__section">
      <div className="worktree__section-head">
        <span>{title}</span>
        <span className="worktree__section-count">{changes.length}</span>
      </div>
      {changes.map((change) => (
        <ChangeRow
          key={change.path}
          change={change}
          selected={selected?.path === change.path && selected.staged === change.staged}
          busy={busy}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * One changed-file row: a checkbox that is the file's staged-ness, the status
 * letter, the file name, then the directory as its own dimmer column —
 * `GitFileChange` splits `file` and `dir` for exactly this reason, so they are
 * never concatenated back together here.
 *
 * The checkbox and the label are separate controls rather than one row-wide
 * click with a hit-test, because they do genuinely different things: one
 * mutates the index, the other only changes what the diff pane is showing.
 */
function ChangeRow({
  change,
  selected,
  busy,
  onToggle,
  onSelect,
}: {
  change: GitFileChange;
  selected: boolean;
  busy: boolean;
  onToggle: (change: GitFileChange) => void;
  onSelect: (selection: Selection) => void;
}) {
  const classes = ["worktree__row"];
  if (selected) classes.push("worktree__row--selected");

  return (
    <div className={classes.join(" ")}>
      <input
        type="checkbox"
        className="worktree__check"
        checked={change.staged}
        disabled={busy}
        aria-label={change.staged ? `Unstage ${change.path}` : `Stage ${change.path}`}
        onChange={() => onToggle(change)}
      />
      <button
        type="button"
        className="worktree__rowtext"
        title={change.renamedFrom ? `${change.path} (was ${change.renamedFrom})` : change.path}
        onClick={() => onSelect({ path: change.path, staged: change.staged })}
      >
        <span className="worktree__kind" style={{ color: GIT_KIND_TOKEN[change.kind] }}>
          {GIT_KIND_LETTER[change.kind]}
        </span>
        <span
          className={
            change.kind === "deleted" ? "worktree__file worktree__file--deleted" : "worktree__file"
          }
        >
          {change.file}
        </span>
        <span className="worktree__dir">{change.dir}</span>
      </button>
    </div>
  );
}

/**
 * The three ways this panel has nothing to draw. The treatment is the crop's
 * (glyph, title, body — docs/handoffs/shell-spec.html ~lines 234-248); the old
 * "Add worktree" button is gone, because there is no command behind it and it
 * was already rendering inert.
 */
function EmptyState({ kind, detail }: { kind: "no-cluster" | "not-a-repo" | "error"; detail?: string }) {
  const { title, body } =
    kind === "no-cluster"
      ? {
          title: "No cluster selected",
          body: "Open a project in a cluster to see its source control.",
        }
      : kind === "not-a-repo"
        ? {
            title: "Not a git repository",
            body: "This cluster has no project open, or its project is not a git repository.",
          }
        : { title: "Git unavailable", body: detail ?? "" };

  return (
    <div className="worktree__empty">
      <GitBranch size={28} strokeWidth={1.6} className="worktree__empty-glyph" />
      <div className="worktree__empty-title">{title}</div>
      <div className="worktree__empty-body">{body}</div>
    </div>
  );
}
