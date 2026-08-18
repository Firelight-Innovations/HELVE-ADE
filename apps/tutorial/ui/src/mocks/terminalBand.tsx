/**
 * The terminal band: a rail of sessions down the left, the emulator deck
 * filling the rest — see `src/shell/panel/BottomPanel.tsx`. The band is wide
 * and short, so its tab strip runs vertically rather than across the top;
 * that is also why a split shows as one rail entry with a count rather than
 * two, since `groupTerminalTabs` folds a split pair into a single tab.
 */
import { Col, MockTreeRow, Row, SkeletonText } from "./chrome";

export default function TerminalBand() {
  return (
    <Row gap="xs" align="stretch">
      <Col gap="xs" className="tut__mock-grow" align="stretch">
        <Row justify="between" align="center">
          <span className="tut__mock-caption">Terminals</span>
          <span className="tut__mock-btn">+</span>
        </Row>
        <MockTreeRow depth={0} label="bash  2" selected />
        <MockTreeRow depth={0} label="zsh" />
      </Col>

      <div className="tut__mock-vr" />

      <Row gap="xs" className="tut__mock-grow">
        <Col gap="xs" className="tut__mock-grow" align="stretch">
          <SkeletonText width="85%" />
          <SkeletonText width="55%" />
        </Col>
        <div className="tut__mock-vr" />
        <Col gap="xs" className="tut__mock-grow" align="stretch">
          <SkeletonText width="70%" />
          <SkeletonText width="40%" />
        </Col>
      </Row>
    </Row>
  );
}
