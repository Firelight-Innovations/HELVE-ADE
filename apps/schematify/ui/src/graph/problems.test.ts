/**
 * The Problems panel's own pure logic — see `./problems.ts`'s header for why
 * this is DOM-free and unit-tested directly rather than through a render.
 *
 * Every literal string and shape below is checked against
 * `docs/design/SCHEMATIFY-PRD.md` §12.14/§10.4 and
 * `docs/overnight-jobs/overnight-2/WIREFRAME-EXTRACT.md` §1.1's Problems
 * rows, the same reference fixture `crates/schematify-core/tests/lint.rs`
 * asserts against on the Rust side.
 */
import { describe, expect, it } from "vitest";
import {
  drillTargetForLocation,
  locationCell,
  problemBadges,
  projectFindings,
  resolveClickThrough,
  severityGlyph,
  severityWord,
  statusCell3,
  subjectId,
  type Finding,
  type Location,
  type RawLintReport,
} from "./problems";

/** The reference fixture's own row 2 (PRD §16.1), the one Location surface
 *  ("module") the other 3 don't exercise. */
const RAW_REPORT: RawLintReport = {
  findings: [
    {
      rule: "L02",
      rule_name: "Dependency graph is acyclic",
      severity: "error",
      subject: "schematify://node/0192f4a1-0000-0000-0000-000000000001",
      node_cell: "session-codec → token-issuer → …",
      location: { surface: "service", id: "svc-1", title: "Auth Service", slug: "auth-service" },
      detail: "The dependency chain closes on itself.",
      evidence: ["a", "b"],
    },
    {
      rule: "L03",
      rule_name: "Budget declared without a probe",
      severity: "error",
      subject: "schematify://node/0192f4a1-0000-0000-0000-000000000002",
      node_cell: "token-verifier · cold_start_p95",
      location: { surface: "module", id: "mod-1", title: "Token Verifier", slug: "token-verifier" },
      detail: "token-verifier declares cold_start_p95 with no probe command.",
      evidence: [],
    },
  ],
  nodes: 12,
  edges: 9,
  screens: 1,
  decisions: 0,
  rules: 13,
};

describe("projectFindings", () => {
  it("renames node_cell to nodeCell and passes every other field through, in order", () => {
    const findings = projectFindings(RAW_REPORT);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      rule: "L02",
      ruleName: "Dependency graph is acyclic",
      severity: "error",
      subject: "schematify://node/0192f4a1-0000-0000-0000-000000000001",
      nodeCell: "session-codec → token-issuer → …",
      location: { surface: "service", id: "svc-1", title: "Auth Service", slug: "auth-service" },
      detail: "The dependency chain closes on itself.",
      evidence: ["a", "b"],
    });
    expect(findings[1].nodeCell).toBe("token-verifier · cold_start_p95");
  });
});

describe("severityGlyph and severityWord", () => {
  it("draws the wireframe's own 2 glyphs", () => {
    // WIREFRAME-EXTRACT.md §1.1: "● ERROR" / "▲ WARN".
    expect(severityGlyph("error")).toBe("●");
    expect(severityWord("error")).toBe("ERROR");
    expect(severityGlyph("warning")).toBe("▲");
    expect(severityWord("warning")).toBe("WARN");
  });
});

describe("locationCell", () => {
  // Broken on purpose once (dropped the "Stack › " prefix on the service
  // case) to confirm this test catches a real formatting regression before
  // being fixed back — recorded in the wave 7b commit message.
  it("mirrors Location::cell() for all 5 surfaces PRD §12.14 draws", () => {
    const cases: [Location, string][] = [
      [{ surface: "stack" }, "Stack"],
      [
        { surface: "service", id: "x", title: "Auth Service", slug: "auth-service" },
        "Stack › Auth Service",
      ],
      [
        { surface: "module", id: "x", title: "Token Verifier", slug: "token-verifier" },
        "› Token Verifier",
      ],
      [{ surface: "decision_log" }, "Decision Log"],
      [{ surface: "product" }, "Product"],
    ];
    for (const [location, expected] of cases) {
      expect(locationCell(location)).toBe(expected);
    }
  });
});

describe("problemBadges and statusCell3", () => {
  it("counts the reference fixture's 3 errors and 2 warnings", () => {
    const findings: Finding[] = [
      errorFinding(),
      errorFinding(),
      errorFinding(),
      warningFinding(),
      warningFinding(),
    ];
    expect(problemBadges(findings)).toEqual({ errors: 3, warnings: 2 });
    expect(statusCell3(findings)).toBe("3 errors · 2 warnings");
  });

  it("counts zero of each on an empty report", () => {
    expect(problemBadges([])).toEqual({ errors: 0, warnings: 0 });
    expect(statusCell3([])).toBe("0 errors · 0 warnings");
  });
});

describe("subjectId", () => {
  it("takes the uuid off a schematify:// reference, whatever kind it names", () => {
    expect(subjectId("schematify://node/0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8")).toBe(
      "0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8",
    );
    expect(subjectId("schematify://screen/abc")).toBe("abc");
    expect(subjectId("schematify://decision/def")).toBe("def");
  });
});

describe("drillTargetForLocation", () => {
  it("opens the Stack Schematic for a stack location", () => {
    expect(drillTargetForLocation({ surface: "stack" })).toEqual({
      tier: "stack",
      slug: "stack",
      title: "Stack",
    });
  });

  it("opens a Service Schematic by the location's own slug", () => {
    expect(
      drillTargetForLocation({
        surface: "service",
        id: "x",
        title: "Auth Service",
        slug: "auth-service",
      }),
    ).toEqual({ tier: "service", slug: "auth-service", title: "Auth Service" });
  });

  it("opens a Module Schematic by the location's own slug", () => {
    expect(
      drillTargetForLocation({
        surface: "module",
        id: "x",
        title: "Token Verifier",
        slug: "token-verifier",
      }),
    ).toEqual({ tier: "module", slug: "token-verifier", title: "Token Verifier" });
  });

  it("names no Schematic for the decision log or product surfaces", () => {
    expect(drillTargetForLocation({ surface: "decision_log" })).toBeNull();
    expect(drillTargetForLocation({ surface: "product" })).toBeNull();
  });
});

describe("resolveClickThrough", () => {
  const finding = (location: Location): Finding => ({
    rule: "L03",
    ruleName: "Budget declared without a probe",
    severity: "error",
    subject: "schematify://node/target-id",
    nodeCell: "token-verifier · cold_start_p95",
    location,
    detail: "",
    evidence: [],
  });

  it("selects with no navigation when the target Schematic is already open", () => {
    const current = { tier: "module" as const, slug: "token-verifier" };
    const location: Location = {
      surface: "module",
      id: "x",
      title: "Token Verifier",
      slug: "token-verifier",
    };
    expect(resolveClickThrough(current, finding(location))).toEqual({ select: "target-id" });
  });

  it("navigates and selects when the target Schematic is a different tier", () => {
    const current = { tier: "service" as const, slug: "auth-service" };
    const location: Location = {
      surface: "module",
      id: "x",
      title: "Token Verifier",
      slug: "token-verifier",
    };
    expect(resolveClickThrough(current, finding(location))).toEqual({
      navigate: { tier: "module", slug: "token-verifier", title: "Token Verifier" },
      select: "target-id",
    });
  });

  it("navigates and selects when the target is the same tier but a different instance", () => {
    const current = { tier: "service" as const, slug: "billing-service" };
    const location: Location = {
      surface: "service",
      id: "x",
      title: "Auth Service",
      slug: "auth-service",
    };
    expect(resolveClickThrough(current, finding(location))).toEqual({
      navigate: { tier: "service", slug: "auth-service", title: "Auth Service" },
      select: "target-id",
    });
  });

  it("resolves to null for a decision log row — nothing to click through to", () => {
    const current = { tier: "stack" as const, slug: "stack" };
    expect(resolveClickThrough(current, finding({ surface: "decision_log" }))).toBeNull();
  });
});

function errorFinding(): Finding {
  return {
    rule: "L02",
    ruleName: "Dependency graph is acyclic",
    severity: "error",
    subject: "schematify://node/e",
    nodeCell: "a → b → …",
    location: { surface: "stack" },
    detail: "",
    evidence: [],
  };
}

function warningFinding(): Finding {
  return {
    rule: "L10",
    ruleName: "Shared node sits above the LCA of its dependents",
    severity: "warning",
    subject: "schematify://node/w",
    nodeCell: "crypto-primitives",
    location: { surface: "stack" },
    detail: "",
    evidence: [],
  };
}
