/** Staged and unstaged lists, and the commit box — see
 *  `src/shell/worktree/SourceControlView.tsx`. Letter tones follow
 *  `GIT_KIND_TOKEN` in `contract.ts`: modified/renamed are warn, added is ok,
 *  deleted is err. The checkbox only fills in on a staged row, the one visual
 *  difference between the two sections beyond which list a file sits in. */
import { Col, MockWindow, Row } from "./chrome";

function ChangeRow({
  letter,
  tone,
  name,
  staged,
}: {
  letter: string;
  tone: "ok" | "warn" | "err";
  name: string;
  staged: boolean;
}) {
  return (
    <Row gap="xs" align="center">
      <span className="tut__mock-checkbox">{staged ? "✓" : ""}</span>
      <span className={`tut__mock-treerow-label tut__mock-treerow-label--${tone}`}>{letter}</span>
      <span className="tut__mock-caption">{name}</span>
    </Row>
  );
}

export default function SourceControl() {
  return (
    <MockWindow title="main">
      <Col gap="sm">
        <Col gap="xs">
          <Row justify="between" align="center">
            <span className="tut__mock-caption">Staged Changes</span>
            <span className="tut__mock-caption">2</span>
          </Row>
          <ChangeRow letter="M" tone="warn" name="layout.rs" staged />
          <ChangeRow letter="A" tone="ok" name="pane_split.rs" staged />
        </Col>

        <Col gap="xs">
          <Row justify="between" align="center">
            <span className="tut__mock-caption">Changes</span>
            <span className="tut__mock-caption">1</span>
          </Row>
          <ChangeRow letter="D" tone="err" name="old_layout.rs" staged={false} />
        </Col>

        <span className="tut__mock-field">Commit message</span>
        <span className="tut__mock-btn tut__mock-btn--accent">Commit</span>
      </Col>
    </MockWindow>
  );
}
