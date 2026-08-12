/**
 * The shell's motion scale.
 *
 * Three transitions, and every animated thing in the shell uses one of them.
 * A component that writes its own `transition={{ ... }}` is a bug: the point of
 * a scale is that the whole window moves like one piece of software, and that
 * property is lost the moment two regions disagree about what "quick" means.
 *
 * Springs rather than durations, because every one of these can be interrupted
 * mid-flight — a tab switched while the rule is still sliding, a panel dragged
 * while it is collapsing. A duration-based tween restarts from wherever it got
 * to and reads as a stutter; a spring carries its velocity into the new target
 * and reads as the thing simply changing direction.
 *
 * The handoff specifies the seven moments and the two constraints but no
 * numbers. These are ours, and they are deliberately all in this file so they
 * can be reviewed and replaced as one decision. High stiffness with heavy
 * damping is what makes a desktop shell feel immediate; anything that visibly
 * overshoots reads as a toy.
 */
import type { Transition } from "framer-motion";

/** The default. Tab rules, layout shifts, anything the pointer just caused. */
export const snap: Transition = {
  type: "spring",
  stiffness: 700,
  damping: 42,
  mass: 0.7,
};

/** Larger travel: the panel collapsing, a detached window arriving. */
export const settle: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 38,
};

/**
 * Popovers and menus. The one tween in the set, because these have no gesture
 * behind them to inherit velocity from — a spring on a 4px fade just adds
 * settling time to something that should already be readable.
 */
export const instant: Transition = {
  duration: 0.09,
  ease: [0.4, 0, 0.2, 1],
};

/** Leaving is faster than arriving. Dismissal should never make you wait. */
export const instantOut: Transition = {
  duration: 0.06,
  ease: [0.4, 0, 1, 1],
};

/**
 * The shared open/close for every popover and menu in the shell — the health
 * list, the eight menus, the type filter, settings. Exported as one variant
 * object rather than repeated per component so they cannot drift apart.
 */
export const popover = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: instant },
  exit: { opacity: 0, y: -2, scale: 0.99, transition: instantOut },
};

/** The boot spinner's arc. Linear and infinite — it reports nothing but life. */
export const spinArc: Transition = {
  duration: 0.9,
  ease: "linear",
  repeat: Infinity,
};
