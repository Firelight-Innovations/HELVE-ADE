/** Each cluster, mapped by an arrow to the branch or worktree it is on — see
 *  `gitAndWorktrees.ts` on why a cluster owns its own checkout. Only one of
 *  the three below has taken the worktree offer; the other two just sit on
 *  whatever the project folder has checked out, which is the ordinary case
 *  the tutorial says to expect. */
import { Arrow, Chip, Col, Row } from "./chrome";

const CLUSTERS: { name: string; branch: string; worktree: boolean }[] = [
  { name: "Anvil", branch: "main", worktree: false },
  { name: "Anvil (review)", branch: "feature/pane-split", worktree: true },
  { name: "Website", branch: "main", worktree: false },
];

export default function WorktreeList() {
  return (
    <Col gap="xs">
      {CLUSTERS.map((cluster) => (
        <Row key={cluster.name} gap="xs" align="center">
          <span className="tut__mock-dot tut__mock-dot--accent" />
          <span className="tut__mock-caption">{cluster.name}</span>
          <Arrow dir="right" />
          <span className="tut__mock-caption">{cluster.branch}</span>
          {cluster.worktree && <Chip tone="accent">worktree</Chip>}
        </Row>
      ))}
    </Col>
  );
}
