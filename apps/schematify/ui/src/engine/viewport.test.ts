/**
 * Pan and zoom. `fitTo` is the interesting surface: it is the only place a
 * bounding box turns into a committed zoom, and PR fix/schematic-fit-empty-
 * viewport traced a real, unrecoverable canvas corruption to it — a `NaN`
 * zoom, once written to `Viewport`, never self-corrects (every later
 * comparison against `NaN` is `false`, so every node fails culling and the
 * Schematic renders permanently empty). These tests hold the floor that bug
 * needed: whatever the inputs, `fitTo` never returns a non-finite viewport.
 */
import { describe, expect, it } from "vitest";
import type { Rect } from "./geometry";
import { fitTo, initialViewport } from "./viewport";
import type { ZoomConfig } from "./config";

const LIMITS: ZoomConfig = { min: 0.2, max: 2, initial: 1 };
const SIZE = { width: 1000, height: 700 };
const START = initialViewport(LIMITS);

describe("fitTo", () => {
  it("leaves the viewport unchanged when there is nothing to fit — an empty node set", () => {
    expect(fitTo(START, null, SIZE, LIMITS)).toEqual(START);
  });

  it("leaves the viewport unchanged for a zero-area bounding box", () => {
    const zeroWidth: Rect = { x: 10, y: 10, width: 0, height: 50 };
    const zeroHeight: Rect = { x: 10, y: 10, width: 50, height: 0 };
    expect(fitTo(START, zeroWidth, SIZE, LIMITS)).toEqual(START);
    expect(fitTo(START, zeroHeight, SIZE, LIMITS)).toEqual(START);
  });

  // The mutation that must turn this red: drop the `!isFiniteRect(bounds)`
  // clause from `fitTo`'s first guard (or the `<= 0` fallback it defends,
  // since `NaN <= 0` is `false` and lets a `NaN` bounds straight through to
  // the division below).
  it("leaves the viewport unchanged for a non-finite bounding box, rather than committing NaN", () => {
    const nanWidth: Rect = { x: 10, y: 10, width: NaN, height: 50 };
    const infiniteHeight: Rect = { x: 10, y: 10, width: 50, height: Infinity };
    expect(fitTo(START, nanWidth, SIZE, LIMITS)).toEqual(START);
    expect(fitTo(START, infiniteHeight, SIZE, LIMITS)).toEqual(START);
  });

  it("leaves the viewport unchanged for a non-finite viewport size", () => {
    const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
    expect(fitTo(START, bounds, { width: NaN, height: 700 }, LIMITS)).toEqual(START);
    expect(fitTo(START, bounds, { width: 1000, height: Infinity }, LIMITS)).toEqual(START);
  });

  it("computes a finite, centred viewport for a normal bounding box", () => {
    const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
    const next = fitTo(START, bounds, SIZE, LIMITS);
    expect(Number.isFinite(next.zoom)).toBe(true);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
    expect(next.zoom).toBeGreaterThan(0);
  });
});
