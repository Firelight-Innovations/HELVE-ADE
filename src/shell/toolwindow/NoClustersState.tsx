import { BrandGlyph } from "../../ui/Icon";

/**
 * Reached when this window has no clusters at all — after the last one in it is
 * closed. Distinct from `EmptyState`, which is a cluster with nothing open in
 * it, and the distinction is the whole reason there are two: the ways out are
 * different. From an empty cluster you open an app; from an empty window there
 * is no cluster for an app to open into, so the only move is to make one.
 *
 * A window can reach this and stay useful, which is why closing the last
 * cluster is allowed at all. The terminal panel belongs to the *window* rather
 * than to any cluster (see `shell_state.rs`'s module doc), so it is still there
 * beside this, still holding its shells, still able to open more. Only the app
 * area is empty, and the copy says so by naming what to do rather than
 * apologising for what is missing.
 *
 * Same shape and same classes as `EmptyState`, and no buttons for the same
 * reason: the + is an arm's length above this in the bar it names, and a button
 * here would be a second way to do one thing, half a second closer.
 */
export default function NoClustersState() {
  return (
    <div className="toolwindow__empty">
      <div className="toolwindow__empty-column">
        <BrandGlyph size={38} className="toolwindow__empty-glyph" />
        <div className="toolwindow__empty-title">No clusters in this window</div>
        <div className="toolwindow__empty-body">
          Click the + in the bar above to make a cluster and open a project in
          it. The terminal beside this one is the window's, so it is still
          running.
        </div>
      </div>
    </div>
  );
}
