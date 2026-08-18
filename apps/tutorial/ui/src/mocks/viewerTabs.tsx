/** The Viewer's tab strip, one tab selected — see
 *  `apps/viewer/ui/src/tabs/TabStrip.tsx`. */
import { Band, MockTab } from "./chrome";

export default function ViewerTabs() {
  return (
    <Band tone="surface">
      <MockTab label="main.rs" selected />
      <MockTab label="lib.rs" />
      <MockTab label="Cargo.toml" />
    </Band>
  );
}
