/**
 * PRD §17 Wave 3's acceptance conditions, and the behaviour of §12.3 and
 * §12.4 underneath them. No browser is available to this wave, so these
 * assertions are the whole of the evidence — which is why the refusal strings
 * are compared literally rather than by `toContain`, and why the storage layer
 * a gesture wrote to is asserted on both sides: the engine's own record, and
 * the seam's contents.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import { MODULE_CONFIG, SERVICE_CONFIG, STACK_CONFIG } from "./presets";
import { openSchematic } from "./index";
import { COMMENT_REFUSAL, CYCLE_REFUSAL, GROUP_REFUSAL, DUPLICATE_REFUSAL } from "./rules";
import { isUuidV7 } from "./ids";
import { buildFrame } from "./frame";
import { buildDoc, toServiceGraph } from "./layout";
import { SchematicEngine } from "./engine";
import type { SchematicDoc } from "./doc";

async function open(config = SERVICE_CONFIG) {
  const seam = createMemorySeam();
  const engine = await openSchematic(config, seam);
  return { engine, seam };
}

describe("a node drag writes no semantic file", () => {
  it("writes the layout file and nothing else", async () => {
    const { engine, seam } = await open();
    engine.select(["token-issuer"]);
    engine.moveSelection(44, 22);
    await engine.settled();

    expect(engine.semanticWrites).toEqual([]);
    expect([...seam.semantic.keys()]).toEqual([]);
    expect([...seam.layouts.keys()]).toEqual(["auth-service"]);
  });

  it("stores the new position in layout/auth-service.json", async () => {
    const { engine, seam } = await open();
    const before = engine.index.byId.get("token-issuer")?.rect.x ?? 0;
    engine.select(["token-issuer"]);
    engine.moveSelection(44, 0);
    await engine.settled();

    const stored = seam.layouts.get("auth-service")?.nodes["token-issuer"];
    expect(stored?.x).toBe(before + 44);
  });

  it("keeps that position across a reopen, which is what persistence means", async () => {
    const { engine, seam } = await open();
    engine.select(["token-issuer"]);
    engine.moveSelection(44, 0);
    await engine.settled();
    const moved = engine.state.doc.nodes.find((node) => node.id === "token-issuer")?.rect.x;

    const reopened = await openSchematic(SERVICE_CONFIG, seam);
    const after = reopened.state.doc.nodes.find((node) => node.id === "token-issuer")?.rect.x;
    expect(after).toBe(moved);
  });

  it("drags a container's descendants with it", async () => {
    const { engine } = await open();
    const before = engine.index.byId.get("jwks-cache")?.rect.x ?? 0;
    engine.select(["token-verifier"]);
    engine.moveSelection(22, 0);
    expect(engine.index.byId.get("jwks-cache")?.rect.x).toBe(before + 22);
  });

  it("says the layout file is modified once a drag has written it", async () => {
    const { engine } = await open();
    expect(engine.layoutDirty).toBe(false);
    engine.select(["token-issuer"]);
    engine.moveSelection(22, 22);
    expect(engine.layoutDirty).toBe(true);
  });
});

describe("a semantic edge dropped on an annotation node is refused", () => {
  it("draws PRD §11.3's sentence, exactly", async () => {
    const { engine } = await open();
    const comment = engine.addComment(
      { x: 676, y: 400, width: 230, height: 100 },
      "m.ross",
      "Two caches here on purpose.",
    );
    const refusal = engine.createEdge({
      kind: "depends_on",
      from: "token-issuer",
      to: comment.id,
    });

    expect(refusal).toEqual({
      heading: "Drop refused",
      reason: "A comment is annotation tier. It cannot carry covers or any semantic edge.",
    });
    expect(refusal?.reason).toBe(COMMENT_REFUSAL);
  });

  it("refuses an edge that starts at a comment too", async () => {
    const { engine } = await open();
    const comment = engine.addComment({ x: 0, y: 0, width: 230, height: 100 }, "m.ross", "note");
    expect(engine.createEdge({ kind: "depends_on", from: comment.id, to: "token-issuer" })).toEqual(
      { heading: "Drop refused", reason: COMMENT_REFUSAL },
    );
  });

  it("refuses on a group with the group's own wording", async () => {
    const { engine } = await open();
    const group = engine.addGroup({ x: 0, y: 0, width: 452, height: 330 }, "Token pipeline");
    expect(
      engine.createEdge({ kind: "depends_on", from: "token-issuer", to: group.id })?.reason,
    ).toBe(GROUP_REFUSAL);
  });

  it("writes nothing at all when it refuses", async () => {
    const { engine, seam } = await open();
    const comment = engine.addComment({ x: 0, y: 0, width: 230, height: 100 }, "m.ross", "note");
    const edgesBefore = engine.state.doc.edges.length;
    engine.createEdge({ kind: "depends_on", from: "token-issuer", to: comment.id });
    await engine.settled();

    expect(engine.state.doc.edges.length).toBe(edgesBefore);
    expect([...seam.semantic.keys()]).toEqual([]);
  });
});

describe("a cycle edge is refused", () => {
  it("draws PRD §12.5's sentence, exactly", async () => {
    const { engine } = await open();
    const refusal = engine.createEdge({
      kind: "depends_on",
      from: "token-issuer",
      to: "http-entry",
    });
    expect(refusal).toEqual({
      heading: "Drop refused",
      reason: "A dependency edge here would create a cycle.",
    });
    expect(refusal?.reason).toBe(CYCLE_REFUSAL);
  });

  it("refuses a longer cycle, not only a direct one back", async () => {
    const { engine } = await open();
    // http-entry -> token-issuer -> crypto-primitives already exists.
    expect(
      engine.createEdge({ kind: "depends_on", from: "crypto-primitives", to: "http-entry" })
        ?.reason,
    ).toBe(CYCLE_REFUSAL);
  });

  it("accepts an edge that closes no cycle, and writes it as design data", async () => {
    const { engine, seam } = await open();
    expect(
      engine.createEdge({ kind: "depends_on", from: "clock-skew", to: "jwks-cache" }),
    ).toBeNull();
    await engine.settled();
    expect([...seam.semantic.keys()]).toHaveLength(1);
    expect([...seam.semantic.keys()][0]).toMatch(/^edges\//);
  });

  it("refuses a second identical edge", async () => {
    const { engine } = await open();
    expect(
      engine.createEdge({ kind: "depends_on", from: "clock-skew", to: "jwks-cache" }),
    ).toBeNull();
    expect(
      engine.createEdge({ kind: "depends_on", from: "clock-skew", to: "jwks-cache" })?.reason,
    ).toBe(DUPLICATE_REFUSAL);
  });

  it("refuses a kind the tier's vocabulary does not hold", async () => {
    const { engine } = await open();
    const refusal = engine.createEdge({ kind: "covers", from: "clock-skew", to: "jwks-cache" });
    expect(refusal?.reason).toBe("This Schematic does not draw a covers edge.");
  });
});

describe("a duplicate mints a new UUIDv7", () => {
  it("mints an identifier rather than copying one, and suffixes the slug", async () => {
    const { engine } = await open();
    engine.select(["clock-skew"]);
    const copies = engine.duplicateSelection();

    expect(copies).toHaveLength(1);
    expect(copies[0].id).not.toBe("clock-skew");
    expect(isUuidV7(copies[0].id)).toBe(true);
    expect(copies[0].slug).toBe("clock-skew-copy");
  });

  it("counts up when the suffixed slug is taken", async () => {
    const { engine } = await open();
    engine.select(["clock-skew"]);
    engine.duplicateSelection();
    engine.select(["clock-skew"]);
    const second = engine.duplicateSelection();
    expect(second[0].slug).toBe("clock-skew-copy-2");
  });

  it("writes the copy to the semantic layer, because a new node is design data", async () => {
    const { engine, seam } = await open();
    engine.select(["clock-skew"]);
    const copies = engine.duplicateSelection();
    await engine.settled();
    expect(seam.semantic.has(`nodes/${copies[0].id}.json`)).toBe(true);
  });

  it("duplicates a subtree with fresh identifiers throughout", async () => {
    const { engine } = await open();
    engine.select(["token-verifier"]);
    const copies = engine.duplicateSelection();
    expect(copies).toHaveLength(3);
    expect(new Set(copies.map((node) => node.id)).size).toBe(3);
    for (const copy of copies) expect(isUuidV7(copy.id)).toBe(true);
  });
});

describe("undo and redo", () => {
  it("puts a moved node back", async () => {
    const { engine } = await open();
    const before = engine.index.byId.get("token-issuer")?.rect.x ?? 0;
    engine.select(["token-issuer"]);
    engine.moveSelection(88, 0);
    engine.undo();
    expect(engine.index.byId.get("token-issuer")?.rect.x).toBe(before);
    engine.redo();
    expect(engine.index.byId.get("token-issuer")?.rect.x).toBe(before + 88);
  });

  it("removes the semantic file an undone edge created", async () => {
    const { engine, seam } = await open();
    engine.createEdge({ kind: "depends_on", from: "clock-skew", to: "jwks-cache" });
    await engine.settled();
    expect(seam.semantic.size).toBe(1);

    engine.undo();
    await engine.settled();
    expect(seam.semantic.size).toBe(0);
    expect(engine.state.doc.edges).toHaveLength(9);
  });

  it("clears the redo stack once a new change is committed", async () => {
    const { engine } = await open();
    engine.select(["token-issuer"]);
    engine.moveSelection(22, 0);
    engine.undo();
    expect(engine.canRedo).toBe(true);
    engine.moveSelection(0, 22);
    expect(engine.canRedo).toBe(false);
  });

  it("does nothing at the bottom of the stack rather than throwing", async () => {
    const { engine } = await open();
    expect(engine.canUndo).toBe(false);
    engine.undo();
    expect(engine.state.doc.nodes).toHaveLength(12);
  });
});

describe("selection", () => {
  it("box-selects every node the box wholly contains", async () => {
    const { engine } = await open();
    const bounds = engine.state.doc.nodes.reduce(
      (box, node) => ({
        x: Math.min(box.x, node.rect.x),
        y: Math.min(box.y, node.rect.y),
        width: 4000,
        height: 4000,
      }),
      { x: 0, y: 0, width: 4000, height: 4000 },
    );
    engine.boxSelect(bounds);
    // 10 of the 12: `session-store` opens collapsed in the fixture, so its 2
    // children are not on the Schematic to be selected.
    expect(engine.state.selection).toHaveLength(10);
  });

  it("leaves out a node the box only clips", async () => {
    const { engine } = await open();
    engine.boxSelect({ x: 0, y: 0, width: 1, height: 1 });
    expect(engine.state.selection).toEqual([]);
  });

  it("adds to the selection rather than replacing it when asked", async () => {
    const { engine } = await open();
    engine.select(["token-issuer"]);
    engine.select(["clock-skew"], true);
    expect(engine.state.selection).toEqual(["token-issuer", "clock-skew"]);
  });

  it("resolves a click to the innermost box under the point", async () => {
    const { engine } = await open();
    const child = engine.index.byId.get("jwks-cache");
    const hit = engine.hitTest({
      x: (child?.rect.x ?? 0) + 4,
      y: (child?.rect.y ?? 0) + 4,
    });
    expect(hit[0]?.id).toBe("jwks-cache");
  });
});

describe("copy and paste", () => {
  it("pastes a copy with new identifiers, offset from the original", async () => {
    const { engine } = await open();
    const original = engine.index.byId.get("clock-skew");
    engine.select(["clock-skew"]);
    engine.copy();
    const pasted = engine.paste();

    expect(pasted).toHaveLength(1);
    expect(isUuidV7(pasted[0].id)).toBe(true);
    expect(pasted[0].rect.x).toBe((original?.rect.x ?? 0) + SERVICE_CONFIG.grid.size * 2);
  });

  it("pastes nothing when nothing was copied", async () => {
    const { engine } = await open();
    expect(engine.paste()).toEqual([]);
  });

  it("remaps an edge that sits wholly inside the copied selection", async () => {
    const { engine } = await open();
    engine.createEdge({ kind: "depends_on", from: "clock-skew", to: "jwks-cache" });
    engine.select(["token-verifier"]);
    engine.copy();
    const before = engine.state.doc.edges.length;
    const pasted = engine.paste();
    const ids = new Set(pasted.map((node) => node.id));
    const added = engine.state.doc.edges.slice(before);

    expect(added).toHaveLength(1);
    expect(ids.has(added[0].from)).toBe(true);
    expect(ids.has(added[0].to)).toBe(true);
  });
});

describe("groups and comments", () => {
  it("writes a group to the cosmetic layer only", async () => {
    const { engine, seam } = await open();
    const group = engine.addGroup({ x: 222, y: 210, width: 452, height: 330 }, "Token pipeline");
    await engine.settled();

    expect([...seam.semantic.keys()]).toEqual([]);
    const stored = seam.layouts.get("auth-service")?.annotations ?? [];
    expect(stored.map((entry) => entry.id)).toContain(group.id);
    expect(stored[0].title).toBe("Token pipeline");
  });

  it("round-trips a comment's author and body through the layout file", async () => {
    const { engine, seam } = await open();
    engine.addComment(
      { x: 676, y: 400, width: 230, height: 100 },
      "m.ross",
      "Two caches here on purpose.",
    );
    await engine.settled();

    const reopened = await openSchematic(SERVICE_CONFIG, seam);
    const comment = reopened.state.doc.nodes.find((node) => node.kind === "comment");
    expect(comment?.author).toBe("m.ross");
    expect(comment?.body).toBe("Two caches here on purpose.");
  });

  it("nests a group inside another group", async () => {
    const { engine } = await open();
    const outer = engine.addGroup({ x: 0, y: 0, width: 452, height: 330 }, "Outer");
    const inner = engine.addGroup({ x: 20, y: 40, width: 200, height: 120 }, "Inner", outer.id);
    expect(engine.index.byId.get(inner.id)?.parentId).toBe(outer.id);
  });

  it("dismisses a comment, and refuses to dismiss a module the same way", async () => {
    const { engine } = await open();
    const comment = engine.addComment({ x: 0, y: 0, width: 230, height: 100 }, "m.ross", "note");
    expect(engine.removeAnnotation(comment.id)).toBeNull();
    expect(engine.index.byId.has(comment.id)).toBe(false);
    expect(engine.removeAnnotation("token-issuer")?.reason).toBe(
      "Only a comment or a group is dismissed this way.",
    );
  });
});

describe("containment collapse", () => {
  it("hides a collapsed box's children and counts them at draw time", async () => {
    const { engine } = await open();
    const frame = buildFrame({
      doc: engine.state.doc,
      config: SERVICE_CONFIG,
      viewport: { x: -2000, y: -2000, zoom: 0.2 },
      size: { width: 4000, height: 4000 },
      selection: new Set(),
      index: engine.index,
    });
    const store = frame.nodes.find((drawn) => drawn.node.id === "session-store");

    expect(store?.collapsedCaption).toBe("collapsed · 2 children");
    expect(frame.nodes.map((drawn) => drawn.node.id)).not.toContain("session-codec");
  });

  it("rolls edges up to the collapsed border and says how many", () => {
    const doc: SchematicDoc = {
      slug: "roll-up",
      title: "roll-up",
      nodes: [
        {
          id: "parent",
          slug: "parent",
          title: "Parent",
          kind: "module",
          parentId: null,
          rect: { x: 0, y: 0, width: 200, height: 120 },
          collapsed: true,
        },
        {
          id: "a",
          slug: "a",
          title: "A",
          kind: "module",
          parentId: "parent",
          rect: { x: 10, y: 10, width: 40, height: 20 },
          collapsed: false,
        },
        {
          id: "b",
          slug: "b",
          title: "B",
          kind: "module",
          parentId: "parent",
          rect: { x: 60, y: 10, width: 40, height: 20 },
          collapsed: false,
        },
        {
          id: "c",
          slug: "c",
          title: "C",
          kind: "module",
          parentId: "parent",
          rect: { x: 110, y: 10, width: 40, height: 20 },
          collapsed: false,
        },
        {
          id: "far",
          slug: "far",
          title: "Far",
          kind: "module",
          parentId: null,
          rect: { x: 500, y: 0, width: 200, height: 120 },
          collapsed: false,
        },
      ],
      edges: [
        { id: "e1", kind: "depends_on", from: "a", to: "far" },
        { id: "e2", kind: "depends_on", from: "b", to: "far" },
        { id: "e3", kind: "depends_on", from: "c", to: "far" },
      ],
    };
    const frame = buildFrame({
      doc,
      config: SERVICE_CONFIG,
      viewport: { x: -100, y: -100, zoom: 1 },
      size: { width: 2000, height: 2000 },
      selection: new Set(),
    });

    expect(frame.edges).toHaveLength(1);
    expect(frame.edges[0].aggregated).toBe(3);
    expect(frame.nodes.find((drawn) => drawn.node.id === "parent")?.rollUpCaption).toBe(
      "3 edges aggregated",
    );
  });

  it("draws no edge at all between two nodes inside the same collapsed box", () => {
    const doc: SchematicDoc = {
      slug: "internal",
      title: "internal",
      nodes: [
        {
          id: "parent",
          slug: "parent",
          title: "Parent",
          kind: "module",
          parentId: null,
          rect: { x: 0, y: 0, width: 200, height: 120 },
          collapsed: true,
        },
        {
          id: "a",
          slug: "a",
          title: "A",
          kind: "module",
          parentId: "parent",
          rect: { x: 10, y: 10, width: 40, height: 20 },
          collapsed: false,
        },
        {
          id: "b",
          slug: "b",
          title: "B",
          kind: "module",
          parentId: "parent",
          rect: { x: 60, y: 10, width: 40, height: 20 },
          collapsed: false,
        },
      ],
      edges: [{ id: "e1", kind: "depends_on", from: "a", to: "b" }],
    };
    const frame = buildFrame({
      doc,
      config: SERVICE_CONFIG,
      viewport: { x: -100, y: -100, zoom: 1 },
      size: { width: 2000, height: 2000 },
      selection: new Set(),
    });
    expect(frame.edges).toEqual([]);
  });

  it("gives every hidden node a position of its own, ready for the expand", async () => {
    const { engine } = await open();
    const codec = engine.index.byId.get("session-codec");
    const indexNode = engine.index.byId.get("session-index");
    expect(codec?.rect).not.toEqual(indexNode?.rect);
    expect(codec?.rect.width).toBeGreaterThan(0);
  });

  it("grows an expanded box around what it holds", async () => {
    const { engine } = await open();
    const before = engine.index.byId.get("session-store")?.rect;
    engine.toggleCollapse("session-store");
    const after = engine.index.byId.get("session-store")?.rect;
    expect(after?.width).toBeGreaterThan(before?.width ?? 0);
    for (const id of ["session-codec", "session-index"]) {
      const child = engine.index.byId.get(id);
      expect(child?.rect.x).toBeGreaterThanOrEqual(after?.x ?? 0);
      expect((child?.rect.x ?? 0) + (child?.rect.width ?? 0)).toBeLessThanOrEqual(
        (after?.x ?? 0) + (after?.width ?? 0),
      );
    }
  });

  it("collapses and expands as a cosmetic change", async () => {
    const { engine, seam } = await open();
    engine.toggleCollapse("token-verifier");
    await engine.settled();
    expect(engine.index.byId.get("token-verifier")?.collapsed).toBe(true);
    expect([...seam.semantic.keys()]).toEqual([]);
  });
});

describe("reparenting", () => {
  it("refuses a move that would put a node inside itself", async () => {
    const { engine } = await open();
    const refusal = engine.reparent("token-verifier", "jwks-cache");
    expect(refusal?.reason).toBe("A containment change here would create a cycle.");
    expect(engine.index.byId.get("token-verifier")?.parentId).toBeNull();
  });

  it("writes the node file, because parentage is meaning and a position is not", async () => {
    const { engine, seam } = await open();
    expect(engine.reparent("clock-skew", "token-issuer")).toBeNull();
    await engine.settled();

    expect(engine.index.byId.get("clock-skew")?.parentId).toBe("token-issuer");
    expect([...seam.semantic.keys()]).toEqual(["nodes/clock-skew.json"]);
    // The payload is what the backend will store, so it is asserted rather
    // than the fact of a write. The memory seam's loader still answers with
    // the fixture, so a reopen cannot show this yet — the written parent is.
    expect(seam.semantic.get("nodes/clock-skew.json")).toMatchObject({
      id: "clock-skew",
      parent: "token-issuer",
    });
  });

  it("restores the old parent on undo, and leaves the file where it was", async () => {
    const { engine, seam } = await open();
    // The seam is seeded with the node as a real project would already hold
    // it. Without this the file is absent before the step, and an undo that
    // deleted it would look correct: the assertion has to start from a file
    // that exists.
    const original = {
      id: "clock-skew",
      slug: "clock-skew",
      title: "Clock Skew",
      kind: "module",
      parent: "token-verifier",
    };
    seam.semantic.set("nodes/clock-skew.json", original);

    engine.reparent("clock-skew", "token-issuer");
    await engine.settled();
    expect(seam.semantic.get("nodes/clock-skew.json")).toMatchObject({
      parent: "token-issuer",
    });

    engine.undo();
    await engine.settled();
    expect(engine.index.byId.get("clock-skew")?.parentId).toBe("token-verifier");
    // Present, not deleted: a reparent edits a file it did not create, so its
    // inverse is a rewrite carrying the old parent.
    expect(seam.semantic.has("nodes/clock-skew.json")).toBe(true);
    expect(seam.semantic.get("nodes/clock-skew.json")).toMatchObject(original);
  });

  it("puts the new parent back on redo", async () => {
    const { engine, seam } = await open();
    seam.semantic.set("nodes/clock-skew.json", { id: "clock-skew", parent: "token-verifier" });
    engine.reparent("clock-skew", "token-issuer");
    engine.undo();
    engine.redo();
    await engine.settled();
    expect(engine.index.byId.get("clock-skew")?.parentId).toBe("token-issuer");
    expect(seam.semantic.get("nodes/clock-skew.json")).toMatchObject({
      parent: "token-issuer",
    });
  });

  it("still removes a file the step did create, on undo", async () => {
    const { engine, seam } = await open();
    engine.createEdge({ kind: "depends_on", from: "clock-skew", to: "jwks-cache" });
    await engine.settled();
    expect(seam.semantic.size).toBe(1);
    engine.undo();
    await engine.settled();
    expect(seam.semantic.size).toBe(0);
  });
});

describe("the node policy", () => {
  it("leaves a pinned node where it is when a drag moves the selection", async () => {
    const { engine } = await open();
    // `http-entry` carries the `ENTRY` badge, so it is this tier's entry point,
    // and PRD §12.10 pins it to the Schematic edge.
    expect(engine.isPinned("http-entry")).toBe(true);
    const before = engine.index.byId.get("http-entry")?.rect;
    engine.select(["http-entry"]);
    engine.moveSelection(220, 220);
    expect(engine.index.byId.get("http-entry")?.rect).toEqual(before);
  });

  it("moves the rest of a selection that also holds a pinned node", async () => {
    const { engine } = await open();
    const pinned = engine.index.byId.get("http-entry")?.rect;
    const free = engine.index.byId.get("token-issuer")?.rect.x ?? 0;
    engine.select(["http-entry", "token-issuer"]);
    engine.moveSelection(220, 0);
    expect(engine.index.byId.get("http-entry")?.rect).toEqual(pinned);
    expect(engine.index.byId.get("token-issuer")?.rect.x).toBe(free + 220);
  });

  it("refuses to delete a node whose role the tier marks undeletable", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const engine = new SchematicEngine(MODULE_CONFIG, buildDoc(graph, null, MODULE_CONFIG), seam);
    const root = engine.state.doc.nodes.find((node) => node.role === "schematic-root");
    expect(root?.slug).toBe("token-verifier");
    expect(engine.canDelete(root?.id ?? "")?.reason).toBe("Token Verifier cannot be deleted.");
  });

  it("refuses to delete anything else too, because nothing is ever deleted", async () => {
    const { engine } = await open();
    expect(engine.canDelete("token-issuer")?.reason).toBe(
      "Nothing is ever deleted. A node is superseded, not removed.",
    );
  });

  it("pins the module root rather than the entry point at tier 3", () => {
    expect(MODULE_CONFIG.nodePolicy.pinned.roles).toEqual(["schematic-root"]);
    expect(MODULE_CONFIG.nodePolicy.undeletable).toEqual(["schematic-root"]);
    expect(SERVICE_CONFIG.nodePolicy.pinned.roles).toEqual(["entry-point"]);
    expect(SERVICE_CONFIG.nodePolicy.undeletable).toEqual([]);
  });
});

describe("the live model behind the shell", () => {
  it("drops annotations, so a comment is not a node", async () => {
    const { engine } = await open();
    engine.addComment({ x: 0, y: 0, width: 230, height: 100 }, "m.ross", "note");
    expect(toServiceGraph(engine.state.doc).nodes).toHaveLength(12);
  });

  it("moves when the document moves, which is what the Outline reads", async () => {
    const { engine } = await open();
    expect(toServiceGraph(engine.state.doc).nodes).toHaveLength(12);
    engine.select(["clock-skew"]);
    engine.duplicateSelection();
    expect(toServiceGraph(engine.state.doc).nodes).toHaveLength(13);
  });

  it("keeps the badges and the slug line the Outline draws", async () => {
    const { engine } = await open();
    const graph = toServiceGraph(engine.state.doc);
    expect(graph.serviceSlug).toBe("auth-service");
    expect(graph.serviceTitle).toBe("Auth Service");
    expect(graph.nodes.find((node) => node.id === "http-entry")?.badge).toBe("ENTRY");
    expect(graph.nodes.find((node) => node.id === "audit-emitter")?.badge).toBe("STALE");
  });
});

describe("the arrangement strategy", () => {
  it("fans a contract sheet off a root that holds the left edge", async () => {
    const seam = createMemorySeam();
    const doc = buildDoc(await seam.loadGraph(), null, MODULE_CONFIG);
    const root = doc.nodes.find((node) => node.role === "schematic-root");
    const others = doc.nodes.filter((node) => node.id !== root?.id);

    expect(MODULE_CONFIG.arrangement).toBe("contract-sheet");
    for (const node of others) {
      expect(node.rect.x).toBeGreaterThan(root?.rect.x ?? 0);
    }
    expect(new Set(others.map((node) => node.rect.x)).size).toBe(1);
  });

  it("nests a containment tier instead", async () => {
    const seam = createMemorySeam();
    const doc = buildDoc(await seam.loadGraph(), null, SERVICE_CONFIG);
    const parent = doc.nodes.find((node) => node.id === "token-verifier");
    const child = doc.nodes.find((node) => node.id === "jwks-cache");
    expect(SERVICE_CONFIG.arrangement).toBe("nested-flow");
    expect(child?.rect.y).toBeGreaterThan(parent?.rect.y ?? 0);
  });
});

describe("one engine, three configurations", () => {
  it("opens on every tier without a branch inside the engine", async () => {
    for (const config of [STACK_CONFIG, SERVICE_CONFIG, MODULE_CONFIG]) {
      const seam = createMemorySeam();
      const graph = await seam.loadGraph();
      const engine = new SchematicEngine(config, buildDoc(graph, null, config), seam);
      expect(engine.state.doc.nodes.length).toBe(12);
      expect(engine.config.tier).toBe(config.tier);
    }
  });

  it("gives each tier its own closed edge vocabulary, per PRD §11.1", () => {
    expect(SERVICE_CONFIG.edgeKinds.map((rule) => rule.kind)).toEqual([
      "depends_on",
      "implements",
      "references_ui",
    ]);
    expect(MODULE_CONFIG.edgeKinds.map((rule) => rule.kind)).toEqual([
      "covers",
      "satisfies",
      "documents",
    ]);
  });

  it("auto-sorts on demand, as one undoable step", async () => {
    const { engine } = await open();
    const before = engine.index.byId.get("audit-emitter")?.rect;
    engine.select(["audit-emitter"]);
    engine.moveSelection(220, 220);
    engine.autoSort();
    expect(engine.index.byId.get("audit-emitter")?.rect).toEqual(before);
    engine.undo();
    expect(engine.index.byId.get("audit-emitter")?.rect.x).toBe((before?.x ?? 0) + 220);
  });
});
