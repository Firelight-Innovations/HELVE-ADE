/** The status bar, left to right exactly as `StatusBar.tsx`'s own header
 *  comment orders it: a spacer, the branch line, a diff-stat readout, GitHub
 *  status, then the sliders glyph that opens Settings. The stack's health list
 *  lives behind the switcher bar's warning badge instead
 *  (`HealthPopover.tsx`), not here — see the `stack-list` mock. */
import { Band } from "./chrome";

export default function StatusBar() {
  return (
    <Band tone="surface">
      <div className="tut__mock-grow" />

      <span className="tut__mock-caption">main · ↑1 ↓0</span>
      <span className="tut__mock-caption">+142 -63 · 9 files</span>

      <span className="tut__mock-dot tut__mock-dot--ok" />
      <span className="tut__mock-caption">GitHub</span>

      <span className="tut__mock-btn">⚙</span>
    </Band>
  );
}
