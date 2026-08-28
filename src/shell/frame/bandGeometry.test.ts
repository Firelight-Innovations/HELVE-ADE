import { describe, expect, it } from "vitest";
import {
  BAND_SHUT,
  bandGeometry,
  withBandGeometry,
  type BandGeometryByCluster,
} from "./bandGeometry";

describe("bandGeometry", () => {
  it("reports a cluster nobody has touched as shut", () => {
    expect(bandGeometry({}, "cluster-1")).toEqual(BAND_SHUT);
  });

  it("reports a window with no cluster as shut", () => {
    const opened = withBandGeometry({}, "cluster-1", { collapsed: false });
    expect(bandGeometry(opened, null)).toEqual(BAND_SHUT);
  });

  /** The bug, in the shape it was reported: the band pulled all the way up in
   *  one cluster, halfway in the next, and the first one's state gone. */
  it("keeps each cluster's band state to itself", () => {
    let state: BandGeometryByCluster = {};

    // Cluster 1, dragged all the way up.
    state = withBandGeometry(state, "cluster-1", { collapsed: false, maximized: true });
    // Cluster 2 is opened, and its band pulled only halfway.
    state = withBandGeometry(state, "cluster-2", { collapsed: false, maximized: false });

    expect(bandGeometry(state, "cluster-1")).toEqual({ collapsed: false, maximized: true });
    expect(bandGeometry(state, "cluster-2")).toEqual({ collapsed: false, maximized: false });
  });

  it("patches one half without restating the other", () => {
    const maximized = withBandGeometry({}, "cluster-1", { collapsed: false, maximized: true });
    const shut = withBandGeometry(maximized, "cluster-1", { collapsed: true });

    expect(bandGeometry(shut, "cluster-1")).toEqual({ collapsed: true, maximized: true });
  });

  it("leaves the map alone when there is no cluster to key by", () => {
    const state = withBandGeometry({}, "cluster-1", { collapsed: false });
    expect(withBandGeometry(state, null, { maximized: true })).toBe(state);
  });

  it("never mutates the map it was given", () => {
    const before: BandGeometryByCluster = {};
    withBandGeometry(before, "cluster-1", { collapsed: false });
    expect(before).toEqual({});
  });
});
