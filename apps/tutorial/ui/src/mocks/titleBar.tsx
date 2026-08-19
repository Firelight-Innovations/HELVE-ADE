/** The title bar alone: menus left, the title centred, window controls right —
 *  see `src/shell/titlebar/TitleBar.tsx`, which this is a still frame of. */
import { PRODUCT_NAME } from "../branding.generated";
import { Band, Row } from "./chrome";

const MENUS = ["File", "Edit", "View", "Run", "Terminal", "Help"];

export default function TitleBar() {
  return (
    <Band tone="surface">
      <Row gap="sm">
        {MENUS.map((menu) => (
          <span key={menu} className="tut__mock-caption">
            {menu}
          </span>
        ))}
      </Row>

      <Row justify="center" className="tut__mock-grow">
        <span className="tut__mock-caption">{PRODUCT_NAME} | Anvil</span>
      </Row>

      <Row gap="xs">
        <span className="tut__mock-btn">—</span>
        <span className="tut__mock-btn">▢</span>
        <span className="tut__mock-btn">×</span>
      </Row>
    </Band>
  );
}
