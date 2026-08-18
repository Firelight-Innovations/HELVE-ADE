/** The switcher bar's health popover, mid-setup — see `HealthPopover.tsx`.
 *
 *  Three things here are the real component's rules rather than a choice.
 *  Only unwell tools have rows, so a healthy one is absent instead of green;
 *  only the six authoring tools can appear, because `WindowRoot` filters the
 *  list to `kind === "dev-tool"` and the Engine is a runtime; and the words
 *  are `HEALTH_LABEL`'s, never the backend's `mismatch` / `unversioned` /
 *  `missing`, which `contract.ts` keeps off the screen on purpose.
 *
 *  Tones follow `HEALTH_TOKEN`: both "needs update" and "not tracked" warn,
 *  "not installed" errs. Red here is the expected reading on a fresh machine,
 *  which is the point `theStack.ts` spends its middle section on. */
import { Chip, Col, Row } from "./chrome";

/** One row per unwell tool, in the order `helve.toml` pins them. */
const UNWELL: { name: string; tone: "warn" | "err"; label: string }[] = [
  { name: "Forger", tone: "err", label: "not installed" },
  { name: "Journeyman", tone: "err", label: "not installed" },
  { name: "Turner", tone: "warn", label: "needs update" },
  { name: "Scrivener", tone: "warn", label: "not tracked" },
  { name: "Quickener", tone: "err", label: "not installed" },
  { name: "Wright", tone: "err", label: "not installed" },
];

export default function StackList() {
  return (
    <Col gap="xs">
      <Row justify="between" align="center">
        <span className="tut__mock-caption">TOOL HEALTH</span>
        <Chip tone="warn">{UNWELL.length}</Chip>
      </Row>
      {UNWELL.map((tool) => (
        <Row key={tool.name} justify="between" align="center">
          <span className="tut__mock-caption">{tool.name}</span>
          <Chip tone={tool.tone}>{tool.label}</Chip>
        </Row>
      ))}
    </Col>
  );
}
