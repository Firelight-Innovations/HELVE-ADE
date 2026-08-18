/** The Home screen's left column: Start, then Recents with one gone missing —
 *  see `apps/home/ui/src/App.tsx`. */
import { Chip, Col, MockWindow, Row, SkeletonText } from "./chrome";

const START = ["New Project", "Open Project", "Clone Project"];

export default function HomeStart() {
  return (
    <Row gap="md" wrap>
      <MockWindow title="Start" className="tut__mock-grow">
        <Col gap="sm">
          {START.map((label) => (
            <Row key={label} justify="between" align="center">
              <span className="tut__mock-caption">{label}</span>
              {label === "Clone Project" && <Chip tone="neutral">soon</Chip>}
            </Row>
          ))}
        </Col>
      </MockWindow>

      {/* Every row keeps its own remove button — see `firstProject.ts`: "The ×
          beside it removes it from the list; nothing on disk is touched." The
          missing row cannot be opened, only forgotten, which is why it alone
          gets a tone instead of a plain caption. */}
      <MockWindow title="Recents" className="tut__mock-grow">
        <Col gap="sm">
          <Row justify="between" align="center">
            <Row gap="sm" align="center">
              <SkeletonText width="45%" />
              <span className="tut__mock-caption">3 hours ago</span>
            </Row>
            <span className="tut__mock-caption">×</span>
          </Row>
          <Row justify="between" align="center">
            <Row gap="sm" align="center">
              <SkeletonText width="35%" />
              <Chip tone="err">missing</Chip>
            </Row>
            <span className="tut__mock-caption">×</span>
          </Row>
          <Row justify="between" align="center">
            <Row gap="sm" align="center">
              <SkeletonText width="50%" />
              <span className="tut__mock-caption">2 days ago</span>
            </Row>
            <span className="tut__mock-caption">×</span>
          </Row>
        </Col>
      </MockWindow>
    </Row>
  );
}
