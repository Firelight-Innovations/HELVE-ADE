import { describe, expect, it } from "vitest";
import { agoCompact, staleCaption } from "./staleness";

describe("agoCompact", () => {
  const now = Date.parse("2026-08-25T14:00:00Z");

  it("draws the wireframe's own example: 2h ago", () => {
    const at = Date.parse("2026-08-25T12:00:00Z");
    expect(agoCompact(at, now)).toBe("2h ago");
  });

  it("reads under a minute as just now", () => {
    expect(agoCompact(now - 30_000, now)).toBe("just now");
  });

  it("stays in minutes under an hour", () => {
    expect(agoCompact(now - 4 * 60_000, now)).toBe("4m ago");
  });

  it("rolls over to days at 24 hours", () => {
    expect(agoCompact(now - 25 * 60 * 60_000, now)).toBe("1d ago");
  });

  it("never reads negative for a clock that runs slightly behind the mark", () => {
    expect(agoCompact(now + 5_000, now)).toBe("just now");
  });
});

describe("staleCaption", () => {
  const now = Date.parse("2026-08-25T14:00:00Z");

  it("matches the wireframe's exact second line for a facet-level change", () => {
    const caption = staleCaption(
      { source: "mod-1", member: "sign", at: "2026-08-25T12:00:00Z" },
      "crypto-primitives",
      now,
    );
    expect(caption).toBe("crypto-primitives.sign changed 2h ago. Re-review required.");
  });

  it("drops the member when a service's exports changed instead of one method", () => {
    const caption = staleCaption(
      { source: "svc-1", at: "2026-08-25T12:00:00Z" },
      "auth-service",
      now,
    );
    expect(caption).toBe("auth-service changed 2h ago. Re-review required.");
  });

  it("is undefined with no stale mark at all", () => {
    expect(staleCaption(undefined, "crypto-primitives", now)).toBeUndefined();
  });

  it("is undefined when the source cannot be resolved to a slug", () => {
    const caption = staleCaption(
      { source: "mod-1", member: "sign", at: "2026-08-25T12:00:00Z" },
      undefined,
      now,
    );
    expect(caption).toBeUndefined();
  });
});
