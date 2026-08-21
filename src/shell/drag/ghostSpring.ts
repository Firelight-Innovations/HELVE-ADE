/**
 * The spring every drag ghost is chased by.
 *
 * Derived from `snap` rather than invented. `snap` is the scale's answer for
 * "the default, for anything the pointer just caused" — its stiffness is the
 * highest in the scale, which is what "light lag only, it should read as
 * attached to the cursor" calls for.
 *
 * Lifted out of `useDrag` when a second ghost appeared. Two drags whose chips
 * lagged the cursor by different amounts would read as two different gestures,
 * which they are not: the thing being carried differs, the carrying does not.
 */
import { snap } from "../motion";

// `motion.ts` types `snap` as the general `Transition` shape (it has to —
// `settle` and `instant` share the export), so its spring fields are read with
// a narrow cast here rather than by widening the shared type for one caller.
const source = snap as unknown as { stiffness: number; damping: number; mass?: number };

export const ghostSpring = {
  stiffness: source.stiffness,
  damping: source.damping,
  mass: source.mass,
};
