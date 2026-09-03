/**
 * Every refusal, in one module. PRD §12.5: "Schematify shall never accept an
 * invalid edge and flag it later" — so this is asked while the pointer is
 * still down, and its answer is drawn at the cursor under the heading
 * `Drop refused`.
 *
 * Two strings below are quoted from a source and must not be reworded:
 * §11.3's annotation refusal and §12.5's cycle refusal. The rest are this
 * engine's own [P] wording, and each is carried on the edge rule it belongs
 * to (`presets.ts`) rather than written here, so a new tier writes its own.
 */
import type { EdgeKind, EdgeKindRule, Refusal, SchematicConfig } from "./config";
import { refuse } from "./config";
import type { DocIndex, SchematicDoc, SchematicNode } from "./doc";
import { isAnnotation, isAtOrAbove } from "./doc";

/** A port-to-port drag in progress: the kind being drawn and its two ends. */
export interface EdgeDraft {
  kind: EdgeKind;
  from: string;
  to: string;
}

/**
 * PRD §11.3, quoted exactly. The wireframe draws this text for a comment
 * (WIREFRAME-EXTRACT.md §1.1's drop-refused toast). A group is the other half
 * of the same annotation tier and no source draws its wording, so the sentence
 * is reused with the kind named — a `[P]` choice, recorded in the handoff.
 */
export const COMMENT_REFUSAL =
  "A comment is annotation tier. It cannot carry covers or any semantic edge.";
export const GROUP_REFUSAL =
  "A group is annotation tier. It cannot carry covers or any semantic edge.";

/** PRD §12.5, quoted exactly. Marked `[P]` there — no wireframe draws a cycle
 *  refusal — but the string itself is the PRD's, not this engine's. */
export const CYCLE_REFUSAL = "A dependency edge here would create a cycle.";

/** PRD §12.5 requires refusing an edge that creates a containment cycle but
 *  supplies no wording. `[P]`, parallel to the dependency sentence above. */
export const CONTAINMENT_CYCLE_REFUSAL = "A containment change here would create a cycle.";

/** `[P]`. Not a rule any source states; refused because the second edge would
 *  be indistinguishable from the first and would double every count. */
export const DUPLICATE_REFUSAL = "That edge already exists.";

/** `[P]`. A self-edge is refused for every kind, not only the acyclic ones. */
export const SELF_REFUSAL = "An edge needs two different nodes.";

/** The refusal for dropping a semantic edge on an annotation node. */
export function annotationRefusal(node: SchematicNode): string {
  return node.kind === "group" ? GROUP_REFUSAL : COMMENT_REFUSAL;
}

/** The rule for a kind on this tier, or `undefined` when the tier's closed
 *  vocabulary (PRD §11.1) does not hold it at all. */
export function ruleFor(config: SchematicConfig, kind: EdgeKind): EdgeKindRule | undefined {
  return config.edgeKinds.find((rule) => rule.kind === kind);
}

function accepts(list: readonly string[], kind: string): boolean {
  return list.includes("*") || list.includes(kind);
}

/**
 * The whole drag-time check. Returns `null` when the edge may be created, and
 * the refusal to draw at the cursor otherwise.
 *
 * Order is deliberate: the annotation tier answers first, so dropping any
 * semantic edge on a comment draws §11.3's sentence rather than a kind-table
 * message that happens to also be true.
 */
export function validateEdge(
  doc: SchematicDoc,
  index: DocIndex,
  config: SchematicConfig,
  draft: EdgeDraft,
): Refusal | null {
  const from = index.byId.get(draft.from);
  const to = index.byId.get(draft.to);
  if (!from || !to) return refuse("That edge has no second end.");

  if (isAnnotation(from)) return refuse(annotationRefusal(from));
  if (isAnnotation(to)) return refuse(annotationRefusal(to));

  const rule = ruleFor(config, draft.kind);
  if (!rule) return refuse(`This Schematic does not draw a ${draft.kind} edge.`);

  if (!accepts(rule.from, from.kind) || !accepts(rule.to, to.kind)) return refuse(rule.refusal);
  if (draft.from === draft.to) return refuse(SELF_REFUSAL);

  const duplicate = doc.edges.some(
    (edge) => edge.kind === draft.kind && edge.from === draft.from && edge.to === draft.to,
  );
  if (duplicate) return refuse(DUPLICATE_REFUSAL);

  if (rule.acyclic && wouldCycle(doc, config, draft)) return refuse(CYCLE_REFUSAL);

  return null;
}

/**
 * True when `to` already reaches `from`, so adding the edge closes a loop.
 *
 * The walk spans every acyclic kind on the tier at once rather than one kind
 * at a time: `depends_on` and `implements` are both dependency-family
 * relations, and a loop that alternates between them is still the cycle
 * PRD §12.5 refuses and the linter reports.
 */
export function wouldCycle(doc: SchematicDoc, config: SchematicConfig, draft: EdgeDraft): boolean {
  if (draft.from === draft.to) return true;
  const acyclicKinds = new Set(
    config.edgeKinds.filter((rule) => rule.acyclic).map((rule) => rule.kind),
  );
  const out = new Map<string, string[]>();
  for (const edge of doc.edges) {
    if (!acyclicKinds.has(edge.kind)) continue;
    const bucket = out.get(edge.from);
    if (bucket) bucket.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }

  const seen = new Set<string>([draft.to]);
  const queue = [draft.to];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (current === draft.from) return true;
    for (const next of out.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * The containment half of PRD §12.5. A node dropped into a container it is
 * already at or above would contain itself, so the move is refused rather than
 * silently reparented.
 */
export function validateReparent(
  index: DocIndex,
  nodeId: string,
  parentId: string | null,
): Refusal | null {
  if (parentId === null) return null;
  if (!index.byId.has(parentId)) return refuse("That container is not on this Schematic.");
  if (isAtOrAbove(index, nodeId, parentId)) return refuse(CONTAINMENT_CYCLE_REFUSAL);
  return null;
}
