/**
 * The engine itself: one open Schematic, its selection, its viewport, its undo
 * history, and the writes each gesture makes.
 *
 * The division of labour that matters is which layer a gesture writes to.
 * Arranging the picture — moving, collapsing, grouping, commenting, auto-sort
 * — calls `seam.writeLayout` and nothing else, which is PRD §17 Wave 3's
 * sharpest acceptance condition: a node drag writes no semantic file. Changing
 * the design — creating an edge, duplicating a node — reaches the semantic
 * layer as well. No other code path in this app writes anything.
 *
 * State is immutable and replaced wholesale. React subscribes; a test reads
 * `state` directly and awaits `settled()`.
 */
import type { SchematifySeam } from "../graph";
import type { Refusal, SchematicConfig, SchematicNodeKind } from "./config";
import { refuse } from "./config";
import type { DocIndex, SchematicDoc, SchematicEdge, SchematicNode } from "./doc";
import { descendantsOf, indexDoc, isAnnotation, siblingSlugs, visibleNodes } from "./doc";
import { autoSorted, boxAroundChildren } from "./arrange";
import type { Point, Rect } from "./geometry";
import { boundsOf, rectContains, rectsOverlap, snap } from "./geometry";
import { duplicateSlug, uuidv7 } from "./ids";
import { toLayoutFile } from "./layout";
import type { EdgeDraft } from "./rules";
import { validateEdge, validateReparent } from "./rules";
import type { Viewport, ViewportSize } from "./viewport";
import { fitTo, initialViewport, panBy, zoomAt } from "./viewport";

export interface EngineState {
  doc: SchematicDoc;
  selection: readonly string[];
  viewport: Viewport;
}

/** Which of PRD §6.1's two layers a write landed in. Recorded rather than
 *  inferred, because the layer split is the acceptance condition. */
export type WriteLayer = "layout" | "semantic";

/**
 * What one step did to one semantic file. Both sides are held, so an undo puts
 * back what was there rather than guessing: `before: null` is a creation,
 * `after: null` is a removal, and 2 payloads is an edit. A reparent is the
 * third kind — the file existed before the step and exists after it — and
 * recording it as a creation would make undo delete a file it never made.
 */
export interface SemanticEffect {
  path: string;
  before: unknown | null;
  after: unknown | null;
}

/** What one undoable step changed. `doc` is the document to restore. */
interface HistoryStep {
  doc: SchematicDoc;
  effects: readonly SemanticEffect[];
}

/** A clipboard payload. Held in the engine rather than the platform clipboard:
 *  a Schematic selection is a subgraph, not text, and PRD §12.3 scopes undo
 *  and the clipboard to one Schematic. */
export interface Clipboard {
  nodes: readonly SchematicNode[];
  edges: readonly SchematicEdge[];
}

/** How far a paste lands from its original, in grid steps, so a copy is
 *  visible rather than exactly on top of what it came from. */
const PASTE_OFFSET = 2;

export class SchematicEngine {
  readonly config: SchematicConfig;

  /** Every write this engine has made, newest last. */
  readonly writes: { layer: WriteLayer; path: string }[] = [];

  private current: EngineState;
  private cachedIndex: DocIndex;
  private readonly seam: SchematifySeam;
  private readonly listeners = new Set<() => void>();
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private clipboard: Clipboard | null = null;
  private pending: Promise<void> = Promise.resolve();
  private size: ViewportSize = { width: 1320, height: 700 };

  constructor(config: SchematicConfig, doc: SchematicDoc, seam: SchematifySeam) {
    this.config = config;
    this.seam = seam;
    this.current = { doc, selection: [], viewport: initialViewport(config.zoom) };
    this.cachedIndex = indexDoc(doc);
  }

  get state(): EngineState {
    return this.current;
  }

  get index(): DocIndex {
    return this.cachedIndex;
  }

  /** True once the layout file has been written, which is what status bar
   *  cell 2 reports as `modified` rather than `clean` (PRD §12.1). */
  get layoutDirty(): boolean {
    return this.writes.some((write) => write.layer === "layout");
  }

  /** Every semantic path this engine has written or removed. Empty after any
   *  number of drags, collapses, groups and comments. */
  get semanticWrites(): string[] {
    return this.writes.filter((write) => write.layer === "semantic").map((write) => write.path);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once every write started so far has finished. */
  settled(): Promise<void> {
    return this.pending;
  }

  // --- viewport ------------------------------------------------------------

  /** The drawn size of the Schematic in screen pixels. `Fit` and culling need
   *  it; nothing else does. */
  setSize(size: ViewportSize): void {
    this.size = size;
  }

  get viewportSize(): ViewportSize {
    return this.size;
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.replace({ ...this.current, viewport: panBy(this.current.viewport, dxScreen, dyScreen) });
  }

  zoom(factor: number, anchorScreen: Point): void {
    this.replace({
      ...this.current,
      viewport: zoomAt(this.current.viewport, factor, anchorScreen, this.config.zoom),
    });
  }

  /** `Fit`: the whole Schematic, or the selection when there is one — PRD
   *  §12.3's zoom-to-fit and zoom-to-choice, which differ only in what they
   *  are given. */
  fit(): void {
    const nodes = visibleNodes(this.current.doc, this.cachedIndex);
    const chosen =
      this.current.selection.length > 0
        ? nodes.filter((node) => this.current.selection.includes(node.id))
        : nodes;
    const bounds = boundsOf(chosen.map((node) => node.rect));
    this.replace({
      ...this.current,
      viewport: fitTo(this.current.viewport, bounds, this.size, this.config.zoom),
    });
  }

  // --- selection -----------------------------------------------------------

  select(ids: readonly string[], additive = false): void {
    const next = additive ? unique([...this.current.selection, ...ids]) : unique(ids);
    this.replace({ ...this.current, selection: next });
  }

  clearSelection(): void {
    this.replace({ ...this.current, selection: [] });
  }

  /** Box-select: every visible node the box wholly contains. Wholly rather
   *  than partly, so dragging across a container does not sweep up the parent
   *  along with the child the user meant. */
  boxSelect(worldRect: Rect, additive = false): void {
    const hits = visibleNodes(this.current.doc, this.cachedIndex)
      .filter((node) => rectContains(worldRect, node.rect))
      .map((node) => node.id);
    this.select(hits, additive);
  }

  /** Every visible node under a point, smallest first — the order a click
   *  resolves through, so the innermost box wins. */
  hitTest(worldPoint: Point): SchematicNode[] {
    const box = { x: worldPoint.x, y: worldPoint.y, width: 0.01, height: 0.01 };
    return visibleNodes(this.current.doc, this.cachedIndex)
      .filter((node) => rectsOverlap(node.rect, box))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  }

  // --- arrangement: cosmetic writes only -----------------------------------

  /**
   * Moves the selection by a world-space delta, dragging every descendant
   * along so a container and its contents stay together. Writes the layout
   * file and nothing else — PRD §17 Wave 3's first acceptance condition.
   */
  moveSelection(dx: number, dy: number): void {
    if (this.current.selection.length === 0) return;
    const moving = new Set<string>();
    for (const id of this.current.selection) {
      if (this.isPinned(id)) continue;
      moving.add(id);
      for (const node of descendantsOf(this.cachedIndex, id)) moving.add(node.id);
    }
    if (moving.size === 0) return;
    const grid = this.config.grid;
    this.commit(
      this.mapNodes((node) => {
        if (!moving.has(node.id)) return node;
        const x = node.rect.x + dx;
        const y = node.rect.y + dy;
        return {
          ...node,
          rect: {
            ...node.rect,
            x: grid.snap ? snap(x, grid.size) : x,
            y: grid.snap ? snap(y, grid.size) : y,
          },
        };
      }),
    );
  }

  /**
   * Collapses or expands a box (PRD §12.3). Collapse state is cosmetic, and so
   * is the resize that comes with it: collapsing shrinks the box to the size a
   * node of its kind draws at, and expanding grows it back around whatever its
   * children have since become, so an expanded container never draws smaller
   * than what it holds.
   */
  toggleCollapse(id: string): void {
    const target = this.cachedIndex.byId.get(id);
    if (!target) return;
    const collapsed = !target.collapsed;
    const box = collapsed
      ? { ...target.rect, ...this.config.nodeBox(target.kind) }
      : (boxAroundChildren(this.cachedIndex, this.config, target) ?? target.rect);
    this.commit(
      this.mapNodes((node) => (node.id === id ? { ...node, collapsed, rect: box } : node)),
    );
  }

  /**
   * Reparents a node into a container, refusing a containment cycle
   * (PRD §12.5). **This is a semantic write, not an arrangement.** Position is
   * cosmetic and parentage is not: containment is one of the 2 relations
   * (PRD §4.1), it lives in the node file rather than the layout file, and a
   * reparent that only moved memory would be discarded on the next open.
   */
  reparent(id: string, parentId: string | null): Refusal | null {
    const refusal = validateReparent(this.cachedIndex, id, parentId);
    if (refusal) return refusal;
    const before = this.cachedIndex.byId.get(id);
    if (!before) return refuse("That node is not on this Schematic.");
    const after = { ...before, parentId };
    this.commit(
      this.mapNodes((node) => (node.id === id ? after : node)),
      isAnnotation(after) ? [] : [edited(nodePath(after), nodeJson(before), nodeJson(after))],
    );
    return null;
  }

  /** True when this tier's policy pins the node, so a drag leaves it where it
   *  is (PRD §12.10, §12.11). */
  isPinned(id: string): boolean {
    const role = this.cachedIndex.byId.get(id)?.role;
    return role !== undefined && this.config.nodePolicy.pinned.roles.includes(role);
  }

  /**
   * The refusal to draw on a delete affordance, or `null` when the policy
   * allows one. There is no `deleteNode` on this engine at all: PRD §6.6 says
   * nothing is ever deleted, and a node with an inbound edge is superseded
   * rather than removed. This method exists so a tier that draws
   * `MODULE ROOT · CANNOT BE DELETED` (PRD §12.11) reads its own configuration
   * for the answer rather than hard-coding the sentence.
   */
  canDelete(id: string): Refusal | null {
    const node = this.cachedIndex.byId.get(id);
    if (!node) return refuse("That node is not on this Schematic.");
    if (isAnnotation(node)) return null;
    const role = node.role;
    if (role !== undefined && this.config.nodePolicy.undeletable.includes(role)) {
      return refuse(`${node.title} cannot be deleted.`);
    }
    return refuse("Nothing is ever deleted. A node is superseded, not removed.");
  }

  /** `Auto-sort` (PRD §12.1, §12.3): rearranges everything, in one undoable
   *  step, on demand and never on load. */
  autoSort(): void {
    this.commit(autoSorted(this.current.doc, this.config));
  }

  // --- the Inspector: semantic writes, layout untouched (PRD §17 Wave 6) ---

  /**
   * Patches one node's content fields and writes exactly the 1 semantic file
   * that changed — PRD §17 Wave 6's own acceptance condition: "The Inspector
   * edits a node and writes 1 file. One, not two." Every other mutating
   * method on this engine goes through `commit`, which also rewrites the
   * layout file on every step (`applyDoc`'s own comment: "every committed
   * change writes the layout file"); an Inspector field edit changes no
   * geometry, so it calls `commitSemanticOnly` instead and skips that write
   * entirely, rather than making a cosmetically-identical layout write just
   * to stay uniform with the drag/reparent/duplicate gestures above.
   *
   * Refuses on an annotation node (a comment or a group has no Inspector
   * panel at all — PRD §11.3 keeps it out of reconciliation) and on an id
   * this Schematic does not hold.
   */
  editNode(id: string, patch: Partial<SchematicNode>): Refusal | null {
    const before = this.cachedIndex.byId.get(id);
    if (!before) return refuse("That node is not on this Schematic.");
    if (isAnnotation(before)) return refuse("An annotation node has no Inspector panel.");
    const after: SchematicNode = { ...before, ...patch };
    this.commitSemanticOnly(
      { ...this.current.doc, nodes: this.current.doc.nodes.map((n) => (n.id === id ? after : n)) },
      [edited(nodePath(after), inspectorNodeJson(before), inspectorNodeJson(after))],
    );
    return null;
  }

  /**
   * Mints a new facet under `parentId` (the Contract tab's `+ add method`,
   * PRD §12.12) and writes its 1 new semantic file. The facet draws wherever
   * `arrange.ts` next places an unpositioned node of its kind — no layout
   * write happens here either, for the same reason `editNode` skips one.
   */
  addFacet(
    parentId: string,
    kind: SchematicNodeKind,
    fields: Partial<SchematicNode>,
  ): Refusal | null {
    const parent = this.cachedIndex.byId.get(parentId);
    if (!parent) return refuse("That node is not on this Schematic.");
    const id = uuidv7();
    const node: SchematicNode = {
      id,
      slug: `${kind}-${id.slice(0, 8)}`,
      title: "",
      kind,
      parentId,
      rect: { x: 0, y: 0, ...this.config.nodeBox(kind) },
      collapsed: false,
      ...fields,
    };
    this.commitSemanticOnly({ ...this.current.doc, nodes: [...this.current.doc.nodes, node] }, [
      addedFile(nodePath(node), inspectorNodeJson(node)),
    ]);
    return null;
  }

  /**
   * Drops one facet (the Budgets tab's `Drop budget`, PRD §12.12) and writes
   * the 1 file its removal is. PRD §6.6 forbids deleting design data in
   * general; a budget that never had a probe never entered reconciliation
   * (PRD §17 Wave 6's own 3rd bullet — "no probe" is a lint error, not a
   * measured claim), so dropping it is the declared exception rather than a
   * 2nd delete path alongside the one `canDelete` refuses everywhere else.
   */
  dropFacet(id: string): Refusal | null {
    const node = this.cachedIndex.byId.get(id);
    if (!node) return refuse("That node is not on this Schematic.");
    this.commitSemanticOnly(
      { ...this.current.doc, nodes: this.current.doc.nodes.filter((n) => n.id !== id) },
      [droppedFile(nodePath(node), inspectorNodeJson(node))],
    );
    return null;
  }

  // --- the annotation tier: cosmetic writes only ---------------------------

  /** A titled box with its own collapse triangle (PRD §12.4). */
  addGroup(rect: Rect, title: string, parentId: string | null = null): SchematicNode {
    return this.addAnnotation("group", rect, { title, parentId });
  }

  /** A comment box, anchored to a node by `parentId` or floating free
   *  (PRD §12.4). */
  addComment(
    rect: Rect,
    author: string,
    body: string,
    parentId: string | null = null,
  ): SchematicNode {
    return this.addAnnotation("comment", rect, {
      title: body.slice(0, 40),
      parentId,
      author,
      body,
    });
  }

  private addAnnotation(
    kind: "group" | "comment",
    rect: Rect,
    extra: { title: string; parentId: string | null; author?: string; body?: string },
  ): SchematicNode {
    const id = uuidv7();
    const node: SchematicNode = {
      id,
      slug: `${kind}-${id.slice(0, 8)}`,
      kind,
      rect,
      collapsed: false,
      ...extra,
    };
    this.commit({ ...this.current.doc, nodes: [...this.current.doc.nodes, node] });
    return node;
  }

  /** Removes a group or a comment. Refuses on a semantic node: deleting design
   *  data is PRD §6.6's business, and no gesture in this wave performs it. */
  removeAnnotation(id: string): Refusal | null {
    const node = this.cachedIndex.byId.get(id);
    if (!node) return refuse("That box is not on this Schematic.");
    if (!isAnnotation(node)) return refuse("Only a comment or a group is dismissed this way.");
    const doomed = new Set([id, ...descendantsOf(this.cachedIndex, id).map((kid) => kid.id)]);
    this.commit({
      ...this.current.doc,
      nodes: this.current.doc.nodes.filter((candidate) => !doomed.has(candidate.id)),
    });
    return null;
  }

  // --- design changes: semantic writes -------------------------------------

  /**
   * Port-to-port edge creation (PRD §12.5). Returns the refusal to draw at the
   * cursor, or `null` having created the edge. The check runs before anything
   * is written, so an invalid edge is never accepted and flagged later.
   */
  createEdge(draft: EdgeDraft): Refusal | null {
    const refusal = validateEdge(this.current.doc, this.cachedIndex, this.config, draft);
    if (refusal) return refusal;
    const edge: SchematicEdge = { id: uuidv7(), ...draft };
    this.commit({ ...this.current.doc, edges: [...this.current.doc.edges, edge] }, [
      addedFile(edgePath(edge), edgeJson(edge)),
    ]);
    return null;
  }

  deleteEdge(id: string): void {
    const edge = this.current.doc.edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    this.commit(
      { ...this.current.doc, edges: this.current.doc.edges.filter((other) => other.id !== id) },
      [droppedFile(edgePath(edge), edgeJson(edge))],
    );
  }

  copy(): void {
    const chosen = this.selectionWithDescendants();
    if (chosen.length === 0) return;
    const ids = new Set(chosen.map((node) => node.id));
    this.clipboard = {
      nodes: chosen.map((node) => ({ ...node })),
      edges: this.current.doc.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    };
  }

  /** Pastes the clipboard, minting a new identity for every node it holds. */
  paste(): readonly SchematicNode[] {
    return this.clipboard ? this.insertCopy(this.clipboard) : [];
  }

  /**
   * Duplicate (PRD §12.3): "Schematify shall mint a new UUIDv7 and shall
   * append a suffix to the slug." Copies the selection without disturbing the
   * clipboard, because duplicating is not copying.
   */
  duplicateSelection(): readonly SchematicNode[] {
    const chosen = this.selectionWithDescendants();
    if (chosen.length === 0) return [];
    const ids = new Set(chosen.map((node) => node.id));
    return this.insertCopy({
      nodes: chosen,
      edges: this.current.doc.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    });
  }

  private insertCopy(source: Clipboard): readonly SchematicNode[] {
    const remap = new Map<string, string>();
    for (const node of source.nodes) remap.set(node.id, uuidv7());

    const step = this.config.grid.size * PASTE_OFFSET;
    const taken = new Map<string | null, Set<string>>();
    const copies: SchematicNode[] = source.nodes.map((node) => {
      const parentId = node.parentId === null ? null : (remap.get(node.parentId) ?? node.parentId);
      const siblings = taken.get(parentId) ?? siblingSlugs(this.cachedIndex, parentId);
      const slug = duplicateSlug(node.slug, siblings);
      siblings.add(slug);
      taken.set(parentId, siblings);
      return {
        ...node,
        id: remap.get(node.id) as string,
        slug,
        parentId,
        rect: { ...node.rect, x: node.rect.x + step, y: node.rect.y + step },
      };
    });

    const edges: SchematicEdge[] = source.edges.map((edge) => ({
      id: uuidv7(),
      kind: edge.kind,
      from: remap.get(edge.from) as string,
      to: remap.get(edge.to) as string,
    }));

    this.commit(
      {
        ...this.current.doc,
        nodes: [...this.current.doc.nodes, ...copies],
        edges: [...this.current.doc.edges, ...edges],
      },
      [
        ...copies
          .filter((node) => !isAnnotation(node))
          .map((node) => addedFile(nodePath(node), nodeJson(node))),
        ...edges.map((edge) => addedFile(edgePath(edge), edgeJson(edge))),
      ],
    );
    this.select(copies.map((node) => node.id));
    return copies;
  }

  // --- history -------------------------------------------------------------

  /**
   * Undo (PRD §12.3). Covers node moves, edge changes, group changes and
   * comment changes, and inverts the semantic half of a step as well as the
   * cosmetic one. A lifecycle transition is never on this stack — the audit
   * row is append-only — and no method here performs one, so the guarantee is
   * structural rather than a check.
   */
  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    const forward = this.current.doc;
    this.applyDoc(step.doc);
    this.applySemantic(step.effects, "back");
    this.redoStack.push({ doc: forward, effects: step.effects });
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    const backward = this.current.doc;
    this.applyDoc(step.doc);
    this.applySemantic(step.effects, "forward");
    this.undoStack.push({ doc: backward, effects: step.effects });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // --- internals -----------------------------------------------------------

  private selectionWithDescendants(): SchematicNode[] {
    const chosen = new Map<string, SchematicNode>();
    for (const id of this.current.selection) {
      const node = this.cachedIndex.byId.get(id);
      if (!node) continue;
      chosen.set(id, node);
      for (const kid of descendantsOf(this.cachedIndex, id)) chosen.set(kid.id, kid);
    }
    return [...chosen.values()];
  }

  private mapNodes(fn: (node: SchematicNode) => SchematicNode): SchematicDoc {
    return { ...this.current.doc, nodes: this.current.doc.nodes.map(fn) };
  }

  /** One undoable step: push history, adopt the document, persist. */
  private commit(doc: SchematicDoc, effects: readonly SemanticEffect[] = []): void {
    this.undoStack.push({ doc: this.current.doc, effects });
    this.redoStack = [];
    this.applyDoc(doc);
    this.applySemantic(effects, "forward");
  }

  /**
   * The Inspector's own commit path (PRD §17 Wave 6): adopts the document,
   * reindexes, records history, and plays the semantic effects — everything
   * `commit`/`applyDoc` do except the layout write, which is the entire
   * reason this method exists rather than a 3rd argument to `commit`.
   */
  private commitSemanticOnly(doc: SchematicDoc, effects: readonly SemanticEffect[]): void {
    this.undoStack.push({ doc: this.current.doc, effects });
    this.redoStack = [];
    this.cachedIndex = indexDoc(doc);
    const alive = new Set(doc.nodes.map((node) => node.id));
    this.current = {
      ...this.current,
      doc,
      selection: this.current.selection.filter((id) => alive.has(id)),
    };
    this.applySemantic(effects, "forward");
    this.notify();
  }

  /** Adopts a document, reindexes, writes the layout file, and notifies. Every
   *  committed change writes the layout file: a step that adds a node changes
   *  where things sit as well as what they are. */
  private applyDoc(doc: SchematicDoc): void {
    this.cachedIndex = indexDoc(doc);
    const alive = new Set(doc.nodes.map((node) => node.id));
    this.current = {
      ...this.current,
      doc,
      selection: this.current.selection.filter((id) => alive.has(id)),
    };
    this.writes.push({ layer: "layout", path: `layout/${doc.slug}.json` });
    this.enqueue(() => this.seam.writeLayout(doc.slug, toLayoutFile(doc, this.current.viewport)));
    this.notify();
  }

  /** Plays a step's file effects in one direction. Going back writes each
   *  file's `before` and going forward writes its `after`; a `null` on the
   *  side being applied means the file should not exist at that point. */
  private applySemantic(effects: readonly SemanticEffect[], direction: "forward" | "back"): void {
    for (const effect of effects) {
      const target = direction === "forward" ? effect.after : effect.before;
      this.writes.push({ layer: "semantic", path: effect.path });
      this.enqueue(() =>
        target === null
          ? this.seam.removeSemantic(effect.path)
          : this.seam.writeSemantic(effect.path, target),
      );
    }
  }

  private replace(state: EngineState): void {
    this.current = state;
    this.notify();
  }

  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending.then(work);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** A file this step brought into being. */
function addedFile(path: string, json: unknown): SemanticEffect {
  return { path, before: null, after: json };
}

/** A file this step took away. */
function droppedFile(path: string, json: unknown): SemanticEffect {
  return { path, before: json, after: null };
}

/** A file this step rewrote, carrying both payloads so undo restores it rather
 *  than removing it. */
function edited(path: string, before: unknown, after: unknown): SemanticEffect {
  return { path, before, after };
}

function edgePath(edge: SchematicEdge): string {
  return `edges/${edge.id}.json`;
}

function nodePath(node: SchematicNode): string {
  return `nodes/${node.id}.json`;
}

/** What one edge's file holds (PRD §5.6, §6.1). */
function edgeJson(edge: SchematicEdge): unknown {
  return { id: edge.id, kind: edge.kind, from: edge.from, to: edge.to };
}

/** What one node's file holds (PRD §5.1, §6.1). Deliberately partial: Wave 1's
 *  schemas own the full shape, and this engine writes only what a duplicate or
 *  a reparent can honestly know. */
function nodeJson(node: SchematicNode): unknown {
  return {
    id: node.id,
    slug: node.slug,
    title: node.title,
    kind: node.kind,
    parent: node.parentId,
  };
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * What an Inspector edit writes: every content field a node carries, minus
 * the purely cosmetic ones (`rect`, `collapsed`, `role`) that `nodeJson`
 * above already excludes for the same reason. Unlike `nodeJson`, this
 * function is not deliberately partial — an Inspector edit knows the node's
 * whole current content, not only what a reparent or a duplicate can
 * honestly infer, so it writes the full envelope PRD §5.1's schema expects.
 * Fields listed explicitly, the same style `engine/layout.ts`'s `buildDoc`
 * and `toGraph` already use for this exact mirroring job.
 */
function inspectorNodeJson(node: SchematicNode): unknown {
  return {
    id: node.id,
    slug: node.slug,
    title: node.title,
    kind: node.kind,
    parent: node.parentId,
    badge: node.badge,
    lifecycle: node.lifecycle,
    layer: node.layer,
    description: node.description,
    authoredBy: node.authoredBy,
    facets: node.facets,
    libraries: node.libraries,
    health: node.health,
    exportsCount: node.exportsCount,
    modulesCount: node.modulesCount,
    dependentsCount: node.dependentsCount,
    sharedAtLca: node.sharedAtLca,
    schemasResolved: node.schemasResolved,
    deprecatedSuccessor: node.deprecatedSuccessor,
    staleReason: node.staleReason,
    exported: node.exported,
    budgetTier: node.budgetTier,
    signature: node.signature,
    returns: node.returns,
    coversCount: node.coversCount,
    budgetThresholdText: node.budgetThresholdText,
    budgetProbe: node.budgetProbe,
    budgetValueText: node.budgetValueText,
    testStatus: node.testStatus,
    docAudience: node.docAudience,
    docBody: node.docBody,
    depVersion: node.depVersion,
    depLicense: node.depLicense,
    depRegistryOk: node.depRegistryOk,
    screenRef: node.screenRef,
    decisions: node.decisions,
    runReference: node.runReference,
    additionalPassingTests: node.additionalPassingTests,
    assignee: node.assignee,
    auditRows: node.auditRows,
    given: node.given,
    when: node.when,
    then: node.then,
    markerToken: node.markerToken,
    testLinkState: node.testLinkState,
    lastDurationMs: node.lastDurationMs,
    mismatch: node.mismatch,
    semantics: node.semantics,
    budgetSignOff: node.budgetSignOff,
    budgetTrending: node.budgetTrending,
    exports: node.exports,
    resolvedMethods: node.resolvedMethods,
    screenLinks: node.screenLinks,
    inboundReferenceCount: node.inboundReferenceCount,
    danglingReferences: node.danglingReferences,
  };
}
