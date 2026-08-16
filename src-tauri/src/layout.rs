//! The pane tree — how surfaces are arranged inside one cluster.
//!
//! A cluster's layout is a tree. Interior nodes are splits, which lay their
//! children out in a row or a column; leaves are panes, which hold an ordered
//! list of tabs and know which one is showing. A tab is an *instance id* — the
//! id of an app surface or of a terminal — never an app id, because the whole
//! point of this module is that two Files can be on screen at once.
//!
//! Nothing here knows about Tauri, windows, or events. That is deliberate and
//! it is the same discipline `shell_state`'s `close_terminal_pure` and
//! `group_with_pure` already follow: the operations that are easy to get subtly
//! wrong — remove a tab, collapse the split it emptied, keep the size weights
//! aligned with the children they describe — are pure functions over a plain
//! tree, and they are tested as such. The `&AppHandle`-taking wrappers in
//! `shell_state` do the broadcasting and none of the thinking.
//!
//! Two invariants hold after every mutation, and `prune` is what enforces them:
//!
//!   * **No empty leaves, except the root.** A pane with nothing in it is not a
//!     pane, it is a gap. The root is exempt because a cluster with everything
//!     closed still has to be *something*.
//!   * **No split with fewer than two children, and no split directly inside a
//!     split of the same direction.** Two columns inside a column look exactly
//!     like three columns on screen, so keeping the nested form would let
//!     repeated splitting grow a tree far deeper than the layout it draws —
//!     and every walk of it slower — for no visible difference.

use serde::{Deserialize, Serialize};

/// The smallest fraction of its parent a pane is allowed to occupy.
///
/// Not a cosmetic minimum: a pane dragged to exactly zero is a pane with no
/// divider left to grab, which makes it unrecoverable without closing what is
/// inside it. Five percent is small enough to be an aggressive resize and large
/// enough to still be a grab target.
const MIN_SIZE: f32 = 0.05;

/// How many panes one cluster may be split into by *opening* something.
///
/// Opening an app gives it a pane of its own (see [`PaneNode::open_into`]), and
/// left unbounded that turns six clicks in the Apps menu into six slivers, each
/// too narrow to be the thing it was opened to be. So the automatic split stops
/// here and the fifth surface stacks into the focused pane as a tab instead —
/// the behaviour every open used to have, kept as the endpoint rather than as
/// the rule.
///
/// Four because a 2×2 grid is the largest arrangement that still reads as
/// "several things at once" rather than as a mosaic, and because the split rule
/// reaches it in the shape you would draw by hand: two columns, then one of them
/// halved, then the other.
///
/// **Only the automatic split is capped.** Dragging a tab onto a pane's edge
/// goes through `split_pane` directly and is not bounded by this, deliberately:
/// that gesture names a pane, an edge and a side, so it is a decision rather
/// than a guess, and a cap on it would refuse a layout the user explicitly drew.
/// A guess is what deserves a conservative ceiling.
pub const MAX_AUTO_PANES: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDir {
    /// Children side by side, left to right.
    Row,
    /// Children stacked, top to bottom.
    Column,
}

/// One node of a cluster's layout.
///
/// Internally tagged, like `ToolStatus` and `BootStatus` already are, so the
/// frontend discriminates on a `kind` field rather than on which keys happen to
/// be present.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PaneNode {
    #[serde(rename_all = "camelCase")]
    Split {
        id: String,
        dir: SplitDir,
        /// One weight per child, in the same order, summing to 1.0.
        ///
        /// Fractions rather than pixels because the window is resizable: a
        /// layout stored in pixels would have to be recomputed on every resize
        /// and would restore wrongly onto a different monitor.
        sizes: Vec<f32>,
        children: Vec<PaneNode>,
    },
    #[serde(rename_all = "camelCase")]
    Leaf {
        id: String,
        /// Instance ids, in tab-strip order.
        tabs: Vec<String>,
        active_tab: Option<String>,
    },
}

impl PaneNode {
    /// An empty pane. The starting state of a fresh cluster.
    pub fn leaf(id: impl Into<String>) -> Self {
        PaneNode::Leaf {
            id: id.into(),
            tabs: Vec::new(),
            active_tab: None,
        }
    }

    /// `allow` because only this module's tests call it — `cargo check` does not
    /// build them and so reports it dead. Kept rather than inlined into each
    /// assertion because "which node is this" is the question every structural
    /// test asks, and asking it one way keeps those tests readable.
    #[allow(dead_code)]
    pub fn id(&self) -> &str {
        match self {
            PaneNode::Split { id, .. } | PaneNode::Leaf { id, .. } => id,
        }
    }

    fn is_empty_leaf(&self) -> bool {
        matches!(self, PaneNode::Leaf { tabs, .. } if tabs.is_empty())
    }

    /// Whether `pane_id` names a leaf in this tree.
    ///
    /// The question `split_with_instance` has to ask *before* it starts moving
    /// tabs about: a drop can name a pane that is no longer anywhere, and a
    /// mutation that has already emptied the dragged tab out of its old home by
    /// the time it finds that out has destroyed something on the strength of an
    /// address it never checked.
    pub fn holds_pane(&self, pane_id: &str) -> bool {
        match self {
            PaneNode::Leaf { id, .. } => id == pane_id,
            PaneNode::Split { children, .. } => children.iter().any(|c| c.holds_pane(pane_id)),
        }
    }

    /// Every tab in the tree, in layout order. Used to answer "is this instance
    /// still on screen anywhere", which is what decides whether closing a pane
    /// should also dispose of what was in it.
    pub fn tabs(&self) -> Vec<&str> {
        let mut out = Vec::new();
        self.collect_tabs(&mut out);
        out
    }

    fn collect_tabs<'a>(&'a self, out: &mut Vec<&'a str>) {
        match self {
            PaneNode::Leaf { tabs, .. } => out.extend(tabs.iter().map(String::as_str)),
            PaneNode::Split { children, .. } => {
                for child in children {
                    child.collect_tabs(out);
                }
            }
        }
    }

    /// Which pane holds `instance_id`, if any.
    ///
    /// `allow` for the same reason as `id` above: the frontend answers this
    /// from the tree it already has, so nothing in Rust calls it outside the
    /// tests that pin the traversal.
    #[allow(dead_code)]
    pub fn pane_of_tab(&self, instance_id: &str) -> Option<&str> {
        match self {
            PaneNode::Leaf { id, tabs, .. } => tabs
                .iter()
                .any(|t| t == instance_id)
                .then_some(id.as_str()),
            PaneNode::Split { children, .. } => {
                children.iter().find_map(|c| c.pane_of_tab(instance_id))
            }
        }
    }

    /// Whether this tree holds a pane with that id.
    ///
    /// Asked before a caller's preferred pane is honoured, so a pane id left
    /// over from a layout that has since changed falls back to the first pane
    /// instead of addressing nothing — see `ShellState::active_pane`.
    pub fn pane_of_id(&self, pane_id: &str) -> bool {
        match self {
            PaneNode::Leaf { id, .. } => id == pane_id,
            PaneNode::Split { children, .. } => children.iter().any(|c| c.pane_of_id(pane_id)),
        }
    }

    /// The first pane in layout order. Where a new instance goes when the
    /// caller has no opinion about which pane should receive it.
    pub fn first_pane_id(&self) -> &str {
        match self {
            PaneNode::Leaf { id, .. } => id,
            // A split always has children after `prune`, but `first` rather
            // than `[0]` keeps a hand-built or hand-edited tree from panicking
            // the whole backend.
            PaneNode::Split { id, children, .. } => {
                children.first().map_or(id.as_str(), PaneNode::first_pane_id)
            }
        }
    }

    /// How many panes this tree draws. What [`MAX_AUTO_PANES`] is counted
    /// against, and the only measurement of a layout Rust can make honestly —
    /// see [`open_into`](Self::open_into) on why the *direction* of a split is
    /// not one of them.
    pub fn pane_count(&self) -> usize {
        match self {
            PaneNode::Leaf { .. } => 1,
            PaneNode::Split { children, .. } => children.iter().map(PaneNode::pane_count).sum(),
        }
    }

    /// Whether `pane_id` names a leaf that is holding nothing.
    ///
    /// `false` for a pane that is not in this tree at all, which is the answer
    /// [`open_into`](Self::open_into) needs: an unknown pane must not be split,
    /// and letting it fall through to `insert_tab` is what turns it into the
    /// `false` the caller already knows how to report.
    fn pane_is_empty(&self, pane_id: &str) -> bool {
        match self {
            PaneNode::Leaf { id, tabs, .. } => id == pane_id && tabs.is_empty(),
            PaneNode::Split { children, .. } => children.iter().any(|c| c.pane_is_empty(pane_id)),
        }
    }

    /// Where a newly opened surface goes: a **pane of its own**, or a tab.
    ///
    /// This reverses what opening used to do. Every open dropped the new surface
    /// into the focused pane as another tab, which on screen looked like it had
    /// *replaced* whatever was there — the one thing that pane was already
    /// showing went behind the new one. Opening now splits, and stacking two
    /// surfaces into one pane is something you ask for by dragging a chip into
    /// that pane, never something an open does to you on the way past.
    ///
    /// `split` carries the direction the caller measured, plus the two ids a
    /// split needs. **The direction has to come from the caller**, and that is
    /// the load-bearing part of this signature. The rule is "split the focused
    /// pane along its longer axis", so a wide pane gains a right-hand column and
    /// a tall one gains a bottom row, which keeps repeated opening from slicing
    /// one axis into slivers. Longer *in pixels*, though: `sizes` here are
    /// fractions of a parent, deliberately (the window is resizable and a layout
    /// in pixels would restore wrongly onto another monitor), so a tree of
    /// fractions cannot say which way a pane is currently drawn. Nothing in this
    /// module may guess at it. The frontend measures the rendered pane at the
    /// moment of the gesture and passes the answer in; `None` means it had
    /// nothing to measure and asks for the old tab behaviour.
    ///
    /// Two things refuse the split even when a direction was measured:
    ///
    ///   * **An empty pane.** The first app in a fresh cluster fills the single
    ///     pane it was given. Splitting it would leave an empty half beside the
    ///     app, which is a gap rather than a layout.
    ///   * **[`MAX_AUTO_PANES`].** Past the ceiling the surface stacks into the
    ///     focused pane, exactly as every open used to. See that constant for
    ///     why the cap is on this path and not on the drag gesture.
    ///
    /// `index` is only consulted on the tab path — a split has one tab in the
    /// new pane and no strip position to argue about.
    pub fn open_into(
        &mut self,
        pane_id: &str,
        instance_id: &str,
        index: Option<usize>,
        split: Option<(SplitDir, &str, &str)>,
    ) -> bool {
        if let Some((dir, split_id, new_pane_id)) = split {
            if self.pane_count() < MAX_AUTO_PANES && !self.pane_is_empty(pane_id) {
                // `before: false` — the new pane takes the right-hand or lower
                // side. Opening reads left-to-right, top-to-bottom, and the
                // gesture that gets to choose a side is the drag, which knows
                // which edge was aimed at.
                return self.split_pane(pane_id, dir, split_id, new_pane_id, instance_id, false);
            }
        }
        self.insert_tab(pane_id, instance_id, index)
    }

    fn find_leaf_mut(&mut self, pane_id: &str) -> Option<&mut PaneNode> {
        match self {
            PaneNode::Leaf { id, .. } if id == pane_id => Some(self),
            PaneNode::Leaf { .. } => None,
            PaneNode::Split { children, .. } => {
                children.iter_mut().find_map(|c| c.find_leaf_mut(pane_id))
            }
        }
    }

    /// Put `instance_id` into `pane_id` at `index`, and show it.
    ///
    /// An out-of-range index appends rather than failing: the caller is a drop
    /// handler working from a pointer position, and a tab dropped past the end
    /// of a strip means "last", not "error".
    pub fn insert_tab(&mut self, pane_id: &str, instance_id: &str, index: Option<usize>) -> bool {
        let Some(PaneNode::Leaf { tabs, active_tab, .. }) = self.find_leaf_mut(pane_id) else {
            return false;
        };

        // Moving a tab within its own pane has to remove before it inserts, or
        // the index the caller computed from the rendered strip would be off by
        // one for every rightward move.
        tabs.retain(|t| t != instance_id);

        let at = index.unwrap_or(tabs.len()).min(tabs.len());
        tabs.insert(at, instance_id.to_string());
        *active_tab = Some(instance_id.to_string());
        true
    }

    /// Take `instance_id` out of whichever pane holds it, then tidy up.
    ///
    /// Focus falls to the neighbour on the same rule `detach_tool` has always
    /// used: the tab that slid into the vacated position, or the last one if
    /// the removed tab was last. Anything else makes closing a tab feel like it
    /// jumped somewhere arbitrary.
    pub fn remove_tab(&mut self, instance_id: &str) -> bool {
        let removed = self.remove_tab_inner(instance_id);
        if removed {
            self.prune();
        }
        removed
    }

    fn remove_tab_inner(&mut self, instance_id: &str) -> bool {
        match self {
            PaneNode::Leaf { tabs, active_tab, .. } => {
                let Some(i) = tabs.iter().position(|t| t == instance_id) else {
                    return false;
                };
                tabs.remove(i);
                if active_tab.as_deref() == Some(instance_id) {
                    *active_tab = tabs.get(i).or_else(|| tabs.last()).cloned();
                }
                true
            }
            PaneNode::Split { children, .. } => {
                children.iter_mut().any(|c| c.remove_tab_inner(instance_id))
            }
        }
    }

    /// Show `instance_id` in whichever pane holds it. False if it is not in
    /// this tree at all — which is not an error, only the answer for a window
    /// that does not hold the instance being activated somewhere else.
    pub fn activate_tab(&mut self, instance_id: &str) -> bool {
        match self {
            PaneNode::Leaf { tabs, active_tab, .. } => {
                if tabs.iter().any(|t| t == instance_id) {
                    *active_tab = Some(instance_id.to_string());
                    true
                } else {
                    false
                }
            }
            PaneNode::Split { children, .. } => {
                children.iter_mut().any(|c| c.activate_tab(instance_id))
            }
        }
    }

    /// Split `pane_id` in two, putting `instance_id` in the new half.
    ///
    /// `before` decides which side the new pane lands on, so a tab dropped on a
    /// pane's left edge opens to its left rather than always to its right.
    #[allow(clippy::too_many_arguments)]
    pub fn split_pane(
        &mut self,
        pane_id: &str,
        dir: SplitDir,
        split_id: &str,
        new_pane_id: &str,
        instance_id: &str,
        before: bool,
    ) -> bool {
        match self {
            PaneNode::Leaf { id, .. } if id == pane_id => {
                let fresh = PaneNode::Leaf {
                    id: new_pane_id.to_string(),
                    tabs: vec![instance_id.to_string()],
                    active_tab: Some(instance_id.to_string()),
                };
                // The existing pane is moved, not rebuilt — it is holding live
                // tabs and rebuilding it would mean re-deriving state that is
                // already correct. The placeholder is never observed: it exists
                // only for the instant between the two writes.
                let existing = std::mem::replace(self, PaneNode::leaf(""));
                let children = if before {
                    vec![fresh, existing]
                } else {
                    vec![existing, fresh]
                };
                *self = PaneNode::Split {
                    id: split_id.to_string(),
                    dir,
                    sizes: vec![0.5, 0.5],
                    children,
                };
                true
            }
            PaneNode::Leaf { .. } => false,
            PaneNode::Split { children, .. } => {
                for child in children.iter_mut() {
                    if child.split_pane(pane_id, dir, split_id, new_pane_id, instance_id, before) {
                        return true;
                    }
                }
                false
            }
        }
    }

    /// Set a split's size weights — what a divider drag commits on release.
    ///
    /// A length that disagrees with the child count is refused rather than
    /// padded: it means the caller measured a tree that has since changed, and
    /// guessing which child the extra weight belongs to would silently
    /// rearrange the layout under the user.
    pub fn set_sizes(&mut self, split_id: &str, next: &[f32]) -> bool {
        match self {
            PaneNode::Leaf { .. } => false,
            PaneNode::Split {
                id, sizes, children, ..
            } if id == split_id => {
                if next.len() != children.len() {
                    return false;
                }
                *sizes = next.to_vec();
                normalize(sizes);
                true
            }
            PaneNode::Split { children, .. } => {
                children.iter_mut().any(|c| c.set_sizes(split_id, next))
            }
        }
    }

    /// Restore both invariants named in the module doc. Safe to call on an
    /// already-tidy tree, which is what lets every mutator end with it rather
    /// than each one reasoning about whether it needs to.
    pub fn prune(&mut self) {
        let collapse_to = {
            let PaneNode::Split {
                id,
                dir,
                sizes,
                children,
            } = self
            else {
                return;
            };

            for child in children.iter_mut() {
                child.prune();
            }

            let dir = *dir;
            let mut next_children: Vec<PaneNode> = Vec::new();
            let mut next_sizes: Vec<f32> = Vec::new();

            // Rebuilt as a pair rather than removed by index from two vectors.
            // `sizes[i]` describes `children[i]`, and an edit that updated one
            // and not the other would leave every pane after the edit drawing
            // at its neighbour's width — a bug that looks like a rendering
            // fault and is not one. Zipping makes that state unwriteable.
            for (child, size) in children.drain(..).zip(sizes.drain(..)) {
                if child.is_empty_leaf() {
                    continue;
                }
                match child {
                    PaneNode::Split {
                        dir: inner_dir,
                        sizes: inner_sizes,
                        children: inner_children,
                        ..
                    } if inner_dir == dir => {
                        // The grandchild's share of its parent, times its
                        // parent's share of this node, is its share here.
                        for (grandchild, inner) in inner_children.into_iter().zip(inner_sizes) {
                            next_children.push(grandchild);
                            next_sizes.push(size * inner);
                        }
                    }
                    other => {
                        next_children.push(other);
                        next_sizes.push(size);
                    }
                }
            }

            *children = next_children;
            *sizes = next_sizes;
            normalize(sizes);

            match children.len() {
                1 => Some(children.remove(0)),
                // Everything under it closed. The split becomes the empty pane
                // the cluster falls back to, keeping its own id so anything
                // holding a reference to this position still resolves.
                0 => Some(PaneNode::leaf(id.clone())),
                _ => None,
            }
        };

        if let Some(node) = collapse_to {
            *self = node;
        }
    }
}

/// Scale the weights to sum to 1, with no pane below [`MIN_SIZE`].
///
/// `pub(crate)` for one caller outside this module: `presets` normalizes the
/// weights of a saved arrangement through this rather than through a second
/// implementation of it, so a preset cannot describe a split the layout engine
/// would refuse to draw.
///
/// The order matters and is the whole subtlety here. Clamping first and scaling
/// afterwards is the obvious version and it is wrong: the scale divides every
/// weight by a total greater than one, which pushes a weight that was *just*
/// clamped straight back under the floor. So the clamp happens in normalized
/// space, and the extra it hands to the starved panes is taken back from the
/// ones that have room to give — in proportion to how much room each has.
///
/// That the books balance is not a hope. With `n * MIN_SIZE < 1` guaranteed by
/// the early return, the slack above the floor always exceeds the deficit below
/// it, so every donor stays above the floor and the total lands back on exactly
/// 1.
pub(crate) fn normalize(sizes: &mut [f32]) {
    let n = sizes.len();
    if n == 0 {
        return;
    }
    let even = 1.0 / n as f32;

    // More panes than the floor leaves room for. An even split is the only
    // layout that can satisfy all of them, and taking it is honester than
    // honouring some minimums while quietly breaking others.
    if MIN_SIZE * n as f32 >= 1.0 {
        sizes.fill(even);
        return;
    }

    for s in sizes.iter_mut() {
        if !s.is_finite() || *s < 0.0 {
            *s = 0.0;
        }
    }

    let total: f32 = sizes.iter().sum();
    if total <= 0.0 {
        sizes.fill(even);
        return;
    }
    for s in sizes.iter_mut() {
        *s /= total;
    }

    let deficit: f32 = sizes.iter().map(|s| (MIN_SIZE - *s).max(0.0)).sum();
    if deficit <= 0.0 {
        return;
    }
    let slack: f32 = sizes.iter().map(|s| (*s - MIN_SIZE).max(0.0)).sum();

    for s in sizes.iter_mut() {
        if *s < MIN_SIZE {
            *s = MIN_SIZE;
        } else if slack > 0.0 {
            *s -= deficit * ((*s - MIN_SIZE) / slack);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf_with(id: &str, tabs: &[&str]) -> PaneNode {
        PaneNode::Leaf {
            id: id.to_string(),
            tabs: tabs.iter().map(|t| t.to_string()).collect(),
            active_tab: tabs.first().map(|t| t.to_string()),
        }
    }

    /// Sizes are compared loosely — they are the result of division, and an
    /// exact-equality assertion on a float would be testing the FPU.
    fn assert_sizes(node: &PaneNode, expected: &[f32]) {
        let PaneNode::Split { sizes, .. } = node else {
            panic!("expected a split, got {node:?}");
        };
        assert_eq!(sizes.len(), expected.len(), "wrong number of weights");
        for (got, want) in sizes.iter().zip(expected) {
            assert!(
                (got - want).abs() < 1e-5,
                "weights {sizes:?} do not match {expected:?}"
            );
        }
    }

    #[test]
    fn splitting_a_pane_puts_the_new_instance_beside_it() {
        let mut tree = leaf_with("p1", &["files-1"]);
        assert!(tree.split_pane("p1", SplitDir::Row, "s1", "p2", "files-2", false));

        let PaneNode::Split { dir, children, .. } = &tree else {
            panic!("splitting should have produced a split");
        };
        assert_eq!(*dir, SplitDir::Row);
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].id(), "p1");
        assert_eq!(children[1].id(), "p2");
        assert_sizes(&tree, &[0.5, 0.5]);
    }

    #[test]
    fn splitting_before_puts_the_new_instance_on_the_other_side() {
        let mut tree = leaf_with("p1", &["files-1"]);
        tree.split_pane("p1", SplitDir::Column, "s1", "p2", "files-2", true);

        let PaneNode::Split { children, .. } = &tree else {
            panic!("expected a split");
        };
        assert_eq!(children[0].id(), "p2", "the new pane leads when `before`");
        assert_eq!(children[1].id(), "p1");
    }

    /// What `split_with_instance` checks before it starts moving tabs about.
    /// Getting a `false` here is the difference between refusing a drop and
    /// deleting what was dropped — see that function's doc comment.
    #[test]
    fn holds_pane_finds_a_leaf_at_any_depth_and_nothing_else() {
        let mut tree = leaf_with("p1", &["files-1"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "files-2", false);

        assert!(tree.holds_pane("p1"), "the pane that was split");
        assert!(tree.holds_pane("p2"), "and the one the split produced");
        assert!(!tree.holds_pane("s1"), "a split's own id is not a pane");
        assert!(!tree.holds_pane("nonesuch"));
        assert!(
            !leaf_with("p1", &[]).holds_pane("p2"),
            "a lone leaf answers only for itself"
        );
    }

    #[test]
    fn splitting_an_unknown_pane_changes_nothing() {
        let mut tree = leaf_with("p1", &["files-1"]);
        let before = tree.clone();
        assert!(!tree.split_pane("nonesuch", SplitDir::Row, "s1", "p2", "files-2", false));
        assert_eq!(tree, before);
    }

    #[test]
    fn closing_the_last_tab_in_a_pane_collapses_the_split() {
        let mut tree = leaf_with("p1", &["files-1"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "files-2", false);

        tree.remove_tab("files-2");

        // Not a split with one child — the surviving pane itself.
        assert_eq!(tree, leaf_with("p1", &["files-1"]));
    }

    #[test]
    fn closing_a_tab_beside_others_leaves_the_pane_standing() {
        let mut tree = leaf_with("p1", &["files-1", "files-2", "term-1"]);
        tree.remove_tab("files-2");

        let PaneNode::Leaf { tabs, .. } = &tree else {
            panic!("expected a leaf");
        };
        assert_eq!(tabs, &["files-1".to_string(), "term-1".to_string()]);
    }

    #[test]
    fn focus_falls_to_the_neighbour_that_slid_into_place() {
        let mut tree = PaneNode::Leaf {
            id: "p1".to_string(),
            tabs: vec!["a".into(), "b".into(), "c".into()],
            active_tab: Some("b".to_string()),
        };
        tree.remove_tab("b");

        let PaneNode::Leaf { active_tab, .. } = &tree else {
            panic!("expected a leaf");
        };
        assert_eq!(active_tab.as_deref(), Some("c"), "the tab that took its index");
    }

    #[test]
    fn focus_falls_to_the_last_tab_when_the_closed_one_was_last() {
        let mut tree = PaneNode::Leaf {
            id: "p1".to_string(),
            tabs: vec!["a".into(), "b".into()],
            active_tab: Some("b".to_string()),
        };
        tree.remove_tab("b");

        let PaneNode::Leaf { active_tab, .. } = &tree else {
            panic!("expected a leaf");
        };
        assert_eq!(active_tab.as_deref(), Some("a"));
    }

    #[test]
    fn the_root_may_be_an_empty_pane_when_everything_is_closed() {
        let mut tree = leaf_with("p1", &["files-1"]);
        tree.remove_tab("files-1");

        assert!(tree.is_empty_leaf(), "a cluster with nothing open is still a cluster");
        assert_eq!(tree.id(), "p1");
    }

    #[test]
    fn a_split_of_the_same_direction_is_flattened_into_its_parent() {
        // Split p1 rightward twice: without flattening this nests two levels.
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);
        tree.split_pane("p2", SplitDir::Row, "s2", "p3", "c", false);
        tree.prune();

        let PaneNode::Split { children, dir, .. } = &tree else {
            panic!("expected a split");
        };
        assert_eq!(*dir, SplitDir::Row);
        assert_eq!(children.len(), 3, "three columns, not a column inside a column");
        assert_eq!(
            children.iter().map(PaneNode::id).collect::<Vec<_>>(),
            ["p1", "p2", "p3"]
        );
        // p1 kept its half; p2 and p3 split the other half between them.
        assert_sizes(&tree, &[0.5, 0.25, 0.25]);
    }

    #[test]
    fn a_split_of_the_other_direction_is_left_nested() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);
        tree.split_pane("p2", SplitDir::Column, "s2", "p3", "c", false);
        tree.prune();

        let PaneNode::Split { children, .. } = &tree else {
            panic!("expected a split");
        };
        assert_eq!(children.len(), 2, "a column inside a row is a real distinction");
        assert!(matches!(children[1], PaneNode::Split { .. }));
    }

    #[test]
    fn inserting_at_an_index_past_the_end_appends() {
        let mut tree = leaf_with("p1", &["a"]);
        assert!(tree.insert_tab("p1", "b", Some(99)));

        let PaneNode::Leaf { tabs, active_tab, .. } = &tree else {
            panic!("expected a leaf");
        };
        assert_eq!(tabs, &["a".to_string(), "b".to_string()]);
        assert_eq!(active_tab.as_deref(), Some("b"), "an inserted tab is shown");
    }

    #[test]
    fn moving_a_tab_within_its_own_pane_does_not_duplicate_it() {
        let mut tree = leaf_with("p1", &["a", "b", "c"]);
        tree.insert_tab("p1", "a", Some(2));

        let PaneNode::Leaf { tabs, .. } = &tree else {
            panic!("expected a leaf");
        };
        assert_eq!(tabs.len(), 3, "a reorder must not clone the tab it moves");
        assert_eq!(tabs, &["b".to_string(), "c".to_string(), "a".to_string()]);
    }

    // --- opening into a pane ------------------------------------------------

    /// The first app in a fresh cluster fills the pane it was given. A split
    /// here would put an empty half beside it, which is a gap, not a layout.
    #[test]
    fn the_first_surface_in_an_empty_cluster_does_not_split_anything() {
        let mut tree = leaf_with("p1", &[]);
        assert!(tree.open_into("p1", "files-1", None, Some((SplitDir::Row, "s1", "p2"))));

        assert_eq!(tree, leaf_with("p1", &["files-1"]));
    }

    #[test]
    fn opening_into_an_occupied_pane_gives_the_new_surface_its_own() {
        let mut tree = leaf_with("p1", &["files-1"]);
        assert!(tree.open_into("p1", "files-2", None, Some((SplitDir::Row, "s1", "p2"))));

        let PaneNode::Split { dir, children, .. } = &tree else {
            panic!("opening beside something should have produced a split");
        };
        assert_eq!(*dir, SplitDir::Row);
        assert_eq!(children[0].id(), "p1", "the new pane takes the trailing side");
        assert_eq!(children[1].id(), "p2");
    }

    /// The direction is the caller's and is used verbatim — this module has no
    /// pixels to derive it from. See `open_into`'s doc comment.
    #[test]
    fn the_measured_direction_is_the_one_the_split_takes() {
        let mut tree = leaf_with("p1", &["files-1"]);
        tree.open_into("p1", "files-2", None, Some((SplitDir::Column, "s1", "p2")));

        let PaneNode::Split { dir, .. } = &tree else {
            panic!("expected a split");
        };
        assert_eq!(*dir, SplitDir::Column, "a tall pane gains a bottom row");
    }

    /// No measurement, no split: the caller had nothing on screen to measure
    /// and asked for the old behaviour rather than a guessed axis.
    #[test]
    fn opening_without_a_direction_stacks_as_a_tab() {
        let mut tree = leaf_with("p1", &["files-1"]);
        assert!(tree.open_into("p1", "files-2", None, None));

        let PaneNode::Leaf { tabs, active_tab, .. } = &tree else {
            panic!("a tab must not have produced a split");
        };
        assert_eq!(tabs, &["files-1".to_string(), "files-2".to_string()]);
        assert_eq!(active_tab.as_deref(), Some("files-2"), "an opened tab is shown");
    }

    /// The ceiling, and what happens at it: the surface stacks into the focused
    /// pane instead of producing a fifth sliver.
    #[test]
    fn opening_stops_splitting_at_the_pane_ceiling() {
        let mut tree = leaf_with("p1", &["a"]);
        for (i, (pane, split, fresh)) in [("p1", "s1", "p2"), ("p2", "s2", "p3"), ("p3", "s3", "p4")]
            .into_iter()
            .enumerate()
        {
            let dir = if i % 2 == 0 { SplitDir::Row } else { SplitDir::Column };
            assert!(tree.open_into(pane, &format!("t{i}"), None, Some((dir, split, fresh))));
        }
        assert_eq!(tree.pane_count(), MAX_AUTO_PANES, "four opens, four panes");

        // The fifth. It lands in p4 as a tab rather than halving it again.
        assert!(tree.open_into("p4", "fifth", None, Some((SplitDir::Row, "s4", "p5"))));
        assert_eq!(tree.pane_count(), MAX_AUTO_PANES, "no fifth pane");
        assert_eq!(tree.pane_of_tab("fifth"), Some("p4"), "stacked where it was opened");
    }

    /// The cap is on *opening*. A drag that names a pane and an edge is a
    /// decision rather than a guess, and `split_pane` goes on obeying it.
    #[test]
    fn the_ceiling_does_not_apply_to_a_dragged_split() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);
        tree.split_pane("p2", SplitDir::Column, "s2", "p3", "c", false);
        tree.split_pane("p3", SplitDir::Row, "s3", "p4", "d", false);
        assert_eq!(tree.pane_count(), 4);

        assert!(tree.split_pane("p4", SplitDir::Column, "s4", "p5", "e", false));
        assert_eq!(tree.pane_count(), 5, "an explicit drop is never refused for shape");
    }

    #[test]
    fn opening_into_a_pane_that_is_not_there_changes_nothing() {
        let mut tree = leaf_with("p1", &["a"]);
        let before = tree.clone();
        assert!(!tree.open_into("nonesuch", "b", None, Some((SplitDir::Row, "s1", "p2"))));
        assert_eq!(tree, before, "an unknown pane is reported, never invented");
    }

    #[test]
    fn set_sizes_refuses_a_count_that_does_not_match_the_children() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);

        assert!(!tree.set_sizes("s1", &[0.2, 0.3, 0.5]), "a stale measurement is refused");
        assert_sizes(&tree, &[0.5, 0.5]);
        assert!(tree.set_sizes("s1", &[0.7, 0.3]));
        assert_sizes(&tree, &[0.7, 0.3]);
    }

    #[test]
    fn a_pane_cannot_be_resized_to_nothing() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);
        tree.set_sizes("s1", &[1.0, 0.0]);

        let PaneNode::Split { sizes, .. } = &tree else {
            panic!("expected a split");
        };
        assert!(
            sizes[1] >= MIN_SIZE - 1e-6,
            "a pane dragged to zero would have no divider left to grab"
        );
        assert!((sizes.iter().sum::<f32>() - 1.0).abs() < 1e-5, "weights still sum to 1");
    }

    /// The clamp has to survive the scaling that follows it — the bug this
    /// exists to catch is a weight clamped up to the floor and then divided
    /// straight back under it by the normalization.
    #[test]
    fn every_pane_clears_the_floor_after_normalizing() {
        let mut sizes = vec![0.98, 0.01, 0.01];
        normalize(&mut sizes);

        for (i, s) in sizes.iter().enumerate() {
            assert!(*s >= MIN_SIZE - 1e-6, "pane {i} is under the floor: {sizes:?}");
        }
        assert!((sizes.iter().sum::<f32>() - 1.0).abs() < 1e-5, "{sizes:?} must sum to 1");
    }

    /// Past twenty panes the floor cannot be honoured for everyone at once.
    /// An even split is the answer; silently starving some of them is not.
    #[test]
    fn more_panes_than_the_floor_allows_fall_back_to_an_even_split() {
        let mut sizes = vec![0.0; 40];
        sizes[0] = 1.0;
        normalize(&mut sizes);

        assert!(sizes.iter().all(|s| (*s - 1.0 / 40.0).abs() < 1e-6), "{sizes:?}");
    }

    #[test]
    fn tabs_are_listed_in_layout_order() {
        let mut tree = leaf_with("p1", &["a", "b"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "c", false);

        assert_eq!(tree.tabs(), ["a", "b", "c"]);
    }

    #[test]
    fn a_tab_can_be_found_by_the_pane_holding_it() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);

        assert_eq!(tree.pane_of_tab("a"), Some("p1"));
        assert_eq!(tree.pane_of_tab("b"), Some("p2"));
        assert_eq!(tree.pane_of_tab("nonesuch"), None);
    }

    #[test]
    fn activating_a_tab_shows_it_in_whichever_pane_holds_it() {
        let mut tree = leaf_with("p1", &["a", "b"]);
        assert!(tree.activate_tab("b"));

        let PaneNode::Leaf { active_tab, .. } = &tree else {
            panic!("expected a leaf");
        };
        assert_eq!(active_tab.as_deref(), Some("b"));
        assert!(!tree.activate_tab("nonesuch"), "an absent instance is not activated");
    }

    /// Activating a tab in a pane you are **not** focused on touches that pane
    /// and nothing else.
    ///
    /// The bug this pins was not here — the tree walk was always right, and the
    /// fault was in the cluster bar handing the drag layer the *focused* pane as
    /// the drop target for a release anywhere over the row, so a press that
    /// jittered past the drag threshold on a chip in another pane moved that tab
    /// into the focused pane through `move_instance`. What made it hard to see is
    /// that it is invisible whenever the two panes coincide.
    ///
    /// So this asserts the property the whole gesture rests on, from the side
    /// that can be tested exhaustively: an activation is a pure change of *which
    /// tab is showing*, in the one pane that holds it. Nothing moves between
    /// panes, no other pane's showing tab changes, and the shape of the tree is
    /// untouched — which is also what keeps the surfaces in `ToolWindow` where
    /// they are, since each one is positioned from the pane its id resolves to.
    #[test]
    fn activating_a_tab_in_another_pane_leaves_every_other_pane_alone() {
        let mut tree = PaneNode::Leaf {
            id: "p1".to_string(),
            tabs: vec!["files-1".into(), "term-1".into()],
            active_tab: Some("term-1".to_string()),
        };
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "files-2", false);
        // The user is working in p2; p1 is the pane they are not looking at.
        let before = tree.clone();

        assert!(tree.activate_tab("files-1"), "the tab is in this tree");

        let PaneNode::Split { children, dir, sizes, .. } = &tree else {
            panic!("activating must not reshape the tree");
        };
        assert_eq!(*dir, SplitDir::Row);
        assert_eq!(sizes.len(), 2);
        assert_eq!(children.len(), 2, "no pane appeared or vanished");

        let PaneNode::Leaf { tabs, active_tab, .. } = &children[0] else {
            panic!("expected p1 to still be a leaf");
        };
        assert_eq!(
            tabs,
            &["files-1".to_string(), "term-1".to_string()],
            "the activated tab did not move panes, and neither did its neighbour"
        );
        assert_eq!(active_tab.as_deref(), Some("files-1"), "its own pane switched");

        let PaneNode::Leaf { tabs, active_tab, .. } = &children[1] else {
            panic!("expected p2 to still be a leaf");
        };
        assert_eq!(tabs, &["files-2".to_string()], "the focused pane's contents are untouched");
        assert_eq!(
            active_tab.as_deref(),
            Some("files-2"),
            "the focused pane goes on showing what it was showing"
        );

        // And the counterpart: a tab that is already showing is a no-op, so
        // clicking the chip you are already looking at cannot disturb anything.
        let mut again = before.clone();
        assert!(again.activate_tab("term-1"));
        assert_eq!(again, before, "re-activating the showing tab changes nothing");
    }

    #[test]
    fn a_pane_id_can_be_checked_against_the_tree_that_would_hold_it() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", false);

        assert!(tree.pane_of_id("p1"));
        assert!(tree.pane_of_id("p2"), "a pane nested under a split still counts");
        assert!(!tree.pane_of_id("s1"), "a split is not a pane");
        assert!(!tree.pane_of_id("nonesuch"));
    }

    #[test]
    fn the_first_pane_is_the_first_in_layout_order() {
        let mut tree = leaf_with("p1", &["a"]);
        tree.split_pane("p1", SplitDir::Row, "s1", "p2", "b", true);

        assert_eq!(tree.first_pane_id(), "p2", "`before` put p2 on the leading edge");
    }

    /// The round trip matters more than the exact spelling: this is written to
    /// disk and read back at launch, so a tree that serializes and does not
    /// deserialize is a layout that silently resets on every restart.
    #[test]
    fn a_tree_survives_a_json_round_trip() {
        let mut tree = leaf_with("p1", &["files-1", "term-1"]);
        tree.split_pane("p1", SplitDir::Column, "s1", "p2", "files-2", false);
        tree.set_sizes("s1", &[0.6, 0.4]);

        let json = serde_json::to_string(&tree).expect("a tree serializes");
        let back: PaneNode = serde_json::from_str(&json).expect("and reads back");
        assert_eq!(back, tree);
    }

    #[test]
    fn the_wire_form_is_tagged_and_camel_cased() {
        let tree = leaf_with("p1", &["a"]);
        let json = serde_json::to_string(&tree).expect("a tree serializes");
        assert!(json.contains(r#""kind":"leaf""#), "discriminated by `kind`: {json}");
        assert!(json.contains(r#""activeTab""#), "camelCase on the wire: {json}");
    }
}
