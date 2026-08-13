/**
 * The close confirmation for a terminal tab whose session is still busy.
 *
 * Built as a modal centred over the panel with a scrim covering the panel
 * only, not an anchored popover — the tab strip scrolls now
 * (SecondaryPanel.tsx splits it into a scrolling strip plus a pinned end
 * group), so anything anchored to a tab could find its anchor scrolled out
 * from under it, or left sitting behind the pinned buttons. Centring over the
 * panel sidesteps both.
 *
 * The dialog surface itself is not a new visual language: same background,
 * hairline border, radius and shadow as every other floating panel in the
 * shell (switcher.css's health popover, search's type filter), and the same
 * `popover` open/close as HealthPopover. Only the scrim and the centred
 * positioning are new, and both are local to this file so they can be lifted
 * into a general-purpose confirmation dialog later without SecondaryPanel
 * needing to change.
 */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { TerminalBusy } from "../contract";
import { instant, instantOut, popover } from "../motion";
import "./panel.css";

export interface CloseConfirmProps {
  /** The tab's own label — the dialog names it, it doesn't just say "this tab". */
  title: string;
  busy: TerminalBusy;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CloseConfirm({ title, busy, onConfirm, onCancel }: CloseConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Escape cancels, and focus lands on Cancel rather than the destructive
  // action — the keyboard's default outcome, if the dialog is dismissed
  // without a deliberate choice, is "nothing happened."
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <motion.div
      className="panel__confirm-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: instant }}
      exit={{ opacity: 0, transition: instantOut }}
      // A pointerdown on the scrim itself (not on the dialog it wraps)
      // dismisses like every other click-outside in the shell. Checked on
      // target === currentTarget rather than a ref-contains test, since the
      // scrim and the dialog are siblings-by-nesting here, not siblings in
      // the DOM the way the health popover's badge-wrap/popover pair are.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <motion.div
        className="panel__confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={`Close ${title}`}
        variants={popover}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <p className="panel__confirm-text">
          <code className="panel__confirm-process">{busy.process}</code> is still running in{" "}
          <strong>{title}</strong>. Close it anyway?
        </p>
        <div className="panel__confirm-actions">
          <button type="button" className="panel__confirm-cancel" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="panel__confirm-destroy" onClick={onConfirm}>
            Close anyway
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
