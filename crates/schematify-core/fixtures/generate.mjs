/**
 * Writes the three Schematify reference fixtures of PRD section 16.
 *
 * Run it with `node crates/schematify-core/fixtures/generate.mjs`. Every file
 * is regenerated from scratch and the output is byte-identical run to run, so
 * a rebuild produces an empty diff and a real change produces a readable one.
 *
 * `saas-backend` is authored node for node in `saas-backend.mjs`, because its
 * content is the wireframe's content and a generator cannot invent
 * `Two caches here on purpose`. The dense and stress fixtures are generated in
 * `generated.mjs`, because 200 and 2000 nodes of hand-written JSON would be
 * unreviewable and their content does not matter, only their size.
 *
 * Where a count drawn on a wireframe disagrees with what these fixtures
 * compute, the fixture wins. PRD section 0.4 makes every count a draw-time
 * computation over the graph, so a number typed into a drawing is a drawing.
 * The wave 1b handoff lists each conflict.
 */

import { buildDenseService, buildStress2000 } from "./generated.mjs";
import { buildSaasBackend } from "./saas-backend.mjs";

const built = [
  ["saas-backend", buildSaasBackend()],
  ["dense-service", buildDenseService()],
  ["stress-2000", buildStress2000()],
];

for (const [name, counts] of built) {
  process.stdout.write(
    `${name}: ${counts.nodes} nodes, ${counts.edges} edges, ${counts.files} files\n`,
  );
}
