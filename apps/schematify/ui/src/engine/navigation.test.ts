/**
 * Click-to-drill (PRD §17 Wave 5). Pure and DOM-free — see `./navigation.ts`'s
 * own header comment for why this is the one piece of the drill gesture that
 * gets a test at all.
 */
import { describe, expect, it } from "vitest";
import { MODULE_CONFIG, SERVICE_CONFIG, STACK_CONFIG } from "./presets";
import { configFor, nextDrillTarget } from "./navigation";

describe("nextDrillTarget", () => {
  it("opens a Service Schematic from a click on a service at the stack tier", () => {
    expect(
      nextDrillTarget("stack", {
        kind: "service",
        slug: "billing-service",
        title: "Billing Service",
      }),
    ).toEqual({ tier: "service", slug: "billing-service", title: "Billing Service" });
  });

  it("opens a Module Schematic from a click on a module at the service tier", () => {
    expect(
      nextDrillTarget("service", {
        kind: "module",
        slug: "token-verifier",
        title: "Token Verifier",
      }),
    ).toEqual({ tier: "module", slug: "token-verifier", title: "Token Verifier" });
  });

  it("goes nowhere for a group, at the stack tier", () => {
    expect(
      nextDrillTarget("stack", { kind: "group", slug: "platform-core", title: "Platform Core" }),
    ).toBeNull();
  });

  it("goes nowhere for a facet card, at the module tier", () => {
    expect(
      nextDrillTarget("module", {
        kind: "contract-method",
        slug: "verify_signature",
        title: "verify_signature",
      }),
    ).toBeNull();
  });

  it("goes nowhere for a module clicked at the stack tier", () => {
    // Wrong tier for that kind: a module is not a service.
    expect(nextDrillTarget("stack", { kind: "module", slug: "x", title: "X" })).toBeNull();
  });
});

describe("configFor", () => {
  it("returns the stack preset unmodified, since there is exactly 1 stack", () => {
    expect(configFor({ tier: "stack", slug: "anything", title: "Stack" })).toBe(STACK_CONFIG);
  });

  it("overrides the service preset's layoutSlug per target", () => {
    const config = configFor({
      tier: "service",
      slug: "billing-service",
      title: "Billing Service",
    });
    expect(config.layoutSlug).toBe("billing-service");
    expect(config.tier).toBe("service");
    expect(config.edgeKinds).toBe(SERVICE_CONFIG.edgeKinds);
  });

  it("overrides the module preset's layoutSlug per target", () => {
    const config = configFor({ tier: "module", slug: "jwks-cache", title: "JWKS Cache" });
    expect(config.layoutSlug).toBe("jwks-cache");
    expect(config.arrangement).toBe(MODULE_CONFIG.arrangement);
  });
});
