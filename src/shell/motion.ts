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

/**
 * Leaving is faster than arriving. Dismissal should never make you wait.
 *
 * The two numbers are pulled out as constants because this one transition is
 * needed in two languages — framer's object below, and a CSS `transition`
 * shorthand for `.toolwindow__surface`, which is a plain positioned div rather
 * than a `motion.div`. Written twice by hand they would drift; written once
 * here they cannot.
 */
const INSTANT_OUT_MS = 60;
const INSTANT_OUT_EASE: [number, number, number, number] = [0.4, 0, 1, 1];

export const instantOut: Transition = {
  duration: INSTANT_OUT_MS / 1000,
  ease: INSTANT_OUT_EASE,
};

/** `instantOut` as a CSS `transition` timing, for the CSS-side callers. */
export const instantOutCss = `${INSTANT_OUT_MS}ms cubic-bezier(${INSTANT_OUT_EASE.join(", ")})`;

/**
 * `instantOut`'s duration in milliseconds, for the caller that has to know when
 * a CSS transition it started has finished.
 */
export const instantOutMs = INSTANT_OUT_MS;

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

/* --- search, which is the one thing in the shell that opens in two beats ----
 *
 * Everything else here animates one surface at a time. Search animates two, and
 * they are meant to read as cause and effect rather than as a pair of things
 * that happened at once: the field flies across the switcher bar, and *then* the
 * overlay comes down out from under it. Closing runs the same two beats
 * backwards — the overlay rolls up first, and only once it is gone does the bar
 * give the cluster chips their room back.
 *
 * That is the only reason a `delay` appears anywhere in this file. The rest of
 * the scale is springs precisely so nothing has to know how long anything else
 * takes; here one beat is defined as following another, and a follower has to
 * wait. Both delays are named below rather than written at the call sites, so
 * the two halves of the handoff cannot drift apart — and so the *bar* can be
 * told how long to wait using the same number the overlay leaves in.
 */

/* The leading beat needs nothing defined for it. The field crossing the bar is
 * a `layoutId` morph, and `MotionConfig` in `WindowRoot` already hands every
 * unconfigured animation `snap` — which is the tab-rule spring, and exactly the
 * right character for it. Everything below is the follower. */

/** How long the overlay waits before it starts coming down. Short enough that
 *  the two beats overlap slightly at the tail of the field's travel, which
 *  reads as one gesture; a clean stop-then-start reads as two. */
const SEARCH_FOLLOW_DELAY = 0.14;

/**
 * The overlay arriving: a clip that unrolls downward, not a slide.
 *
 * The box never moves or resizes — only the visible part of it grows — and that
 * is load-bearing rather than aesthetic. The overlay contains a Monaco editor on
 * `automaticLayout`, which re-measures whenever its container's box changes;
 * animating height or `bottom` would make it re-layout on every frame of the
 * reveal. A clip is paint-only, so Monaco sees its final size from the first
 * frame and never learns this happened.
 *
 * `settle` rather than `snap` because this is the larger travel of the two, the
 * same distinction the panel collapse already draws.
 */
const searchOverlayIn: Transition = { ...settle, delay: SEARCH_FOLLOW_DELAY };

/**
 * The overlay leaving. A tween, and faster than it arrived — the same rule
 * `instantOut` states, for the same reason: dismissal should never make you
 * wait. Its duration is what the bar waits out before collapsing, so it is
 * pulled into a constant rather than written inline.
 */
const SEARCH_OUT_MS = 110;

const searchOverlayOut: Transition = {
  duration: SEARCH_OUT_MS / 1000,
  ease: [0.4, 0, 1, 1],
};

/**
 * How long the switcher bar holds its expanded state after search is dismissed.
 *
 * Consumed as a number of milliseconds by a timer rather than as a framer
 * transition, because it does not delay an *animation* — it delays the state
 * change itself. The cluster chips do not animate back (see
 * `.switcher__tabs--collapsed` in switcher.css, which is explicit that they
 * return drawn rather than animating), so delaying only the field's morph would
 * put the chips back underneath a field that is still full width. The whole bar
 * has to wait, which means the boolean has to wait.
 */
export const searchBarHoldMs = SEARCH_OUT_MS;

/** The overlay's two states. Percentages on all four sides, in both keyframes,
 *  so framer interpolates the string rather than giving up and snapping. */
export const searchOverlay = {
  initial: { clipPath: "inset(0% 0% 100% 0%)" },
  animate: { clipPath: "inset(0% 0% 0% 0%)", transition: searchOverlayIn },
  exit: { clipPath: "inset(0% 0% 100% 0%)", transition: searchOverlayOut },
};

/**
 * The overlay's contents, offset upward at rest and settling as the clip above
 * uncovers them.
 *
 * Without this the reveal is a window opening onto something already in its
 * final position, which reads as a wipe. Ten pixels of catch-up is what makes it
 * read as the panel itself coming down from behind the bar.
 */
export const searchOverlayBody = {
  initial: { y: -10 },
  animate: { y: 0, transition: searchOverlayIn },
  exit: { y: -6, transition: searchOverlayOut },
};

/* --- settings, which is a place rather than a mode ------------------------
 *
 * Search comes *down out from under* the bar you are typing into, because it is
 * an extension of that field: the two are one gesture and the clip is what
 * makes the panel look attached to the thing that spawned it.
 *
 * Settings is not attached to anything. It is a screen you go to and come back
 * from, and giving it search's unroll would say it belongs to the status bar
 * glyph that opened it, which is a button and not a source. So it arrives the
 * way a sheet does: the window behind dims, and the screen settles forward out
 * of it.
 *
 * Both halves are paint-only — `opacity` on the backdrop, `opacity` and
 * `transform` on the surface — for the reason the search clip is: this screen
 * contains scroll containers and a full-width form, and animating a box would
 * make every one of them re-layout on every frame of the reveal.
 */

/** How long dismissal takes. Faster than arrival, the rule `instantOut` states. */
const SETTINGS_OUT_MS = 90;

const settingsOut: Transition = {
  duration: SETTINGS_OUT_MS / 1000,
  ease: [0.4, 0, 1, 1],
};

/** The window behind, dimmed. Nothing moves; only the wash arrives. */
export const settingsBackdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: settle },
  exit: { opacity: 0, transition: settingsOut },
};

/**
 * The screen itself.
 *
 * 1.5% and eight pixels, which is deliberately almost nothing. A full-screen
 * surface that visibly flies in reads as a modal interrupting you; this one
 * should read as having been there, one layer back, the whole time. Any more
 * travel and the text blurs through the scale, which on a screen made of labels
 * is the one artefact there is no excuse for.
 */
export const settingsScreen = {
  initial: { opacity: 0, scale: 0.985, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: settle },
  exit: { opacity: 0, scale: 0.99, y: 4, transition: settingsOut },
};

/** The boot spinner's arc. Linear and infinite — it reports nothing but life. */
export const spinArc: Transition = {
  duration: 0.9,
  ease: "linear",
  repeat: Infinity,
};
