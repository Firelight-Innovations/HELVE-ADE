import { describe, expect, it } from "vitest";
import {
  auditActorCell,
  auditTransition,
  budgetLatestValue,
  budgetsCounter,
  budgetsNote,
  budgetThreshold,
  contractHistory,
  formatRunAt,
  latestRunLine,
  linterCounter,
  linterNote,
  noProbeCaption,
  reconciliationCounter,
  reconciliationNote,
  relativeTime,
  shortDate,
  signOffCaption,
  statusCell4,
  testsCounter,
  testsNote,
  type AuditLogRow,
  type BudgetHistoryRow,
  type DashboardBudgetCounter,
  type DashboardLinterCounter,
  type DashboardReconciliationCounter,
  type DashboardRun,
  type DashboardTestCounter,
} from "./dashboard";

// The §16.1 reference values throughout: budgets 2/3 with 1 hard budget
// missing a probe, tests 5/7 with 1 failing and 1 unlinked, linter
// 14 rules/0 violations, reconciliation 7/8 with 1 declared absent.

describe("budgetsCounter and budgetsNote", () => {
  it("draws 2 / 3 with the missing-probe note, per the reference fixture", () => {
    const counter: DashboardBudgetCounter = { withProbe: 2, total: 3, hardMissingProbe: 1 };
    expect(budgetsCounter(counter)).toBe("2 / 3");
    expect(budgetsNote(counter)).toBe("1 hard budget has no probe");
  });

  it("pluralises the note for more than 1 missing probe", () => {
    const counter: DashboardBudgetCounter = { withProbe: 0, total: 2, hardMissingProbe: 2 };
    expect(budgetsNote(counter)).toBe("2 hard budgets have no probe");
  });

  it("draws no note when every hard budget has a probe", () => {
    const counter: DashboardBudgetCounter = { withProbe: 3, total: 3, hardMissingProbe: 0 };
    expect(budgetsNote(counter)).toBe("");
  });
});

describe("testsCounter and testsNote", () => {
  it("draws 5 / 7 with both parts of the note, per the reference fixture", () => {
    const counter: DashboardTestCounter = { passing: 5, total: 7, failing: 1, unlinked: 1 };
    expect(testsCounter(counter)).toBe("5 / 7");
    expect(testsNote(counter)).toBe("1 failing · 1 unlinked");
  });

  it("omits a zero part rather than drawing '0 failing'", () => {
    const counter: DashboardTestCounter = { passing: 6, total: 7, failing: 0, unlinked: 1 };
    expect(testsNote(counter)).toBe("1 unlinked");
  });

  it("draws an empty note when nothing is failing or unlinked", () => {
    const counter: DashboardTestCounter = { passing: 7, total: 7, failing: 0, unlinked: 0 };
    expect(testsNote(counter)).toBe("");
  });
});

describe("linterCounter and linterNote", () => {
  it("draws the bare violation count and the rules/violations note", () => {
    const linter: DashboardLinterCounter = { rules: 14, violations: 0 };
    expect(linterCounter(linter)).toBe("0");
    expect(linterNote(linter)).toBe("14 rules · 0 violations");
  });

  it("draws a dash and an explanatory note with no run", () => {
    expect(linterCounter(null)).toBe("—");
    expect(linterNote(null)).toBe("No run has reported yet.");
  });
});

describe("reconciliationCounter and reconciliationNote", () => {
  it("draws 7 / 8 with the declared-absent note, per the reference fixture", () => {
    const r: DashboardReconciliationCounter = {
      matched: 7,
      declaredAbsent: 1,
      presentUnknown: 0,
      duplicate: 0,
    };
    expect(reconciliationCounter(r)).toBe("7 / 8");
    expect(reconciliationNote(r)).toBe("1 declared, absent");
  });

  it("falls through to present-unknown, then duplicate, when declared-absent is 0", () => {
    const presentUnknown: DashboardReconciliationCounter = {
      matched: 5,
      declaredAbsent: 0,
      presentUnknown: 2,
      duplicate: 0,
    };
    expect(reconciliationNote(presentUnknown)).toBe("2 present, unknown");

    const duplicate: DashboardReconciliationCounter = {
      matched: 5,
      declaredAbsent: 0,
      presentUnknown: 0,
      duplicate: 1,
    };
    expect(reconciliationNote(duplicate)).toBe("1 duplicate");
  });

  it("draws a dash and an empty note with no run", () => {
    expect(reconciliationCounter(null)).toBe("—");
    expect(reconciliationNote(null)).toBe("");
  });
});

describe("formatRunAt and latestRunLine", () => {
  it("draws the wireframe's own run line exactly", () => {
    expect(formatRunAt("2026-08-25T14:02:00Z")).toBe("2026-08-25 14:02Z");
    const run: DashboardRun = {
      run: 1184,
      at: "2026-08-25T14:02:00Z",
      commit: "4f2c9ab",
      workflow: "ci/verify.yml",
    };
    // Interpolated rather than a literal hash-then-digits run number:
    // `noLiteralHex.test.ts` scans for a hash mark directly followed by 3-8
    // hex characters, and a run number's decimal digits happen to match
    // too — the same false positive `graph/module.ts` already documents
    // and avoids the same way.
    expect(latestRunLine(run)).toBe(`#${1184} · 2026-08-25 14:02Z · 4f2c9ab · ci/verify.yml`);
  });

  it("draws a stand-in line for a module that never ran", () => {
    expect(latestRunLine(null)).toBe("No run yet.");
  });
});

describe("relativeTime and statusCell4", () => {
  const twoHoursAgo = "2026-08-25T12:02:00Z";
  const now = Date.parse("2026-08-25T14:02:00Z");

  it("draws hours for something 2 hours old", () => {
    expect(relativeTime(twoHoursAgo, now)).toBe("2h ago");
  });

  it("draws minutes under an hour and days over a day", () => {
    expect(relativeTime("2026-08-25T13:47:00Z", now)).toBe("15m ago");
    expect(relativeTime("2026-08-20T14:02:00Z", now)).toBe("5d ago");
  });

  it("composes into status bar cell 4", () => {
    const run: DashboardRun = { run: 1184, at: twoHoursAgo, commit: "x", workflow: "y" };
    expect(statusCell4(run, now)).toBe(`run #${1184} · 2h ago`);
  });

  it("draws blank rather than a guessed run with no run at all", () => {
    expect(statusCell4(null, now)).toBe("");
  });
});

describe("shortDate", () => {
  it("draws the audit log's own date form", () => {
    expect(shortDate("2026-08-25T14:02:00Z")).toBe("25 Aug 14:02");
    expect(shortDate("2026-08-02T16:55:00Z")).toBe("02 Aug 16:55");
  });
});

describe("auditTransition and auditActorCell", () => {
  const humanRow: AuditLogRow = {
    when: "2026-08-25T14:02:00Z",
    from: "reviewed",
    to: "accepted",
    actor: "human",
    actorName: "m.ross",
    reason: "Result type resolves the throw-on-expiry ambiguity.",
  };
  const agentRow: AuditLogRow = {
    when: "2026-08-24T22:18:00Z",
    from: "assigned",
    to: "implemented",
    actor: "agent",
    actorName: "claude-sdd",
    reason: "All declared tests linked. 1 failing, flagged not asserted.",
  };

  it("draws the transition arrow", () => {
    expect(auditTransition(humanRow)).toBe("reviewed → accepted");
  });

  it("draws the 2 differently-ordered actor forms the wireframe carries", () => {
    expect(auditActorCell(humanRow)).toBe("m.ross · human");
    expect(auditActorCell(agentRow)).toBe("◇ agent · claude-sdd");
  });
});

describe("budgetThreshold and budgetLatestValue", () => {
  const hard: BudgetHistoryRow = {
    metric: "verify_p95",
    tier: "hard",
    op: "<",
    threshold: 3,
    unit: "ms",
    hasProbe: true,
    probeCommand: "pnpm bench:verify",
    latestValue: 1.8,
    pass: true,
    signOff: null,
  };

  it("draws the threshold and the latest measurement", () => {
    expect(budgetThreshold(hard)).toBe("< 3 ms");
    expect(budgetLatestValue(hard)).toBe("1.8 ms");
  });

  it("draws a dash for a metric no run has measured", () => {
    expect(budgetLatestValue({ ...hard, latestValue: null })).toBe("—");
  });
});

describe("signOffCaption and noProbeCaption", () => {
  const softTrending: BudgetHistoryRow = {
    metric: "jwks_refetch_rate",
    tier: "soft",
    op: "<",
    threshold: 1,
    unit: "per minute",
    hasProbe: true,
    probeCommand: "pnpm bench:jwks",
    latestValue: 0.9,
    pass: true,
    signOff: `m.ross, run #${1179}`,
  };
  const noProbe: BudgetHistoryRow = {
    metric: "cold_start_p95",
    tier: "hard",
    op: "<",
    threshold: 800,
    unit: "ms",
    hasProbe: false,
    probeCommand: null,
    latestValue: null,
    pass: null,
    signOff: null,
  };

  it("names the signer and the run", () => {
    expect(signOffCaption(softTrending)).toBe(`Sign-off named: m.ross, run #${1179}.`);
    expect(signOffCaption(noProbe)).toBeNull();
  });

  it("draws the unmeasurable-claim caption only for a budget with no probe", () => {
    expect(noProbeCaption(noProbe)).toEqual([
      "No probe declared",
      "An unmeasurable claim is a lint error, not a warning.",
    ]);
    expect(noProbeCaption(softTrending)).toBeNull();
  });
});

describe("contractHistory", () => {
  it("is always empty — no schema backs this table for any module", () => {
    // A real project can hold a module slugged `token-verifier` (an
    // ordinary name for an auth service); a slug-gated stand-in would have
    // drawn this app's own invented rows into that project's real
    // dashboard. See the wave 9d handoff §4 for the review finding this
    // fixes.
    expect(contractHistory()).toEqual([]);
  });
});
