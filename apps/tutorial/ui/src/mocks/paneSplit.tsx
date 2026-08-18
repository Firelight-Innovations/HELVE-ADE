/** One pane, then the same pane split along its longer axis — the rule
 *  `panesAndClusters.ts` states and `panes/splitOnOpen.ts` decides from
 *  pixels. A pane wider than it is tall gains a right-hand column, which is
 *  the case drawn here: the surface that was already showing keeps the left
 *  half, and the newly opened one takes the half that split produced. */
import { Arrow, ArrowCallout, Col, Row } from "./chrome";

export default function PaneSplit() {
  return (
    <Row gap="md" align="center">
      <div className="tut__mock-panebox tut__mock-grow">Explorer</div>

      <Arrow dir="right" />

      <Col gap="xs" className="tut__mock-grow">
        <Row gap="xs">
          <div className="tut__mock-panebox tut__mock-grow">Explorer</div>
          <div className="tut__mock-panebox tut__mock-grow">Viewer</div>
        </Row>
        <ArrowCallout dir="up" label="right-hand column" />
      </Col>
    </Row>
  );
}
