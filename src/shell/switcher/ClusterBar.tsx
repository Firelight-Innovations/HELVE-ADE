import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  Cluster,
  ClusterMember,
  DragHandleProps,
  DropTarget,
  ToolHealth,
  ToolPresentation,
} from "../contract";
import { instant, instantOut, snap } from "../motion";
import { useDropZone } from "../drag/dropZones";
import { Close, Plus, Search, WarningTriangle } from "../../ui/Icon";
import OverlayScrollbar from "../scrollbar/OverlayScrollbar";
import HealthPopover, { type UnhealthyTool } from "./HealthPopover";
import AddAppButton, { type AppsMenuHandlers } from "./AddAppButton";
import "./switcher.css";

/**
 * The one tab bar — clusters as groups, and the open cluster's contents inline.
 *
 * This is Chrome's tab-group model, and the reason to copy it is that a cluster
 * is exactly what a tab group is: a set of tabs you are keeping together for one
 * piece of work. Clicking a cluster chip expands that cluster's apps and
 * terminals to the right of it and collapses whichever was expanded before, so
 * the row only ever shows one cluster's contents at a time and the rest stay as
 * chips with a count.
 *
 * ## Why every tab is here and nowhere else
 *
 * Panes used to draw their own tab strips and the panel drew one for terminals,
 * which meant the same handful of surfaces were listed in up to three rows at
 * once. They are all in this row now, and those two strips are gone rather than
 * duplicated — a tab in two places is two things that can disagree about which
 * one is active, and it is twice as much bar for the same information.
 *
 * What is lost with the pane strips is being able to read a split's contents off
 * its own header, and what replaces it is `showing`: a member that is on screen
 * draws lifted. With a split, that is more than one member at once, which is
 * honest — there really is more than one surface visible.
 *
 * ## Pane groups, which are not the pane strips coming back
 *
 * A pane holding several surfaces draws as one grouped region here — a bracket
 * under it and short dividers between its members, so pane membership is
 * something you read rather than something you have to click to find out. It is
 * worth being explicit that this does **not** undo the paragraph above, because
 * it looks at a glance like it might.
 *
 * The lesson from the pane strips was not "never show which pane a tab is in".
 * It was that the same surface must not be *listed twice*, because two listings
 * are two things that can disagree about which one is active. This is still
 * exactly one row, and every surface still appears in it exactly once; the row
 * has gained grouping that mirrors the pane tree, not a second copy of anything.
 * There is nothing here that can disagree with anything else, because there is
 * nothing else.
 *
 * A pane group must also not be mistakable for a *cluster* group, which is the
 * outer box this one nests in. Both are drawn in the same visual language on
 * purpose — a region marked by a band spanning the tabs that belong to it — and
 * they differ in both of that language's variables at once: the cluster's band
 * is accent-coloured and sits along the top, the pane's is a grey hairline
 * weight along the bottom. A cluster group also always opens with a named chip
 * and a pane group never has one. See `switcher.css`.
 *
 * The terminal panel keeps its `+`, its worktree toggle and its collapse
 * chevron. Those operate the *region*; they are not tabs, and none of them names
 * a session.
 *
 * ## Health
 *
 * Unchanged and deliberately not per-cluster. Whether Turner needs an update is
 * a property of the *stack* and has nothing to do with which cluster is open.
 */
export interface ClusterBarProps {
  clusters: Cluster[];
  activeClusterId: string | null;
  /**
   * The open cluster's contents, in bar order: the layout's surfaces first, in
   * layout order, then the panel's terminals. Empty for a cluster holding
   * nothing, which is a state a new cluster starts in.
   */
  members: ClusterMember[];
  /** How many tabs each cluster holds, for the collapsed chips. */
  memberCount: (clusterId: string) => number;
  /**
   * Which pane a tab dropped into this row lands in — the focused one.
   *
   * The row lists several panes' tabs at once, so "insert here" has to name a
   * pane before it can mean anything. The focused pane is the answer for the
   * same reason it is the pane the Apps menu splits: it is the one the user was
   * last working in. With no split there is only ever one pane and the question
   * does not arise.
   */
  dropPaneId: string | null;
  /** Where a drag would land right now, so this row can draw its caret. */
  dropTarget?: DropTarget | null;
  onSelect: (clusterId: string) => void;
  onAdd: () => void;
  onClose: (clusterId: string) => void;
  onRename: (clusterId: string, name: string) => void;
  onSelectMember: (member: ClusterMember) => void;
  onCloseMember: (member: ClusterMember) => void;
  dragHandleFor?: (member: ClusterMember) => DragHandleProps | undefined;
  /**
   * The chip's own drag handle: the gesture that pulls a whole cluster out of
   * this window and into another, tree and all.
   *
   * Separate from `dragHandleFor` because it moves a different kind of thing to
   * a different kind of place — a member is a tab and lands in a pane, a cluster
   * is not a tab and lands on a *window*. Offered on every chip, the last one
   * included; the call site says why that stopped being conditional.
   */
  dragHandleForCluster?: (cluster: Cluster) => DragHandleProps | undefined;
  /**
   * What the open cluster's add-app button offers, and what it does.
   *
   * The *same* handlers the title bar's Apps menu is built from — one object,
   * one list, forwarded to both. Omitted, the button is absent rather than
   * present and empty. See `AddAppButton.tsx`.
   */
  apps?: AppsMenuHandlers;
  /** What the warning badge reports on. Not per-cluster; see above. */
  healthOf?: ToolPresentation[];
  onRescan: () => void;
  searchSlot?: ReactNode;
  /** True while the search field is expanded. The bar yields its width to it. */
  searchExpanded?: boolean;
}

function isUnhealthy(tool: ToolPresentation): tool is UnhealthyTool {
  return tool.health !== ("ok" satisfies ToolHealth);
}

/**
 * How anything in this row arrives and leaves.
 *
 * Opacity only, and no `y` or `x`: this row is a horizontal scroll container,
 * and an element that animated out sideways would extend its scroll range for
 * as long as the exit ran — a scrollbar that flashes under the tabs every time
 * one closes. The *movement* in an arrival or a departure is not this element's
 * at all, it is everything beside it sliding over to make room or close the gap,
 * which the `layout` props below do without anything having to travel.
 *
 * Both transitions are the scale's; the composition is all this object adds.
 * Arriving reads at `instant` and leaving at `instantOut` for the reason
 * `motion.ts` gives — dismissal should never make you wait.
 */
const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: instant },
  exit: { opacity: 0, transition: instantOut },
};

/**
 * The count badge, which takes the scale as well.
 *
 * It can, where a tab cannot: it is a 15px pill with two digits in it, so a 4%
 * scale reads as a pop, and it carries no `layout` of its own for a transform
 * to argue with. The figures are the drag layer's (`drag/DropTargets.tsx`),
 * reused rather than chosen again — it is the same event, a small element
 * appearing under something the pointer just did.
 */
const pop = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: instant },
  exit: { opacity: 0, scale: 0.98, transition: instantOut },
};

export default function ClusterBar({
  clusters,
  activeClusterId,
  members,
  memberCount,
  dropPaneId,
  dropTarget,
  onSelect,
  onAdd,
  onClose,
  onRename,
  onSelectMember,
  onCloseMember,
  dragHandleFor,
  dragHandleForCluster,
  apps,
  healthOf,
  onRescan,
  searchSlot,
  searchExpanded = false,
}: ClusterBarProps) {
  const [healthOpen, setHealthOpen] = useState(false);
  const badgeWrapRef = useRef<HTMLDivElement>(null);
  const unhealthy = (healthOf ?? []).filter(isUnhealthy);

  // The whole row is the strip drop zone — every chip, every member, the `+`,
  // and the gaps between them.
  //
  // Deliberately wider than the tabs themselves. A zone that stopped at the last
  // tab would leave the space beside it resolving to `detach`, so releasing an
  // inch wide of the row you were aiming at would silently open a new OS window
  // — the most destructive outcome in the gesture, reached by the smallest miss.
  //
  // It is also one element that always exists, rather than one per group. The
  // registry keys a zone by its element and this hook holds a single one, so a
  // zone that moved between elements as the open cluster changed would depend on
  // React detaching the old ref before attaching the new — which it does, but
  // relying on it means a drag that lands nowhere the day that ordering is not
  // what someone assumed. There is nothing to move here.
  //
  // The rects it measures are only the drop pane's own tabs. The row lists
  // several panes at once and the terminals are not in the tree at all, so an
  // index counted over all of them would name a position that does not exist in
  // the pane the drop actually lands in.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const rowZone = useDropZone({
    kind: "strip",
    paneId: dropPaneId ?? "",
    // Measured on demand, not cached: this row scrolls, and a stale rect puts
    // the caret in the wrong gap the moment it does.
    tabRects: () =>
      Array.from(
        rowRef.current?.querySelectorAll<HTMLElement>(`[data-pane="${dropPaneId}"]`) ?? [],
      ).map((el) => el.getBoundingClientRect()),
  });

  // Dismiss like every other popover in the shell: a click outside, or Escape.
  useEffect(() => {
    if (!healthOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!badgeWrapRef.current?.contains(e.target as Node)) setHealthOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHealthOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [healthOpen]);

  // The badge disappears the moment the field expands, so a popover left open
  // behind it would be unreachable and orphaned.
  useEffect(() => {
    if (searchExpanded) setHealthOpen(false);
  }, [searchExpanded]);

  // The whole row steps aside for the search field, which is what lets the field
  // take the bar edge to edge rather than stopping at whichever chip was left
  // standing. It steps aside in *CSS* though, not here: the row keeps every chip
  // and every member mounted and `.switcher__tabs--collapsed` clips the box to
  // nothing (see switcher.css).
  //
  // That is deliberate and it is the only reason this is worth a comment. The
  // open group carries the accent band — a `layoutId="tool-rule"` motion.div —
  // and framer animates it from wherever it last measured it. Rendering fewer
  // groups while the field is open moves that band, or unmounts it outright;
  // clipping a row whose items are all `flex: none` moves nothing, so the band's
  // rect is the same pixel before, during and after and there is nothing for
  // framer to animate when the field closes.
  //
  // Spanning the group rather than the chip does not weaken that. The band pins
  // to the group box, and a group is `flex: none` in this row, so the collapse
  // cannot squeeze it — its members keep their widths and overflow with the
  // rest. The rect the band derives from is the same either way.
  const terminals = members.filter((m) => m.paneId === null);

  // The surfaces, one entry per pane, in layout order.
  //
  // `members` already arrives pane by pane in layout order (see `WindowRoot`),
  // so a pane's tabs are contiguous and a `Map` keyed by pane id preserves both
  // orders without sorting anything. Grouping is a *rendering* concern and stops
  // here: the flat list this is derived from is untouched, and `ToolWindow`'s
  // surface list — the one that must never reorder, because reordering a mounted
  // iframe reloads the app inside it — has never been this list at all.
  const paneGroups = useMemo(() => {
    const byPane = new Map<string, ClusterMember[]>();
    for (const member of members) {
      if (member.paneId === null) continue;
      const held = byPane.get(member.paneId);
      if (held) held.push(member);
      else byPane.set(member.paneId, [member]);
    }
    return [...byPane].map(([paneId, group]) => ({ paneId, members: group }));
  }, [members]);

  // Where the insertion caret goes, counted over the drop pane's tabs alone —
  // which is what `hitTest` measured, so the two agree by construction. Handed
  // to that pane's group and to no other, so a member belonging to some other
  // pane is drawn but never carries a caret. The index needs no lookup table any
  // more: within the group it names, it *is* the position.
  const caret =
    dropTarget?.kind === "strip" && dropTarget.paneId === dropPaneId ? dropTarget.index : null;

  return (
    <div className="switcher">
      <div
        className={`switcher__tabs${searchExpanded ? " switcher__tabs--collapsed" : ""}`}
        // Registered only while there is a pane for an insertion to land in.
        // Passing `null` rather than skipping the call is what unregisters it if
        // that ever stops being true — a zone left behind would answer drops
        // with a pane id naming nothing.
        ref={(el) => {
          rowRef.current = el;
          rowZone(dropPaneId ? el : null);
        }}
      >
        {clusters.map((cluster) => {
          const active = cluster.id === activeClusterId;
          return (
            // `layout="position"`, not `layout`. A group's *width* changes by a
            // lot when it opens or closes, and framer animates a size change by
            // scaling the box — which would squeeze every label inside it for
            // the length of the spring. Position-only animates where the group
            // sits and corrects the scale away, so a chip pushed along by the
            // group before it slides, and nothing in this row is ever drawn at
            // the wrong width. What draws the size change instead is the fill
            // below, which has no text in it to distort.
            <motion.div
              key={cluster.id}
              layout="position"
              transition={snap}
              className={active ? "switcher__group switcher__group--active" : "switcher__group"}
            >
              {/* The open group's ground.
                  Its own element rather than a background on the group, because
                  a background cannot move: with `layoutId` this is one rectangle
                  handed from the cluster being collapsed to the one being
                  opened, so the region slides and resizes into its new place the
                  same way the accent band below travels between groups, off the
                  same box and on the same spring. A flat fill is
                  also the one thing in the row that is safe to let framer scale
                  — there is nothing in it to blur. */}
              {active && (
                <motion.div
                  className="switcher__group-fill"
                  layoutId="cluster-fill"
                  transition={snap}
                  aria-hidden="true"
                />
              )}

              <ClusterTab
                cluster={cluster}
                active={active}
                count={active ? null : memberCount(cluster.id)}
                // Always closable, including the last one. A window with no
                // cluster is a real state now — it draws the same kind of empty
                // screen a cluster with no apps does, and the panel below is
                // untouched because a panel belongs to the window rather than to
                // whatever cluster happens to be open above it.
                closable
                // Always draggable too, including the last one, and that is a
                // change worth naming because this line used to read
                // `clusters.length > 1 ? … : undefined`.
                //
                // The rationale for the gate was that emptying a window is
                // something you should have to *ask* for, and a drag onto
                // another monitor only names a destination. `move_cluster_pure`
                // refused on the same reasoning, so the handle was hidden rather
                // than offered and refused. What that produced was a window with
                // one cluster — the commonest window there is — where the whole
                // multi-monitor gesture was simply missing, with nothing on
                // screen to say it existed or why it did not apply. That is a
                // worse failure than the side effect it was avoiding, and the
                // side effect is one the line above already permits by another
                // route. Both are gone; see `move_cluster_pure` in
                // `shell_state.rs`.
                dragHandle={dragHandleForCluster?.(cluster)}
                onSelect={onSelect}
                onClose={onClose}
                onRename={onRename}
              />

              {/* `mode="popLayout"`, and it is the whole reason the swap does
                  not jolt. Opening another cluster mounts its contents in the
                  same commit that unmounts these, so contents that held their
                  width while they faded would push the rest of the row right by
                  a cluster's worth of tabs and then drag it back — a swell, over
                  and back, on every click. Popped, this box leaves the flow the
                  instant it starts leaving: the row's final width is the width
                  it animates to, once, and these tabs fade out in place over it.
                  Its offset parent is the group, which switcher.css positions
                  for exactly this. */}
              <AnimatePresence initial={false} mode="popLayout">
                {active && (
                  <motion.div
                    key="members"
                    className="switcher__members"
                    layout="position"
                    transition={snap}
                    {...fade}
                  >
                    {/* One child per pane rather than one per surface, which is
                        what makes pane membership readable — see this file's
                        header on why that is not the per-pane tab strips coming
                        back. The member tabs themselves are one level down, in
                        `PaneGroup`.

                        Plain `sync`, deliberately, where everything else in this
                        file pops. A popped group keeps its box and every
                        `data-pane` in it, and the strip drop zone measures
                        exactly that attribute with `querySelectorAll` on every
                        pointer move — so a pane that popped would go on offering
                        rectangles to the caret arithmetic for as long as it took
                        to fade. Left in the flow, it is gone from the row the
                        moment it is gone from the model, and the gap closing
                        behind it is the `layout` on its neighbours. */}
                    <AnimatePresence initial={false}>
                      {paneGroups.map((group) => (
                        <PaneGroup
                          key={group.paneId}
                          members={group.members}
                          caret={group.paneId === dropPaneId ? caret : null}
                          onSelect={onSelectMember}
                          onClose={onCloseMember}
                          dragHandleFor={dragHandleFor}
                        />
                      ))}
                    </AnimatePresence>
                    {/* The drop pane has no tabs of its own to hang a caret on,
                        so there is no group for it to have gone in. An empty
                        focused pane is an ordinary state — close a pane's last
                        tab in a split and you are in it — and a drag over the row
                        with no caret anywhere reads as a drag that will land
                        nowhere. */}
                    {caret === 0 && !paneGroups.some((g) => g.paneId === dropPaneId) && (
                      <span className="switcher__caret" />
                    )}

                    {/* "Open an app here", at the end of the open cluster's app
                        tabs — and inside this box rather than beside it, which
                        is the whole placement decision.

                        Inside, it is plain DOM within the `popLayout` child
                        above: it arrives and leaves with the cluster's contents,
                        once per cluster switch, and is a child of no
                        `AnimatePresence` itself — so nothing about it moves when
                        a tab opens or closes. As a sibling it would need its own
                        presence handling to leave with the rest, and popped
                        without one it would jump.

                        Past the trailing caret, so a drop at the end of the
                        strip still draws between the last tab and this. It
                        carries neither `data-tab` nor `data-pane`, so the
                        `querySelectorAll` that measures insertion points cannot
                        see it — a button that looked like a tab to that query
                        would put every drop after it in the wrong place. */}
                    {apps && <AddAppButton apps={apps} />}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Terminals pop, where the surfaces above do not: they carry no
                  `data-pane`, so nothing measures them, and this list also has
                  to survive the cluster swap — it is a sibling of the box above
                  rather than inside it, so it would hold its own width through
                  the swap and reintroduce the swell that box just avoided. */}
              <AnimatePresence initial={false} mode="popLayout">
                {active &&
                  terminals.map((member) => (
                    <MemberTab
                      key={member.id}
                      member={member}
                      caretBefore={false}
                      onSelect={onSelectMember}
                      onClose={onCloseMember}
                      dragHandle={dragHandleFor?.(member)}
                    />
                  ))}
              </AnimatePresence>

              {/* The open group's accent band.
                  Chrome bands a tab group in its colour across the whole group,
                  and the reason to copy that is the reason the fill above
                  exists: what needs saying is *which tabs belong to this
                  cluster*, and a marker that stops at the chip says only which
                  chip was clicked. So it pins left, right and top to the *group*
                  box, spanning the chip, its members and its terminals as one
                  region.

                  Rendered here rather than inside the chip, and only on the
                  active group, which is what keeps exactly one element carrying
                  `layoutId="tool-rule"` mounted — the condition for framer
                  handing the same rectangle across on a cluster switch instead
                  of blinking one off and another on.

                  Two elements rather than one bordered fill, and the split is
                  not cosmetic: they belong at different depths. The fill is the
                  group's *ground* and has to sit under the tabs, while a showing
                  member paints an opaque `--bg` over its full height — a band
                  drawn behind that would be cut through wherever a member is on
                  screen. Last child, so paint order puts it over every
                  positioned tab in the group without a z-index; `pointer-events`
                  off for the reason the fill gives, with more of the row under it
                  to lose clicks in. */}
              {active && (
                <motion.div
                  className="switcher__rule"
                  layoutId="tool-rule"
                  transition={snap}
                  aria-hidden="true"
                />
              )}
            </motion.div>
          );
        })}

        {/* Carried along by the group that expands to its left, rather than
            jumping there. Position-only for the same reason the groups are: it
            never changes size, so there is nothing else to animate. */}
        <motion.button
          type="button"
          className="switcher__newbtn"
          layout="position"
          transition={snap}
          onClick={onAdd}
          aria-label="New cluster"
        >
          <Plus />
        </motion.button>
      </div>

      {/* Not a child of `.switcher__tabs` above — see the `position: relative`
          comment on `.switcher` in switcher.css for why this is anchored on
          the row instead, and how it still lands on exactly the tab strip's
          own rectangle despite that. `rowRef` already points at the strip;
          reused rather than given a second ref for the same element. */}
      <OverlayScrollbar targetRef={rowRef} />

      <div className={`switcher__spacer${searchExpanded ? " switcher__spacer--collapsed" : ""}`} />

      {!searchExpanded && unhealthy.length > 0 && (
        <div className="switcher__badge-wrap" ref={badgeWrapRef}>
          <button
            type="button"
            className="switcher__badge"
            aria-expanded={healthOpen}
            onClick={() => setHealthOpen((open) => !open)}
          >
            <WarningTriangle size={12} className="switcher__badge-icon" />
            <span className="switcher__badge-count">{unhealthy.length}</span>
          </button>
          <AnimatePresence>
            {healthOpen && (
              <HealthPopover
                tools={unhealthy}
                onRescan={() => {
                  onRescan();
                  setHealthOpen(false);
                }}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {searchSlot ?? (
        <div className="switcher__search-default">
          <Search size={14} className="switcher__search-icon" />
          <span className="switcher__search-label">Search</span>
          <span className="switcher__search-hint">Ctrl+K</span>
        </div>
      )}
    </div>
  );
}

/**
 * One pane's tabs, drawn as one region.
 *
 * A pane holding a single surface renders exactly as it always did — a bare tab
 * in the row, with this box adding nothing to it but a wrapper. Only a pane
 * holding *more than one* takes the grouped treatment: a bracket beneath it and
 * short dividers between its members instead of the full-height seams the rest
 * of the row uses. That asymmetry is the point. Every pane looking like a group
 * would make the marking meaningless, since with no splits every surface is
 * alone in its pane; marking only the pane that is actually stacking something
 * means the decoration appears exactly when it has something to say.
 *
 * The wrapper is here even for a single member, though, and that is a
 * reconciliation decision rather than a visual one. Rendering the lone member
 * bare and the grouped ones wrapped would mean the wrapper appearing around a
 * tab the moment a second one joined its pane — React reconciles children by
 * position, so a tab that gained a parent element would unmount and remount, and
 * a remounted tab is one that fades out and back in for a change that did not
 * touch it.
 *
 * What does not survive is a tab dragged *between* two panes: it leaves one
 * group and joins another, which is a remount whatever this does, so it
 * crossfades where it used to slide. Accepted knowingly — the gesture already
 * has a ghost under the cursor saying where the tab is going, and the far more
 * common move, reordering within a pane, still slides because the tab stays in
 * the same group. Nothing about a *surface* is at risk either way; the surfaces
 * are a flat list in `ToolWindow` and this file has never held one.
 *
 * `caret` is the insertion index within *this* pane, or `null` when the drag is
 * aimed elsewhere. It is the drop target's own index unchanged, because the
 * registry measures a pane's tabs and this component draws exactly those.
 */
function PaneGroup({
  members,
  caret,
  onSelect,
  onClose,
  dragHandleFor,
}: {
  members: ClusterMember[];
  caret: number | null;
  onSelect: (member: ClusterMember) => void;
  onClose: (member: ClusterMember) => void;
  dragHandleFor?: (member: ClusterMember) => DragHandleProps | undefined;
}) {
  const grouped = members.length > 1;

  return (
    // `layout="position"` and opacity-only, the rule every child of this row
    // obeys: `.switcher__tabs` is a horizontal scroll container, and anything
    // that animated its width or travelled sideways on the way out would extend
    // the scroll range for the length of the exit and flash a scrollbar under
    // the tabs. The transitions are the shared ones from `motion.ts`; a
    // component in this row writing its own is a bug.
    <motion.div
      layout="position"
      transition={snap}
      {...fade}
      className={grouped ? "switcher__pane switcher__pane--grouped" : "switcher__pane"}
    >
      {/* `sync`, for the reason the group list above gives: an exiting tab must
          leave the `data-pane` measurement the moment it leaves the model. */}
      <AnimatePresence initial={false}>
        {members.map((member, i) => (
          <MemberTab
            key={member.id}
            member={member}
            caretBefore={caret === i}
            onSelect={onSelect}
            onClose={onClose}
            dragHandle={dragHandleFor?.(member)}
          />
        ))}
      </AnimatePresence>

      {/* Past this pane's last tab, and inside this pane's box — which is the
          whole difference from where this used to be drawn. A trailing caret at
          the end of *every* surface would sit after some other pane's tabs
          whenever the focused pane was not the last one in the tree, promising
          an insertion somewhere the drop would not go. */}
      {caret === members.length && <span className="switcher__caret" />}

      {/* The bracket that says "these are one pane". Plain DOM inside a
          `motion.div` rather than a `motion.div` of its own: it is absolutely
          positioned, so it has no layout to animate, and there is only ever one
          per pane so there is nothing for it to travel between — unlike the
          cluster's accent band, which is handed between groups on a `layoutId`
          precisely because exactly one of them is ever mounted. */}
      {grouped && <span className="switcher__pane-rule" aria-hidden="true" />}
    </motion.div>
  );
}

/**
 * One cluster's chip: its name, renameable in place, and a close button.
 *
 * A `div role="tab"` rather than the `<button>` this used to be. That is not a
 * preference — a button may not legally contain another button, and this needs
 * to nest a close ×. Keyboard access is put back by hand rather than lost with
 * the element.
 *
 * Renaming is inline rather than through a dialog. A cluster is named after
 * whatever you are doing in it, which you can only judge while looking at it;
 * a modal that covered the thing being named would be the wrong order.
 *
 * `count` is what a collapsed chip shows instead of its contents — how many tabs
 * are folded up inside it. `null` on the open chip, whose contents are right
 * there to be counted by eye.
 *
 * It is also a drag source: dragged clear of the bar, the whole cluster moves to
 * another window, which is what a second monitor is for. All three gestures live
 * on the same element and do not collide — the drag layer's press threshold is
 * what keeps a press that never moves a click, so selecting and renaming still
 * work exactly as they did.
 */
function ClusterTab({
  cluster,
  active,
  count,
  closable,
  dragHandle,
  onSelect,
  onClose,
  onRename,
}: {
  cluster: Cluster;
  active: boolean;
  count: number | null;
  closable: boolean;
  dragHandle?: DragHandleProps;
  onSelect: (clusterId: string) => void;
  onClose: (clusterId: string) => void;
  onRename: (clusterId: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cluster.name);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name is a name you cannot click on. Refused by restoring what was
    // there rather than by rejecting the edit with a message, since there is
    // nothing the user needs to be told: the tab simply keeps its name.
    if (next && next !== cluster.name) onRename(cluster.id, next);
    else setDraft(cluster.name);
  };

  const classes = ["switcher__tab"];
  if (active) classes.push("switcher__tab--active");

  return (
    <div
      role="tab"
      aria-selected={active}
      aria-expanded={active}
      tabIndex={0}
      className={classes.join(" ")}
      title={cluster.name}
      onClick={() => onSelect(cluster.id)}
      onDoubleClick={() => {
        setDraft(cluster.name);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(cluster.id);
        }
      }}
      // Not while renaming. The field below is inside this element, so a press
      // in it to select some text is a press on the chip, and dragging across a
      // few characters would clear the threshold and pull the cluster out of the
      // window mid-edit.
      onPointerDown={editing ? undefined : dragHandle?.onPointerDown}
      style={editing ? undefined : dragHandle?.style}
    >
      {editing ? (
        <input
          className="switcher__tab-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Stopped from reaching the tab's own handler, which would otherwise
            // treat Enter and Space as "select this tab" while you are typing.
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(cluster.name);
              setEditing(false);
            }
          }}
          // A click inside the field must not re-select the tab or, worse,
          // re-enter editing on the second click of a double.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="switcher__tab-label">{cluster.name}</span>
      )}

      {/* Popped on the way out so the chip is already its collapsed width while
          the badge fades off it. Held in the flow it would keep the chip 20-odd
          pixels wider for the length of the exit, and since the badge always
          leaves in the same commit that this cluster's contents arrive, that is
          20-odd pixels of the whole row shifting the wrong way first. The chip
          is the offset parent — it is positioned already, and stays positioned
          for exactly this now that the accent band has moved out to the group. */}
      <AnimatePresence initial={false} mode="popLayout">
        {count !== null && count > 0 && !editing && (
          <motion.span key="count" className="switcher__tab-count" {...pop}>
            {count}
          </motion.span>
        )}
      </AnimatePresence>

      {closable && !editing && (
        <button
          type="button"
          className="switcher__tab-close"
          aria-label={`Close ${cluster.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(cluster.id);
          }}
          // Without this, pressing the × would begin whatever gesture the tab
          // itself starts on pointerdown.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Close />
        </button>
      )}
    </div>
  );
}

/**
 * One app or terminal inside the open cluster.
 *
 * There is deliberately no accent rule *per member*. The band overhead belongs
 * to the group and says "these tabs are one cluster", which is true of all of
 * them at once; it points at no tab in particular and must not be mistaken for
 * doing so. Nothing here could: a split shows two surfaces at once and the panel
 * can show a third, so "the active tab" is not a single thing this row could
 * point at — a rule would have to pick one of several equally-current tabs and
 * be wrong about the rest. The lifted background says what is on screen, which
 * is a claim that stays true however many panes there are.
 */
function MemberTab({
  member,
  caretBefore,
  onSelect,
  onClose,
  dragHandle,
  ref,
}: {
  member: ClusterMember;
  caretBefore: boolean;
  onSelect: (member: ClusterMember) => void;
  onClose: (member: ClusterMember) => void;
  dragHandle?: DragHandleProps;
  /**
   * Framer's, not a caller's. An `AnimatePresence` in `popLayout` mode clones
   * its child with a ref and measures whatever that ref lands on, so a tab that
   * swallowed it would be a tab framer silently declines to pop — no error, it
   * just quietly keeps its width while it leaves. It has to reach the element
   * with the tab's own box, which is the same element the `data-tab` and
   * `data-pane` attributes are on and for the same reason.
   */
  ref?: Ref<HTMLDivElement>;
}) {
  const classes = ["switcher__member"];
  if (member.showing) classes.push("switcher__member--showing");

  return (
    <>
      {caretBefore && <span className="switcher__caret" />}
      {/* `role="tab"` rather than `<button>`, for the reason the cluster chip
          above already gives: a button cannot legally nest the close button.

          `layout="position"` is what makes a tab dragged to a new index slide
          there instead of appearing there, and what closes the gap behind one
          that was just closed. Position-only rather than `layout`: a reorder
          changes nothing about a tab but where it is, and correcting the scale
          away is what keeps the label crisp while the row moves under it. */}
      <motion.div
        ref={ref}
        layout="position"
        transition={snap}
        {...fade}
        role="tab"
        aria-selected={member.showing}
        tabIndex={0}
        className={classes.join(" ")}
        data-tab={member.id}
        // Read back by the strip drop zone to measure only the drop pane's own
        // tabs. Absent on a terminal, which has no pane.
        data-pane={member.paneId ?? undefined}
        data-kind={member.kind}
        title={member.title}
        onClick={() => onSelect(member)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(member);
          }
        }}
        onPointerDown={dragHandle?.onPointerDown}
        style={dragHandle?.style}
      >
        <span className="switcher__member-label">{member.title}</span>

        {/* One box, two mutually exclusive occupants — the agent-finished dot
            normally, the close button on hover or keyboard focus. Never both,
            and the box's footprint never changes between them, which is what
            keeps the tab's width fixed while hovering. */}
        <span className="switcher__member-end">
          {member.agentFinished && <span className="switcher__member-dot" />}
          <button
            type="button"
            className="switcher__member-close"
            aria-label={`Close ${member.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(member);
            }}
            // A pointerdown here must never reach the tab's own — that is the
            // drag handle, and a click meant to close must not start a drag.
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Close />
          </button>
        </span>
      </motion.div>
    </>
  );
}
