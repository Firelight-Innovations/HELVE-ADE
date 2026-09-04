/**
 * Pan and zoom. `fitTo` is the interesting surface: it is the only place a
 * bounding box turns into a committed zoom, and PR fix/schematic-fit-empty-
 * viewport traced a real, unrecoverable canvas corruption to it — a `NaN`
 * zoom, once written to `Viewport`, never self-corrects (every later
 * comparison against `NaN` is `false`, so every node fails culling and the
 * Schematic renders permanently empty). These tests hold the floor that bug
 * needed: whatever the inputs, `fitTo` never returns a non-finite viewport.
 *
 * The `size` checks below are not a hypothetical: the live trigger turned out
 * to be `SchematicCanvas`'s own host element going briefly unmeasured across
 * a breadcrumb navigation (the component remounts, so there is a frame where
 * no `ResizeObserver` has reported a size yet) rather than the malformed
 * stored geometry `layout.ts` guards against — `size.width` arrived as
 * `undefined`, and `undefined <= 0` is `false`, same as `NaN <= 0`. `fitTo`'s
 * handling of `size` — its own early `Number.isFinite` check, backstopped by
 * the same result floor described above — is what actually saved that live
 * case, independent of the `layout.ts` fix.
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

  // As with the `size` guard below, either the early `!isFiniteRect(bounds)`
  // clause or the floor on the returned result alone would save this case
  // (a `NaN` bounds still produces a non-finite `next.zoom`/`x`/`y`, which
  // the final check catches independently) — the mutation that must turn
  // this red is dropping *both*: the `!isFiniteRect(bounds)` clause (`NaN <=
  // 0` is `false`, so the `<= 0` fallback alone would not catch it) and the
  // `finite ? next : viewport` check on the return value.
  it("leaves the viewport unchanged for a non-finite bounding box, rather than committing NaN", () => {
    const nanWidth: Rect = { x: 10, y: 10, width: NaN, height: 50 };
    const infiniteHeight: Rect = { x: 10, y: 10, width: 50, height: Infinity };
    expect(fitTo(START, nanWidth, SIZE, LIMITS)).toEqual(START);
    expect(fitTo(START, infiniteHeight, SIZE, LIMITS)).toEqual(START);
  });

  // `fitTo` catches a bad `size` two ways — the early `Number.isFinite`
  // guard below, and the floor on the computed result at the end — and
  // either alone is enough to save these 2 cases (a `NaN`/`Infinity` size
  // still produces a non-finite `next.zoom`/`x`/`y`, which the final check
  // catches on its own). The mutation that must turn both red is removing
  // *both*: drop the `!Number.isFinite(size.width) || !Number.isFinite(
  // size.height)` guard, and drop the `finite ? next : viewport` check on
  // the return value.
  it("leaves the viewport unchanged for a non-finite viewport size", () => {
    const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
    expect(fitTo(START, bounds, { width: NaN, height: 700 }, LIMITS)).toEqual(START);
    expect(fitTo(START, bounds, { width: 1000, height: Infinity }, LIMITS)).toEqual(START);
  });

  // The live shape of the bug: `SchematicCanvas`'s host element unmeasured
  // for one frame after a breadcrumb navigation remounts it, so `size.width`
  // is `undefined` rather than `NaN` — `Number.isFinite(undefined)` is
  // `false`, same as for `NaN`, so the same 2 guards above have to catch
  // this too (and, per the previous test's comment, either one alone does).
  it("leaves the viewport unchanged for a missing (undefined) viewport size", () => {
    const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
    const unmeasured = { width: undefined as unknown as number, height: 700 };
    expect(fitTo(START, bounds, unmeasured, LIMITS)).toEqual(START);
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
