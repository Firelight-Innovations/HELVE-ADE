/** The switcher bar: the open cluster's own chip runs straight into its tabs
 *  and the `+` that opens something into it — no divider, because in the real
 *  bar they are one group sharing a lifted background. The next cluster sits
 *  collapsed to its chip, then the search field on the right. See
 *  `src/shell/switcher/ClusterBar.tsx` and `AddAppButton.tsx`. */
import { Band, MockTab, Row } from "./chrome";

export default function SwitcherBar() {
  return (
    <Band tone="surface">
      <Row gap="xs">
        <MockTab label="Anvil" selected />
        <MockTab label="Home" selected />
        <MockTab label="File Explorer" />
        <span className="tut__mock-btn">+</span>
      </Row>

      <MockTab label="Website" />

      <div className="tut__mock-grow" />

      <span className="tut__mock-field">Search</span>
    </Band>
  );
}
