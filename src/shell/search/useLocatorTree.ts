/**
 * Loads and reveals the directory spine leading to a search hit.
 *
 * Mirrors the cache-plus-flatten shape of
 * `apps/files/ui/src/explorer/useTree.ts`: one listing per directory,
 * fetched once and kept for the pane's lifetime, with a flat top-to-bottom
 * row list falling out of which directories are "revealed" rather than out
 * of a recursive walk done at render time.
 *
 * The one real difference from that hook is what drives expansion. There
 * the user opens and closes rows by hand. Here nothing is ever collapsed —
 * `revealed` only grows, hit after hit, so a pane that has already shown
 * three hits in three different folders keeps all three paths open instead
 * of flickering closed every time the hover moves. Which row is *marked* as
 * the target is a separate fact that is never cached: `flatten` below reads
 * it straight off the `focus` argument on every call, never off anything a
 * walk decided, so a walk still in flight when the hover moves on can never
 * paint a target that is no longer current — see the note on the reveal
 * effect for why that isn't just an aspiration.
 *
 * What it deliberately does not do, same as its model:
 *
 * - **Watch the filesystem.** A directory is listed once. Nothing re-checks
 *   it, because nothing here has a reason to — this pane exists only while
 *   the search overlay is open.
 * - **Sort.** `files/list` already returns directories first, then
 *   case-insensitively by name, and `flatten` below draws entries in the
 *   order they arrive.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { callApp } from "../state/apps";
import type { LocatorFocus, LocatorNode } from "./types";

// Restated rather than imported from `apps/files/ui/src/rpc.ts` — that
// file's header explains why `src/` and `apps/files/` may not reach into
// each other's shapes even though both describe the same wire format. Same
// restatement `searchSource.ts` makes next door, and trimmed to the same
// fields: this pane draws a name, a path and a dir/file split, and nothing
// else `files/list` returns.
interface Entry {
  name: string;
  path: string;
  kind: "dir" | "file" | "other";
}
interface Listing {
  path: string;
  parent: string | null;
  entries: Entry[];
}

export interface LocatorTree {
  nodes: LocatorNode[];
  /**
   * Directory path → why it would not list. Kept off to the side rather than
   * folded into `LocatorNode` because that shape belongs to the overlay and
   * this pane does not get to extend it; see the report back to whoever owns
   * `types.ts` about drawing the `--err` tag from this instead of a field on
   * the node itself.
   */
  errors: ReadonlyMap<string, string>;
}

function listDir(path: string, clusterId: string | null): Promise<Listing> {
  return callApp("files", "files/list", { path }, scopeFor(clusterId)) as Promise<Listing>;
}

/** `callApp` takes no scope at all rather than one with a null cluster —
 *  same helper, same reasoning, as `searchSource.ts`'s `scopeFor`. */
function scopeFor(clusterId: string | null) {
  return clusterId === null ? undefined : { clusterId };
}

/** True when `target` is `candidate` itself or sits somewhere under it.
 *  Checked against both separators because the backend returns whatever
 *  `Display` produced for the platform it's running on, exactly as
 *  `apps/files/ui/src/rpc.ts`'s `baseName` does. */
function isAncestorOrSelf(candidate: string, target: string): boolean {
  if (target === candidate) return true;
  if (!target.startsWith(candidate)) return false;
  const rest = target.charAt(candidate.length);
  return rest === "\\" || rest === "/";
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

export function useLocatorTree(
  root: string | null,
  focus: LocatorFocus | null,
  clusterId: string | null,
): LocatorTree {
  // The listing cache and the revealed set live in refs, not state: the
  // reveal walk below mutates them synchronously as each level of the spine
  // resolves, and re-rendering off a `forceRender` bump after each mutation
  // is what lets that walk run to completion without waiting on React to
  // notice — see the walk's own comment for why depending on state here
  // would restart it after every single fetch.
  const cache = useRef(new Map<string, Entry[]>());
  const revealed = useRef(new Set<string>());
  const inFlight = useRef(new Map<string, Promise<Entry[]>>());
  /** Bumped whenever the root changes, so a listing that was in flight for
   *  the previous root cannot write its entries into this one's cache — the
   *  same guard `useTree.ts`'s `load` uses. */
  const generation = useRef(0);
  const [renderTick, forceRender] = useReducer((n: number) => n + 1, 0);

  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());

  const load = (path: string, myGeneration: number): Promise<Entry[]> => {
    const flight = inFlight.current;
    const existing = flight.get(path);
    if (existing) return existing;

    const promise = listDir(path, clusterId)
      .then((listing) => {
        if (generation.current === myGeneration) {
          cache.current.set(path, listing.entries);
          setErrors((prev) => {
            if (!prev.has(path)) return prev;
            const next = new Map(prev);
            next.delete(path);
            return next;
          });
          forceRender();
        }
        return listing.entries;
      })
      .catch((err: unknown) => {
        if (generation.current === myGeneration) {
          setErrors((prev) => new Map(prev).set(path, describeError(err)));
          forceRender();
        }
        throw err;
      })
      .finally(() => {
        if (flight.get(path) === promise) flight.delete(path);
      });

    flight.set(path, promise);
    return promise;
  };

  // A new root: drop everything cached under the old one and start clean.
  // The revealed set is dropped here too, not just the cache — carrying a
  // path revealed under a different root forward would be a stale
  // coincidence, not stability.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = new Map();
    cache.current = new Map();
    revealed.current = new Set();
    setErrors(new Map());
    forceRender();
    if (!root) return;
    const mine = generation.current;
    void load(root, mine).catch(() => {}); // Failure is already recorded in `errors`.
  }, [root, clusterId]);

  // Walk root → target one directory at a time, revealing every directory
  // found on the way. This depends only on `root` and `focus.path`, not on
  // the cache: each step reads its directory straight off `load`'s resolved
  // value, so the walk can run to completion across several awaits without
  // React ever needing to re-render it back into existence. Depending on the
  // cache instead would restart this from the top after every single fetch
  // it makes, since setting a cache entry is exactly what re-renders the
  // component.
  //
  // Nothing here decides which row is the target — `flatten` reads that from
  // `focus` fresh on every call. So when the hover moves before this walk
  // finishes, the walk quietly keeps revealing a path nobody is pointed at
  // any more (harmless — see this file's header) while the *next* effect run
  // starts a second walk toward the new target; neither walk can paint a
  // target the other one owns, because neither of them paints a target at
  // all.
  useEffect(() => {
    if (!root || !focus) return;
    const mine = generation.current;
    let cancelled = false;

    void (async () => {
      let dir = root;
      for (;;) {
        if (cancelled || generation.current !== mine) return;

        let entries = cache.current.get(dir);
        if (!entries) {
          try {
            entries = await load(dir, mine);
          } catch {
            return; // Recorded in `errors`; nothing further to reveal past it.
          }
          if (cancelled || generation.current !== mine) return;
        }

        const next = entries.find((e) => isAncestorOrSelf(e.path, focus.path));
        if (!next || next.path === focus.path) return; // Found the file, or found nothing more to walk toward.

        if (!revealed.current.has(next.path)) {
          revealed.current.add(next.path);
          forceRender();
        }
        dir = next.path;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [root, focus?.path, clusterId]);

  const targetPath = focus?.path ?? null;
  const nodes = useMemo(
    () => (root ? flatten(root, cache.current, revealed.current, targetPath, 0) : []),
    // `cache` and `revealed` are refs and never change identity, so listing
    // them here would not recompute anything. `renderTick` is what actually
    // stands for them: `load` and the reveal walk bump it every time either
    // ref is mutated, which is the only way this memo needs to run again.
    [root, targetPath, renderTick],
  );

  return { nodes, errors };
}

/**
 * The revealed tree, depth-first, as one array — same shape as
 * `useTree.ts`'s `flatten`, minus the filter half of that function, which
 * this pane has no equivalent of.
 */
function flatten(
  dir: string,
  cache: ReadonlyMap<string, Entry[]>,
  revealed: ReadonlySet<string>,
  targetPath: string | null,
  depth: number,
): LocatorNode[] {
  const entries = cache.get(dir);
  if (!entries) return [];

  const rows: LocatorNode[] = [];
  for (const entry of entries) {
    const isDir = entry.kind === "dir";
    const open = isDir && revealed.has(entry.path);
    rows.push({
      name: entry.name,
      path: entry.path,
      kind: isDir ? "dir" : "file",
      depth,
      expanded: open,
      isTarget: entry.path === targetPath,
    });
    if (open) rows.push(...flatten(entry.path, cache, revealed, targetPath, depth + 1));
  }
  return rows;
}
