/**
 * The two generated fixtures of PRD sections 16.2 and 16.3.
 *
 * Neither has any content worth reading. `dense-service` exists so wave 3 can
 * assert a 16 ms frame time against 200 modules at depth 5, and `stress-2000`
 * exists so wave 1 can assert a 1000 ms load against 2000 nodes and 3000
 * edges. What matters is the shape and the size, so both are built from a
 * seeded generator rather than authored.
 *
 * Every dependency edge runs from a later node to an earlier one, in mint
 * order. That keeps both graphs acyclic by construction, which matters because
 * wave 7 asserts the whole graph linter against `stress-2000`: a cycle that
 * arrived by accident would show up as a rule L02 error nobody put there.
 */

import { Fixture } from "./fixture.mjs";

/** Deterministic 32-bit noise, matched to the minter's own generator. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Add dependency edges between modules, always pointing backwards in mint
 * order so the result is acyclic.
 */
function wire(f, modules, count, seed) {
  const random = mulberry32(seed);
  const made = new Set();
  let attempts = 0;
  while (made.size < count && attempts < count * 40) {
    attempts += 1;
    const target = Math.floor(random() * (modules.length - 1));
    const source = target + 1 + Math.floor(random() * (modules.length - target - 1));
    const key = `${source}:${target}`;
    if (source === target || made.has(key)) {
      continue;
    }
    made.add(key);
    f.edge("depends_on", modules[source], modules[target]);
  }
  return made.size;
}

/**
 * One service, 200 modules, containment depth 5, 260 dependency edges.
 *
 * Depth is built by walking a cursor down five levels and back up, so the tree
 * is genuinely five deep rather than a wide fan with one long arm.
 */
export function buildDenseService() {
  const f = new Fixture("dense-service", 0xd_e_0002);

  f.brief = {
    product_name: "dense-service",
    problem: "A service large enough to measure a frame time against.",
    users: ["The wave 3 frame budget"],
    goals: ["200 modules at containment depth 5"],
    non_goals: ["Readable content"],
    constraints: [],
    success_metrics: [{ name: "frame_time", value: 16, unit: "ms" }],
  };

  const service = f.node("service", "dense-service", "Dense Service", {
    layer: "backend",
    fields: { entry_point: "Started by the supervisor.", exports: [], schemas: null },
  });

  const modules = [];
  const parents = [service];
  for (let i = 0; i < 200; i += 1) {
    const depth = 1 + (i % 4);
    const parent = parents[Math.min(depth - 1, parents.length - 1)];
    const module = f.node("module", `dense-module-${i + 1}`, `Dense module ${i + 1}`, {
      parent: parent.id,
      layer: "backend",
      description: `Module ${i + 1} of the dense fixture.`,
      fields: { allowed_libraries: [], ui_refs: [] },
    });
    modules.push(module);
    parents[depth] = module;
  }

  wire(f, modules, 260, 0xd_e_0002);
  return f.write();
}

/**
 * Twenty services, 2000 nodes in total, 3000 dependency edges.
 *
 * The 20 services and 1980 modules come to exactly 2000 nodes, which is the
 * number PRD section 16.3 names. Wave 1 asserts the load budget against this.
 */
export function buildStress2000() {
  const f = new Fixture("stress-2000", 0x57_2e_5503);

  f.brief = {
    product_name: "stress-2000",
    problem: "A graph large enough to measure a cold load against.",
    users: ["The wave 1 load budget", "The wave 7 lint budget", "The wave 8 search budget"],
    goals: ["2000 nodes and 3000 edges"],
    non_goals: ["Readable content"],
    constraints: [],
    success_metrics: [{ name: "graph_load", value: 1000, unit: "ms" }],
  };

  const services = [];
  for (let i = 0; i < 20; i += 1) {
    services.push(
      f.node("service", `stress-service-${i + 1}`, `Stress service ${i + 1}`, {
        layer: i % 2 === 0 ? "backend" : "data",
        fields: { entry_point: "Started by the supervisor.", exports: [], schemas: null },
      }),
    );
  }

  const modules = [];
  const perService = 1980 / 20;
  for (const [index, service] of services.entries()) {
    const parents = [service];
    for (let i = 0; i < perService; i += 1) {
      const depth = 1 + (i % 3);
      const parent = parents[Math.min(depth - 1, parents.length - 1)];
      const module = f.node(
        "module",
        `stress-module-${index + 1}-${i + 1}`,
        `Stress module ${index + 1}.${i + 1}`,
        {
          parent: parent.id,
          layer: service.layer,
          description: `Module ${i + 1} of stress service ${index + 1}.`,
          fields: { allowed_libraries: [], ui_refs: [] },
        },
      );
      modules.push(module);
      parents[depth] = module;
    }
  }

  wire(f, modules, 3000, 0x57_2e_5503);
  return f.write();
}
