/**
 * The worktree tab's whole body: a vertically split panel with the
 * repository's history on top and this cluster's own changes on the bottom,
 * a draggable divider between them.
 *
 * Meant to become what `WindowRoot` hands `SecondaryPanel`'s `worktreeView`
 * slot in place of `SourceControlView` alone — not wired up by this file (see
 * the props note below).
 *
 * ## Why two sections instead of one
 *
 * The top is about the *repository* — `CommitGraph` over every branch,
 * whichever cluster happens to be active — and the bottom is about *this
 * cluster's own work*: what its worktree has changed since it forked, or, for
 * a cluster with no worktree, the ordinary staged/unstaged view. Switching
 * clusters on the same repository leaves the top alone and replaces the
 * bottom, which is the whole reason they are drawn as two independent
 * sections rather than one scrolling list.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isTomlPath, TOML_LANGUAGE_ID } from "@helve/monaco-languages";
import type {
  GitCommit,
  GitControl,
  GitDiff,
  GitDivergence,
  GitFileChange,
  GitWorktree,
  ReviewControl,
  ReviewSend,
  WorktreeControl,
} from "../contract";
import { GIT_KIND_LETTER, GIT_KIND_TOKEN } from "../contract";
import CommitGraph from "./CommitGraph";
import SourceControlView from "./SourceControlView";
import { gitMessage, type GitStatusHandle } from "./useGitStatus";
import "./worktreePanel.css";

/** Lazy for the same reason `SourceControlView` lazy-loads it: this file is
 *  mounted for the life of the window, and a static import would make every
 *  window pay for Monaco to render a tab most sessions never open.
 *
 *  The annotating wrapper, because a worktree's divergence *is* the
 *  agent-produced diff — what this branch changed since it forked is the thing
 *  a person opens this panel to review. */
const AnnotatedDiff = lazy(() => import("../diff/AnnotatedDiff"));

/** Plenty for a lane diagram a few hundred pixels tall; the graph draws
 *  whatever fits and scrolls the rest, so this only bounds how much history
 *  a `git log` has to walk. */
const GRAPH_LIMIT = 200;

/** The smallest a section may be dragged to, in pixels rather than a
 *  fraction: a narrow-but-nonzero panel width already forces short lines of
 *  text, and a percentage minimum would let one section shrink to nothing
 *  readable on a panel dragged down toward `--w-panel-collapsed`. */
const MIN_SECTION_PX = 120;

const DEFAULT_TOP_RATIO = 0.45;

/** The divider's own height in the flex column, mirroring
 *  `.worktreepanel__divider`'s `height` in `worktreePanel.css`. Duplicated
 *  here because `sectionBasis` below has to subtract it and CSS cannot hand a
 *  number to JavaScript; the two are commented at both ends so a change to
 *  either is visibly a change to a pair. */
const DIVIDER_PX = 1;

/**
 * One section's `flex-basis`.
 *
 * The subtraction is the whole point. Both sections are `flex-shrink: 0` — see
 * the note in `worktreePanel.css` for why — so two bases summing to a plain
 * `100%` plus a divider between them overflows the column by exactly the
 * divider's height, and the panel grows a scrollbar whose entire scrollable
 * range is one pixel. Splitting the divider between the two keeps the sum
 * exact at every ratio, which is the difference between the scrollbar not
 * being *reachable* and it not *existing*.
 */
function sectionBasis(ratio: number): string {
  return `calc(${ratio * 100}% - ${DIVIDER_PX / 2}px)`;
}

export interface WorktreePanelProps {
  /** `null` for "no cluster is active" — renders the empty state below and
   *  calls none of the RPCs, matching every other region's rule for an unset
   *  cluster. */
  clusterId: string | null;
  worktreeControl: WorktreeControl;
  /** Passed straight through to `SourceControlView` for the no-worktree case
   *  — see the `divergence === null` branch below. Cluster-scoped, like
   *  everything else here; it used to be scoped to the focused tool, which is
   *  what made this whole section render an error instead of a change list. */
  gitControl: GitControl;
  /** Passed to both diff surfaces below — this section's divergence view and
   *  the `SourceControlView` that replaces it for a cluster with no worktree. */
  reviewControl: ReviewControl;
  reviewSend: ReviewSend;
  git: GitStatusHandle;
  /**
   * Resolved by the caller, not here. `WorktreeControl.list` returns every
   * worktree of the *repository*, with no field saying which one (if any)
   * belongs to this cluster — that binding is `Cluster.worktree`, which lives
   * on the record `contract.ts` deliberately keeps out of this file (see the
   * header comment there on regions never importing each other's source). So
   * the caller resolves it — from `cluster.worktree?.branch`, falling back to
   * the checked-out branch of the project itself — and hands it down rather
   * than this component guessing at a path match that could pick the wrong one
   * when two clusters share a repo.
   */
  activeBranch: string | null;
}

interface RepoData {
  commits: GitCommit[];
  worktrees: GitWorktree[];
  /** `null` means this cluster works in its project folder, not a worktree —
   *  see `WorktreeControl.divergence`. */
  divergence: GitDivergence | null;
}

export default function WorktreePanel({
  clusterId,
  worktreeControl,
  gitControl,
  reviewControl,
  reviewSend,
  git,
  activeBranch,
}: WorktreePanelProps) {
  const [data, setData] = useState<RepoData | null>(null);
  const [loading, setLoading] = useState(clusterId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clusterId === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Guards the same race `useGitStatus` guards: switching clusters twice
    // quickly leaves two requests in flight, and the slower one resolving
    // last must not overwrite the newer cluster's data with the older one's.
    let live = true;
    setLoading(true);

    Promise.all([
      worktreeControl.graph(clusterId, GRAPH_LIMIT),
      worktreeControl.list(clusterId),
      worktreeControl.divergence(clusterId),
    ]).then(
      ([commits, worktrees, divergence]) => {
        if (!live) return;
        setData({ commits, worktrees, divergence });
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!live) return;
        setData(null);
        setError(gitMessage(reason));
        setLoading(false);
      },
    );

    return () => {
      live = false;
    };
  }, [clusterId, worktreeControl]);

  // --- the divider ---------------------------------------------------------
  // Same pattern as `PaneTree.tsx`'s `Split` and `Frame.tsx`'s panel handle:
  // write the two sections' sizes straight to the DOM for the whole gesture
  // and only tell React once, on pointer-up. A divider that set state on
  // every pointermove would judder — seeing a re-render (and everything
  // downstream of one, here including a mounted Monaco diff editor measuring
  // itself) on every pixel of motion cannot promise 1:1 tracking with the
  // cursor.

  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [topRatio, setTopRatio] = useState(DEFAULT_TOP_RATIO);

  const onDividerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A pointer id the browser no longer considers active throws here;
        // see the identical guard in `PaneTree.tsx`'s `onDividerDown`.
      }

      const rect = container.getBoundingClientRect();
      const total = rect.height;
      if (total <= 0) return;

      const startY = e.clientY;
      const startRatio = topRatio;
      const minRatio = MIN_SECTION_PX / total;
      const maxRatio = 1 - MIN_SECTION_PX / total;
      let nextRatio = startRatio;

      const onMove = (ev: PointerEvent) => {
        const delta = (ev.clientY - startY) / total;
        nextRatio = Math.min(Math.max(startRatio + delta, minRatio), maxRatio);
        if (topRef.current) topRef.current.style.flexBasis = sectionBasis(nextRatio);
        if (bottomRef.current) bottomRef.current.style.flexBasis = sectionBasis(1 - nextRatio);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        // The only place `topRatio` reaches React state — see the header
        // note above. This is view-local, same as `WindowRoot`'s
        // `panelWidth`: a split ratio between two sections of one window's
        // panel means nothing in another window and has no business in
        // Rust's `shell:state`.
        setTopRatio(nextRatio);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [topRatio],
  );

  if (clusterId === null) {
    return (
      <div className="worktreepanel">
        <div className="worktreepanel__quiet">No cluster selected.</div>
      </div>
    );
  }

  if (data === null) {
    // Mirrors `SourceControlView`'s empty state: nothing drawn while the
    // first fetch for a cluster is outstanding, so switching clusters
    // doesn't flash an empty panel before the RPCs resolve. A refetch after
    // the first one leaves the previous cluster's data on screen until the
    // new answer lands — also matching `SourceControlView`/`useGitStatus`,
    // and safe here because of the stale-response guard above.
    if (loading) return null;
    return (
      <div className="worktreepanel">
        <div className="worktreepanel__error">{error}</div>
      </div>
    );
  }

  return (
    <div className="worktreepanel" ref={containerRef}>
      <div
        className="worktreepanel__section worktreepanel__section--top"
        ref={topRef}
        style={{ flexBasis: sectionBasis(topRatio) }}
      >
        <div className="worktreepanel__graph-scroll">
          <CommitGraph
            commits={data.commits}
            worktrees={data.worktrees}
            activeBranch={activeBranch}
          />
        </div>
      </div>

      <div
        className="worktreepanel__divider"
        onPointerDown={onDividerDown}
        role="separator"
        aria-orientation="horizontal"
      />

      <div
        className="worktreepanel__section worktreepanel__section--bottom"
        ref={bottomRef}
        style={{ flexBasis: sectionBasis(1 - topRatio) }}
      >
        {data.divergence === null ? (
          <SourceControlView
            control={gitControl}
            clusterId={clusterId}
            git={git}
            review={reviewControl}
            reviewSend={reviewSend}
          />
        ) : (
          <DivergenceView
            clusterId={clusterId}
            worktreeControl={worktreeControl}
            divergence={data.divergence}
            review={reviewControl}
            reviewSend={reviewSend}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bottom section's non-empty case: a cluster with a worktree
// ---------------------------------------------------------------------------

interface Selection {
  path: string;
}

/**
 * "N files changed since `base` · N commits", the file list, and a diff pane
 * that opens below it on a click — the same click-to-diff shape
 * `SourceControlView` already has, but there is no index here (`staged` is
 * always false on every `GitFileChange` `divergence` returns) so there is no
 * checkbox column and no commit box.
 */
function DivergenceView({
  clusterId,
  worktreeControl,
  divergence,
  review,
  reviewSend,
}: {
  clusterId: string;
  worktreeControl: WorktreeControl;
  divergence: GitDivergence;
  review: ReviewControl;
  reviewSend: ReviewSend;
}) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  // A file selected in one cluster's divergence means nothing in another's —
  // and the merge base backing it may have moved, since `divergenceDiff`
  // takes a `mergeBase` rather than resolving one fresh (see the contract
  // doc on why: a base recomputed between the list and the diff could
  // disagree with what the list was built from).
  useEffect(() => {
    setSelected(null);
    setDiff(null);
    setDiffError(null);
  }, [clusterId]);

  useEffect(() => {
    if (selected === null) {
      setDiff(null);
      return;
    }

    let live = true;
    setDiffError(null);
    worktreeControl.divergenceDiff(clusterId, selected.path, divergence.mergeBase).then(
      (next) => {
        if (live) setDiff(next);
      },
      (reason: unknown) => {
        if (!live) return;
        setDiff(null);
        setDiffError(gitMessage(reason));
      },
    );

    return () => {
      live = false;
    };
  }, [clusterId, worktreeControl, selected, divergence.mergeBase]);

  return (
    <div className="worktreepanel__divergence">
      <div className="worktreepanel__divhead">
        <span className="worktreepanel__divhead-count">
          {divergence.files.length} {divergence.files.length === 1 ? "file" : "files"} changed
        </span>{" "}
        since <span className="worktreepanel__divhead-base">{divergence.base}</span> ·{" "}
        {divergence.commits} {divergence.commits === 1 ? "commit" : "commits"}
      </div>

      <div className="worktreepanel__divlist">
        {divergence.files.length === 0 ? (
          <div className="worktreepanel__quiet">No changes since {divergence.base}</div>
        ) : (
          divergence.files.map((change) => (
            <DivFileRow
              key={change.path}
              change={change}
              selected={selected?.path === change.path}
              onSelect={() => setSelected({ path: change.path })}
            />
          ))
        )}
      </div>

      {selected !== null && (
        <div className="worktreepanel__divdiff">
          <div className="worktreepanel__divdiff-head">
            <span className="worktreepanel__divdiff-path">{selected.path}</span>
            <button
              type="button"
              className="worktreepanel__divdiff-close"
              onClick={() => setSelected(null)}
              aria-label="Close diff"
            >
              ×
            </button>
          </div>
          {diffError !== null ? (
            <div className="worktreepanel__error">{diffError}</div>
          ) : diff === null ? (
            <div className="worktreepanel__quiet">Loading diff…</div>
          ) : (
            <Suspense fallback={<div className="worktreepanel__quiet">Loading diff…</div>}>
              {/* `scope` is "branch" and is fixed rather than derived: every
                  file in a divergence is measured from the fork point, so
                  there is no staged/unstaged distinction here to carry (see
                  `GitDivergence`, whose `staged` is always false). */}
              <AnnotatedDiff
                original={diff.original}
                modified={diff.modified}
                language={isTomlPath(selected.path) ? TOML_LANGUAGE_ID : undefined}
                renderSideBySide={false}
                path={selected.path}
                scope="branch"
                clusterId={clusterId}
                control={review}
                send={reviewSend}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}

/** One row of `divergence.files`. Kind letter, file, directory — the same
 *  three columns `SourceControlView`'s `ChangeRow` draws, minus the checkbox
 *  it has no index to back. */
function DivFileRow({
  change,
  selected,
  onSelect,
}: {
  change: GitFileChange;
  selected: boolean;
  onSelect: () => void;
}) {
  const classes = ["worktreepanel__divrow"];
  if (selected) classes.push("worktreepanel__divrow--selected");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      title={change.renamedFrom ? `${change.path} (was ${change.renamedFrom})` : change.path}
      onClick={onSelect}
    >
      <span className="worktreepanel__divkind" style={{ color: GIT_KIND_TOKEN[change.kind] }}>
        {GIT_KIND_LETTER[change.kind]}
      </span>
      <span
        className={
          change.kind === "deleted"
            ? "worktreepanel__divfile worktreepanel__divfile--deleted"
            : "worktreepanel__divfile"
        }
      >
        {change.file}
      </span>
      <span className="worktreepanel__divdir">{change.dir}</span>
    </button>
  );
}
