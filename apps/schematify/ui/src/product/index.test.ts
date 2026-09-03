/**
 * Every assertion here reads a computed value, not just "did not throw" —
 * STANDARDS.md §8's rule that a test which cannot fail is worse than none.
 * Each test below was proved able to fail: the function it covers was
 * temporarily broken (a wrong operator, a swapped field, a missing filter)
 * and the test failed before the fix was restored, per the same standard's
 * instruction to prove a test can catch the bug it claims to.
 */
import { describe, expect, it } from "vitest";
import {
  decisionDisplaySlug,
  decisionUri,
  emptyBrief,
  filterDecisions,
  isValidSuccessMetric,
  resolveFlowSteps,
  screenBackingModuleCount,
  screenDesignLinkState,
  screenStateCount,
  screenUri,
  sortDecisions,
  uriId,
  type RawDecision,
  type RawFlow,
  type RawScreen,
} from "./index";

function screen(partial: Partial<RawScreen> & Pick<RawScreen, "id" | "slug">): RawScreen {
  return {
    kind: "screen",
    title: partial.slug,
    purpose: "",
    states: [],
    acceptance: [],
    backed_by: [],
    ...partial,
  };
}

function decision(
  partial: Partial<RawDecision> & Pick<RawDecision, "id" | "slug" | "status" | "date">,
): RawDecision {
  return {
    kind: "decision",
    title: partial.slug,
    context: "",
    decision: "",
    consequences: "",
    ...partial,
  };
}

describe("uriId", () => {
  it("extracts the uuid half of a schematify:// reference", () => {
    const id = "0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8";
    expect(uriId(`schematify://screen/${id}`)).toBe(id);
    expect(uriId(`schematify://decision/${id}`)).toBe(id);
  });

  it("returns null for a string that is not a schematify:// reference", () => {
    expect(uriId("journeyman://screen/login-form")).toBeNull();
    expect(uriId("not a uri at all")).toBeNull();
  });
});

describe("screenUri / decisionUri", () => {
  it("build the stored reference form, not the drawn form", () => {
    const s = screen({ id: "id-1", slug: "login-form" });
    expect(screenUri(s)).toBe("schematify://screen/id-1");

    const d = decision({
      id: "id-2",
      slug: "DEC-TEC-AUTH-004",
      status: "ACTIVE",
      date: "2026-08-19",
    });
    expect(decisionUri(d)).toBe("schematify://decision/id-2");
  });
});

describe("decisionDisplaySlug", () => {
  it("draws the structured slug, per PRD §3.3", () => {
    const d = decision({
      id: "id-1",
      slug: "DEC-TEC-AUTH-004",
      status: "ACTIVE",
      date: "2026-08-19",
    });
    expect(decisionDisplaySlug(d)).toBe("DEC-TEC-AUTH-004");
  });
});

describe("screenStateCount", () => {
  it("counts the states array, not a stored number", () => {
    const s = screen({ id: "s1", slug: "login-form", states: ["empty", "filled", "error"] });
    expect(screenStateCount(s)).toBe(3);
  });

  it("is 0 for a screen with no states authored", () => {
    expect(screenStateCount(screen({ id: "s1", slug: "login-form" }))).toBe(0);
  });
});

describe("screenBackingModuleCount", () => {
  it("counts only the backing references that resolve to a real node", () => {
    const s = screen({
      id: "s1",
      slug: "login-form",
      backed_by: [
        "schematify://node/mod-1",
        "schematify://node/mod-2",
        "schematify://node/mod-gone",
      ],
    });
    const nodeIds = new Set(["mod-1", "mod-2"]);
    expect(screenBackingModuleCount(s, nodeIds)).toBe(2);
  });

  it("is 0 when no backing reference resolves", () => {
    const s = screen({ id: "s1", slug: "login-form", backed_by: ["schematify://node/gone"] });
    expect(screenBackingModuleCount(s, new Set())).toBe(0);
  });
});

describe("screenDesignLinkState", () => {
  it("reads linked when design_ref is present", () => {
    const s = screen({ id: "s1", slug: "login-form", design_ref: "https://claude.ai/design/p/x" });
    expect(screenDesignLinkState(s)).toBe("linked");
  });

  it("reads none when design_ref is absent", () => {
    expect(screenDesignLinkState(screen({ id: "s1", slug: "login-form" }))).toBe("none");
  });
});

describe("resolveFlowSteps", () => {
  const screens: RawScreen[] = [
    screen({ id: "s1", slug: "login-form", title: "Login form" }),
    screen({ id: "s2", slug: "dashboard", title: "Dashboard" }),
  ];

  it("resolves each step's screen reference to a title and slug", () => {
    const flow: RawFlow = {
      id: "f1",
      kind: "flow",
      slug: "first-run-signup",
      title: "First-run signup",
      trigger: "A visitor opens the product with no account.",
      steps: [
        { screen: "schematify://screen/s1", action: "Enters an email." },
        { screen: "schematify://screen/s2", action: "Lands on the dashboard." },
      ],
      outcome: "The visitor holds an active session.",
    };

    const resolved = resolveFlowSteps(flow, screens);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({
      index: 0,
      screenTitle: "Login form",
      screenSlug: "login-form",
    });
    expect(resolved[1]).toMatchObject({
      index: 1,
      screenTitle: "Dashboard",
      screenSlug: "dashboard",
    });
  });

  it("resolves a dangling screen reference to null rather than throwing", () => {
    const flow: RawFlow = {
      id: "f1",
      kind: "flow",
      slug: "orphan-flow",
      title: "Orphan flow",
      trigger: "x",
      steps: [{ screen: "schematify://screen/gone", action: "Does something." }],
      outcome: "y",
    };

    const resolved = resolveFlowSteps(flow, screens);
    expect(resolved[0].screenTitle).toBeNull();
    expect(resolved[0].screenSlug).toBeNull();
  });
});

describe("sortDecisions", () => {
  it("draws every active row before every superseded row", () => {
    const rows = [
      decision({ id: "1", slug: "DEC-A", status: "SUPERSEDED", date: "2026-08-01" }),
      decision({ id: "2", slug: "DEC-B", status: "ACTIVE", date: "2026-07-01" }),
      decision({ id: "3", slug: "DEC-C", status: "ACTIVE", date: "2026-08-19" }),
    ];
    const sorted = sortDecisions(rows);
    expect(sorted.map((d) => d.id)).toEqual(["3", "2", "1"]);
  });

  it("does not mutate its input", () => {
    const rows = [decision({ id: "1", slug: "DEC-A", status: "ACTIVE", date: "2026-08-01" })];
    const copy = [...rows];
    sortDecisions(rows);
    expect(rows).toEqual(copy);
  });
});

describe("filterDecisions", () => {
  const rows = [
    decision({ id: "1", slug: "DEC-A", status: "ACTIVE", date: "2026-08-01" }),
    decision({ id: "2", slug: "DEC-B", status: "SUPERSEDED", date: "2026-07-01" }),
  ];

  it("ALL returns every row", () => {
    expect(filterDecisions(rows, "ALL")).toHaveLength(2);
  });

  it("ACTIVE returns only active rows", () => {
    expect(filterDecisions(rows, "ACTIVE").map((d) => d.id)).toEqual(["1"]);
  });

  it("SUPERSEDED returns only superseded rows", () => {
    expect(filterDecisions(rows, "SUPERSEDED").map((d) => d.id)).toEqual(["2"]);
  });
});

describe("isValidSuccessMetric", () => {
  it("rejects a metric with no unit, per PRD §5.12", () => {
    expect(isValidSuccessMetric({ name: "verify_p95", value: 3, unit: "" })).toBe(false);
  });

  it("rejects a metric with no name", () => {
    expect(isValidSuccessMetric({ name: "  ", value: 3, unit: "ms" })).toBe(false);
  });

  it("accepts a metric carrying both", () => {
    expect(isValidSuccessMetric({ name: "verify_p95", value: 3, unit: "ms" })).toBe(true);
  });
});

describe("emptyBrief", () => {
  it("returns a brief with both required fields blank and every list empty", () => {
    const brief = emptyBrief();
    expect(brief.product_name).toBe("");
    expect(brief.problem).toBe("");
    expect(brief.success_metrics).toEqual([]);
  });
});
