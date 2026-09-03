/**
 * The Stack Schematic (PRD §12.9), against the real `saas-backend` fixture
 * (`../graph/stack.ts`) — the shared-node callout, the header counts, and
 * that the engine opens it through the exact same `openSchematic` path every
 * other tier uses.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import { sharedNodeCallout } from "./anatomy";
import { openSchematic } from "./index";
import { buildFrame } from "./frame";
import { buildDoc } from "./layout";
import { SERVICE_CONFIG, STACK_CONFIG } from "./presets";

async function stackFrame() {
  const seam = createMemorySeam();
  const graph = await seam.loadGraph("stack", "saas-backend");
  const doc = buildDoc(graph, null, STACK_CONFIG);
  return buildFrame({
    doc,
    config: STACK_CONFIG,
    viewport: { x: -4000, y: -4000, zoom: 1 },
    size: { width: 12000, height: 12000 },
    selection: new Set(),
  });
}

describe("the shared-node callout", () => {
  it("reproduces PRD §4.3's exact literal string for event-bus's 4 dependents", () => {
    expect(sharedNodeCallout("event-bus", 4)).toEqual({
      heading: "WHY EVENT-BUS SITS HERE",
      body: "Four consumers, so its containment parent is their lowest common ancestor — the stack root — not any one of them. Same rule at tier 2.",
    });
  });

  it("draws on the live Stack Schematic frame", async () => {
    const frame = await stackFrame();
    expect(frame.sharedNodeCallout).not.toBeNull();
    expect(frame.sharedNodeCallout?.body).toContain("Four consumers");
  });

  it("is null on the Service Schematic, whose own shared-node fixture is deliberately misplaced", async () => {
    const seam = createMemorySeam();
    // crypto-primitives carries `sharedAtLca` and the badge every shared node
    // draws, but it is the linter's own WARN example ("Shared node sits
    // above the LCA of its dependents") — not a correctly-at-LCA node — so
    // `buildSharedNodeCallout` is only ever reached on the Stack Schematic
    // (`buildFrame`'s own `config.tier === "stack"` gate), and this doc is
    // built under the service tier's config.
    const doc = buildDoc(await seam.loadGraph(), null, SERVICE_CONFIG);
    const frame = buildFrame({
      doc,
      config: SERVICE_CONFIG,
      viewport: { x: -4000, y: -4000, zoom: 1 },
      size: { width: 12000, height: 12000 },
      selection: new Set(),
    });
    expect(frame.sharedNodeCallout).toBeNull();
  });
});

describe("opening the Stack Schematic", () => {
  it("goes through the same openSchematic path every tier uses", async () => {
    const seam = createMemorySeam();
    const engine = await openSchematic(STACK_CONFIG, seam);
    expect(engine.config.tier).toBe("stack");
    expect(engine.state.doc.nodes.filter((node) => node.kind === "service")).toHaveLength(7);
  });
});
