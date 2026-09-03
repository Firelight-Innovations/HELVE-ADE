/**
 * PRD §7.4's second caption line: `crypto-primitives.sign changed 2h ago.
 * Re-review required.` — built from the `Staleness` mark
 * `stale_cascade` writes onto a node's `stale` field, which
 * `schematify/load-graph` serializes verbatim. The elapsed time is never
 * stored, so it is computed here, at draw time, per PRD §0.4.
 */

/** One node's raw `stale` mark, as `schematify_core::Staleness` serializes
 *  it. `source` is a node id, not a slug — resolve it against the graph
 *  before calling `staleCaption`. */
export interface RawStaleness {
  source: string;
  member?: string;
  at: string;
}

/** The compact `{n}{unit} ago` form the wireframe uses (`2h ago`), matching
 *  `InspectorShell.tsx`'s own hardcoded `4m ago`. Coarsest unit still true. */
export function agoCompact(atMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - atMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** PRD §7.4's second caption line, or `undefined` with no `stale` mark or
 *  no resolvable `sourceSlug` (the caller's job — see `project.ts`). */
export function staleCaption(
  stale: RawStaleness | undefined,
  sourceSlug: string | undefined,
  nowMs: number,
): string | undefined {
  if (!stale || !sourceSlug) return undefined;
  const atMs = Date.parse(stale.at);
  const changed = Number.isNaN(atMs) ? "" : ` ${agoCompact(atMs, nowMs)}`;
  const name = stale.member ? `${sourceSlug}.${stale.member}` : sourceSlug;
  return `${name} changed${changed}. Re-review required.`;
}
