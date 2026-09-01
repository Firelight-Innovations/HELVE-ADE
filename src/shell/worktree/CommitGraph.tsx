/**
 * The commit graph — a vertical lane diagram of a repository's history,
 * newest commit at the top. Renders whatever `WorktreeControl.graph` returns
 * (`../contract`'s `GitCommit[]`, already newest-first) with one row per
 * commit and a small SVG per row for the lane lines that connect it to its
 * parents.
 *
 * Not wired into `SecondaryPanel` by this file — see `SourceControlView.tsx`
 * for how that view plugs into the panel's `worktreeView` slot; this
 * component is meant to be composed alongside it the same way, by whichever
 * view owns the worktree tab's layout.
 *
 * The layout math (which column a commit sits in) lives in `layoutCommits`
 * below, kept separate from rendering and exported so it can be tested
 * without a DOM. Everything after that is mechanical: turn lane numbers into
 * x-coordinates and draw lines.
 */
import { useMemo, useRef } from "react";
import type { GitCommit, GitWorktree } from "../contract";
import { GitBranch } from "../../ui/Icon";
import "./commitGraph.css";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * One commit, placed into a lane, with enough of the surrounding lane state
 * to draw every line that touches its row.
 *
 * `lanesBefore`/`lanesAfter` are snapshots of the *whole* lane array — index
 * is the column, value is the sha that column is waiting to see next, or
 * `null` if the column is free — taken immediately before and after this
 * commit was placed. They are intentionally not trimmed to the commit's own
 * neighbourhood: keeping the full array on every row means a row can be
 * rendered on its own, with no lookup into the row above or below it, which
 * is what let the SVG in `CommitRow` stay a pure function of one `PlacedCommit`.
 */
export interface PlacedCommit {
  commit: GitCommit;
  /** The column this commit's own node sits in. */
  lane: number;
  lanesBefore: (string | null)[];
  lanesAfter: (string | null)[];
}

/**
 * Assigns every commit a lane (column index) by walking the list newest to
 * oldest and tracking, per lane, which sha that lane is waiting to see next.
 * The two placement rules are documented on the statements that apply them.
 *
 * Because lanes are only ever reused or appended, never removed, `lane` is
 * never negative and never `NaN`, and a parent sha that never appears later
 * in `commits` (history truncated by the row limit) simply leaves its lane
 * waiting forever — the array carries a lane nothing will ever resolve, and
 * `CommitRow` draws that as a line that runs to the bottom of the list and
 * stops, rather than a crash.
 */
export function layoutCommits(commits: GitCommit[]): PlacedCommit[] {
  const lanes: (string | null)[] = [];
  const placed: PlacedCommit[] = [];

  for (const commit of commits) {
    const lanesBefore = lanes.slice();

    // The invariant that makes this work: a lane's value is always "the sha
    // that will justify this lane's next line downward." A commit claims
    // whichever lane is already waiting for its own sha — that is what makes a
    // fork's two children land in different lanes while their shared parent
    // lands back in the lane that got there first, drawing the two lanes
    // converging into one. A commit nothing is waiting for (a branch tip, or
    // the very first commit this function sees) has no lane to inherit, so it
    // takes the first free column or opens a new one on the right.
    let lane = lanes.indexOf(commit.sha);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    // A second (or third...) lane also waiting for this exact sha is another
    // child of the same parent — a fork converging back together here. It is
    // absorbed into `lane` and closed; it never gets its own lane again.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.sha) lanes[i] = null;
    }

    // The lane is handed to the first parent — the ordinary, non-merge case,
    // where a lane just continues downward under a new sha. Every *additional*
    // parent (two or more means this commit is a merge) opens another lane for
    // itself, reusing a free column before appending one, so a history with
    // many merges does not grow one column per merge forever. A commit with no
    // parents (a root) hands its lane nothing, which closes it.
    lanes[lane] = commit.parents[0] ?? null;
    for (let p = 1; p < commit.parents.length; p++) {
      let mergeLane = lanes.indexOf(null);
      if (mergeLane === -1) {
        mergeLane = lanes.length;
        lanes.push(null);
      }
      lanes[mergeLane] = commit.parents[p];
    }

    placed.push({ commit, lane, lanesBefore, lanesAfter: lanes.slice() });
  }

  return placed;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const LANE_W = 22;
const NODE_R = 5;

/** How wide the lane column is allowed to get before it clips, mirroring
 *  `.commitgraph__graph`'s `max-width` in `commitGraph.css`. Duplicated here
 *  because CSS cannot tell JavaScript whether a clip is happening and the fade
 *  must only appear when one is; the two are commented at both ends so a change
 *  to either is visibly a change to a pair. */
const GRAPH_MAX_W = 123;

/** Radius of the halo ring drawn around a prominent node (see the `prominent`
 *  prop on `CommitRow`) — a plain circle at `NODE_R` for every other commit,
 *  this one extra ring for HEAD and live-branch tips, rather than also
 *  swelling the node itself or hollowing it out. One consistent treatment
 *  for "this one matters" beats stacking several. */
const NODE_RING_R = NODE_R + 3;

/** Lane colours, cycled by lane index. Widened from the four semantic status
 *  colours (`--accent`/`--ok`/`--warn`/`--err`) to eight: those four mean
 *  something specific everywhere else in the shell (focus, healthy, warning,
 *  error), but here the colour carries no meaning beyond "which lane" — a
 *  history with five or more concurrent branches was reusing colour 0 for
 *  lane 4 and making two unrelated branches look like the same line. The four
 *  `--graph-*` tokens in `tokens.css` exist only to give this rotation more
 *  room; nothing else in the shell should reach for them. */
const LANE_COLORS = [
  "var(--accent)",
  "var(--ok)",
  "var(--warn)",
  "var(--err)",
  "var(--graph-blue)",
  "var(--graph-violet)",
  "var(--graph-teal)",
  "var(--graph-pink)",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function laneX(lane: number): number {
  return lane * LANE_W + LANE_W / 2;
}

/** A straight segment, in viewBox units — x in pixels, y in percent of the
 *  row's actual (CSS-driven) height, see `CommitRow`'s `<svg>` for why percent. */
function straight(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

/** An S-curve between two lanes: flat where it leaves each end, so a curve
 *  reads as "this line changes lanes here" rather than a diagonal slash. This
 *  is the one piece of the GitKraken-style redraw that isn't new — every
 *  lane change already went through here — but it is doing more visual work
 *  now that rails are thicker and lanes are wider (`LANE_W`), so the two
 *  control points stay pinned to the flat sections at each end rather than
 *  bowing outward, which is what keeps a fork or merge reading as one
 *  continuous line instead of a hook. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

/** One drawn line, already coloured. `stroke` rather than a lane the caller
 *  resolves, and that is the point: the bug this shape prevents was a component
 *  painting every path in one colour it picked itself. */
export interface Segment {
  d: string;
  /** A `var(--...)` token from `LANE_COLORS`, chosen by the lane this line runs
   *  in — for a curve, the end that is *not* the node. */
  stroke: string;
}

/**
 * Every line segment this row's `<svg>` needs to draw, derived purely from
 * `placed`'s own before/after snapshots — no neighbouring row is consulted,
 * which is what keeps a row renderable in isolation (and keeps this
 * function easy to reason about: it only ever looks at one commit's own
 * lane state).
 *
 * **Each segment is coloured by its own lane, not the row's.** A row's `<svg>`
 * is mostly lines with nothing to do with the commit beside them: every branch
 * open anywhere in the visible history passes through every row. Painting them
 * all in the node's colour made one continuous branch change colour on every
 * row, according to which column its neighbours happened to occupy — a
 * five-branch history drew as horizontal stripes rather than as five rails. A
 * curve takes the lane of the end that is *not* the node, so a line keeps its
 * own colour right up to where it joins or leaves.
 *
 * y is 0/50/100 throughout — top edge, node centre, bottom edge — read as
 * percent of the row by the `viewBox`/`preserveAspectRatio="none"` pairing
 * in `CommitRow`, so this never has to know the row's actual pixel height.
 */
export function rowSegments(placed: PlacedCommit): Segment[] {
  const segments: Segment[] = [];
  const laneCount = Math.max(placed.lanesBefore.length, placed.lanesAfter.length);
  const ownX = laneX(placed.lane);

  for (let idx = 0; idx < laneCount; idx++) {
    const before = placed.lanesBefore[idx] ?? null;
    const after = placed.lanesAfter[idx] ?? null;
    const x = laneX(idx);

    if (idx === placed.lane) {
      // The node's own column: a line in from above if something was
      // waiting for this commit, a line out below to its first parent (or
      // nothing, for a root commit — `after` is null and this is skipped).
      if (before !== null) segments.push({ d: straight(x, 0, x, 50), stroke: laneColor(idx) });
      if (after !== null) segments.push({ d: straight(x, 50, x, 100), stroke: laneColor(idx) });
      continue;
    }

    if (before !== null && before === placed.commit.sha) {
      // Another lane was also waiting for this sha — a fork converging into
      // this node. Drawn as a curve into the node rather than the column's
      // own straight line, and the column is not revisited below because
      // `layoutCommits` already closed it (it will not appear in `after`).
      segments.push({ d: curve(x, 0, ownX, 50), stroke: laneColor(idx) });
      continue;
    }

    if (before !== null && after !== null && before === after) {
      // Untouched by this commit: a lane elsewhere in the graph just passing
      // through this row.
      segments.push({ d: straight(x, 0, x, 100), stroke: laneColor(idx) });
      continue;
    }

    if (before === null && after !== null) {
      // A column that did not exist above this row but does below it can
      // only be a merge parent this commit just opened — draw the branch
      // out of the node rather than a line with nothing above it.
      segments.push({ d: curve(ownX, 50, x, 100), stroke: laneColor(idx) });
    }

    // The remaining case (open above, closed below, unrelated to this sha)
    // cannot occur: a lane only closes when the commit it was waiting for is
    // placed, and that commit is always `placed.lane` itself.
  }

  return segments;
}

export interface CommitGraphProps {
  /** Newest first, as `WorktreeControl.graph` returns it. */
  commits: GitCommit[];
  worktrees: GitWorktree[];
  /** The branch the current cluster is on — highlighted distinctly from any
   *  other branch that merely has a worktree somewhere. */
  activeBranch: string | null;
  onSelect?: (sha: string) => void;
  selected?: string | null;
}

export default function CommitGraph({
  commits,
  worktrees,
  activeBranch,
  onSelect,
  selected,
}: CommitGraphProps) {
  const placed = useMemo(() => layoutCommits(commits), [commits]);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Only a branch with a live checkout is worth badging — see the prop doc.
  // `GitWorktree.branch` is null for a detached HEAD, which is not a name
  // any ref could match, so it is filtered out rather than compared.
  const liveBranches = useMemo(
    () => new Set(worktrees.map((w) => w.branch).filter((b): b is string => b !== null)),
    [worktrees],
  );

  // A commit is "prominent" — larger node, halo ring — if it's checked out
  // *somewhere*: the active cluster's own HEAD and the tip of any other
  // branch with a live worktree both read the same way, per `GitWorktree.head`
  // rather than `refs`, because `head` is the exact sha git has checked out
  // while a ref array can list a branch name against a commit with nothing
  // pointing a working tree at it at all.
  const prominentShas = useMemo(() => new Set(worktrees.map((w) => w.head)), [worktrees]);

  const laneCount = placed.reduce(
    (max, p) => Math.max(max, p.lanesBefore.length, p.lanesAfter.length),
    0,
  );

  if (placed.length === 0) {
    return <div className="commitgraph__quiet">No commits</div>;
  }

  const moveSelection = (from: string | null | undefined, delta: number) => {
    if (!onSelect) return;
    const index = from ? placed.findIndex((p) => p.commit.sha === from) : -1;
    const next =
      placed[
        clamp(
          index === -1 ? (delta > 0 ? 0 : placed.length - 1) : index + delta,
          0,
          placed.length - 1,
        )
      ];
    onSelect(next.commit.sha);
    rowRefs.current.get(next.commit.sha)?.focus();
  };

  return (
    <div
      className="commitgraph"
      role="listbox"
      aria-label="Commit history"
      onKeyDown={(e) => {
        // Roving focus over a controlled `selected` prop rather than local
        // state: the caller owns which commit is selected (it likely also
        // drives a diff or detail pane from it), so a key press has to go
        // through `onSelect` the same way a click does, not sidestep it.
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSelection(selected, 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSelection(selected, -1);
        } else if (e.key === "Home") {
          e.preventDefault();
          onSelect?.(placed[0].commit.sha);
          rowRefs.current.get(placed[0].commit.sha)?.focus();
        } else if (e.key === "End") {
          e.preventDefault();
          const last = placed[placed.length - 1];
          onSelect?.(last.commit.sha);
          rowRefs.current.get(last.commit.sha)?.focus();
        }
      }}
    >
      {placed.map((p, i) => (
        <CommitRow
          key={p.commit.sha}
          placed={p}
          laneCount={laneCount}
          liveBranches={liveBranches}
          activeBranch={activeBranch}
          prominent={prominentShas.has(p.commit.sha)}
          selected={selected === p.commit.sha}
          tabIndex={selected ? (selected === p.commit.sha ? 0 : -1) : i === 0 ? 0 : -1}
          onSelect={onSelect}
          rowRef={(el) => {
            if (el) rowRefs.current.set(p.commit.sha, el);
            else rowRefs.current.delete(p.commit.sha);
          }}
        />
      ))}
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function CommitRow({
  placed,
  laneCount,
  liveBranches,
  activeBranch,
  prominent,
  selected,
  tabIndex,
  onSelect,
  rowRef,
}: {
  placed: PlacedCommit;
  laneCount: number;
  liveBranches: Set<string>;
  activeBranch: string | null;
  prominent: boolean;
  selected: boolean;
  tabIndex: number;
  onSelect?: (sha: string) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const { commit } = placed;
  const segments = useMemo(() => rowSegments(placed), [placed]);

  const classes = ["commitgraph__row"];
  if (selected) classes.push("commitgraph__row--selected");

  return (
    <div
      ref={rowRef}
      className={classes.join(" ")}
      role="option"
      aria-selected={selected}
      tabIndex={onSelect ? tabIndex : undefined}
      onClick={() => onSelect?.(commit.sha)}
    >
      {/* Fixed width in lane units, clipped rather than shrunk once a history
          gets wide: shrinking `LANE_W` to fit more lanes makes the nodes
          overlap and the graph unreadable well before it makes the column
          narrow enough to matter, and a history with more than a handful of
          concurrent lanes is rare in the repositories this panel opens.

          The `--clipped` modifier fades that edge when the clip is actually
          happening. Without it the widest lane is simply chopped mid-stroke,
          which reads as a rendering fault rather than as "there is more of
          this graph than fits" — the one thing a person needs to know before
          they conclude a branch ends here. Decided in JS rather than CSS
          because the width is known here and nowhere else. */}
      <div
        className={
          laneCount * LANE_W > GRAPH_MAX_W
            ? "commitgraph__graph commitgraph__graph--clipped"
            : "commitgraph__graph"
        }
        style={{ width: laneCount * LANE_W }}
      >
        <svg
          className="commitgraph__lines"
          width={laneCount * LANE_W}
          height="100%"
          viewBox={`0 0 ${laneCount * LANE_W} 100`}
          preserveAspectRatio="none"
        >
          {segments.map((segment, i) => (
            <path
              key={i}
              d={segment.d}
              className="commitgraph__line"
              style={{ stroke: segment.stroke }}
            />
          ))}
        </svg>
        {/* The node and its ring are plain positioned elements, not more SVG
            geometry, and that's deliberate: the `<svg>` above stretches its
            *y* axis alone to fit the row's actual CSS height (viewBox height
            100 = row height in percent — see the block comment on
            `rowSegments`), which is exactly what a vertical rail needs but
            is fatal to a circle — a `<circle r>` drawn in that same
            non-uniformly-scaled space renders as a flattened ellipse, not a
            dot. Positioning these in real pixels sidesteps that: x comes
            straight from `laneX` (the svg's x axis is never stretched,
            so the two stay aligned), and y is simply "the row's vertical
            centre" via `top: 50%`, which is true regardless of row height
            and needs no coordinate translation at all. The ring is the
            earlier sibling so it paints first and the fill sits above it. */}
        {prominent && (
          <span
            className="commitgraph__node-ring"
            style={{
              left: laneX(placed.lane),
              width: NODE_RING_R * 2,
              height: NODE_RING_R * 2,
              borderColor: laneColor(placed.lane),
            }}
          />
        )}
        <span
          className="commitgraph__node"
          style={{
            left: laneX(placed.lane),
            width: NODE_R * 2,
            height: NODE_R * 2,
            background: laneColor(placed.lane),
          }}
        />
      </div>

      <span className="commitgraph__summary" title={commit.summary}>
        {commit.summary}
      </span>

      {commit.refs.length > 0 && (
        <span className="commitgraph__refs">
          {commit.refs.map((ref) => (
            <RefBadge
              key={ref}
              name={ref}
              active={ref === activeBranch}
              live={liveBranches.has(ref)}
            />
          ))}
        </span>
      )}

      <span className="commitgraph__meta">
        <span className="commitgraph__sha" title={commit.sha}>
          {commit.short}
        </span>
        <span className="commitgraph__author" title={commit.author}>
          {commit.author}
        </span>
        {/* The compact stamp is the only thing on this row that cannot be read
            precisely — "5d" covers a span of a day. The exact time is one
            hover away rather than a second column, which the row has no width
            for. `title` rather than `<time dateTime>`: nothing consumes the
            machine-readable form, and only one of the two is visible. */}
        <span className="commitgraph__when" title={exactTime(commit.when)}>
          {relativeTime(commit.when)}
        </span>
      </span>
    </div>
  );
}

/** A branch ref chip. Three treatments, ascending: a plain local branch with
 *  no checkout is dim text (it is history, not something you could switch
 *  into from here); one with a live worktree gets the branch glyph and a
 *  surface behind it; the active cluster's own branch gets the accent wash
 *  instead of the neutral one, which is the same "this one" language the
 *  accent already carries everywhere else in the shell.
 *
 *  `title` because the chip itself is capped and ellipsised in CSS — a branch
 *  named for a ticket and its whole summary is a real thing people cut, and
 *  before the cap one of them pushed the sha, author and date off the row
 *  entirely. */
function RefBadge({ name, active, live }: { name: string; active: boolean; live: boolean }) {
  const classes = ["commitgraph__ref"];
  if (live) classes.push("commitgraph__ref--live");
  if (active) classes.push("commitgraph__ref--active");

  return (
    <span className={classes.join(" ")} title={name}>
      {live && <GitBranch size={9} strokeWidth={2} />}
      <span className="commitgraph__ref-name">{name}</span>
    </span>
  );
}

/**
 * A compact "3m", "2h", "5d" style stamp rather than `Intl.RelativeTimeFormat`'s
 * "3 minutes ago" — this column sits to the right of the summary in a panel
 * that can be dragged down to 240px, and the verbose form is the first thing
 * that would have to go missing to fit.
 */
function relativeTime(unixSeconds: number): string {
  const deltaSeconds = Math.max(0, Date.now() / 1000 - unixSeconds);
  const steps: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Infinity, "y"],
  ];

  let value = deltaSeconds;
  for (const [span, unit] of steps) {
    if (value < span) return `${Math.max(1, Math.floor(value))}${unit}`;
    value /= span;
  }
  return `${Math.floor(value)}y`;
}

/**
 * The same instant, in full, for the stamp's tooltip.
 *
 * The viewer's own locale and zone, with no format string: a commit time means
 * "when it happened here", and every other date this shell shows a person is
 * left to `Intl` for the same reason. `GitCommit.when` is Unix **seconds**,
 * which is the multiplication this and `relativeTime` both exist to remember.
 */
function exactTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
