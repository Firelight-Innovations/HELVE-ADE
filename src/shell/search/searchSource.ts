/**
 * Where hits come from. `search_content` (`src-tauri/src/search.rs`) is a real
 * `ignore`/`grep-searcher` walk — the crates ripgrep is built from — opening
 * every text file under a cluster's directory and reporting every line a query
 * matches, with a line, a column and a length. This module is the thin frontend
 * around it: it resolves flags to defaults, filters by kind (a client-side
 * notion — see `./kinds.ts` — that Rust knows nothing about), and turns an abort
 * into a rejection `useSearchSession.ts`'s existing `.catch()` already expects.
 */
import { searchContent } from "../../bindings";
import { kindOf } from "./kinds";
import type { SearchHit, SearchKind } from "./types";

export interface SearchRequest {
  /** Absolute directory being searched — kept because the locator tree still
   *  needs a root to display paths relative to. Unused for resolving *where*
   *  to search: that is `clusterId`'s job, resolved on the Rust side. See
   *  `docs/design-notes/shell-search.md`. */
  root: string;
  /** Which cluster is asking. `null` means there is no cluster to search — see
   *  below — the same state a window with nothing open is in. */
  clusterId: string | null;
  /** The search *term*, with every filter token already stripped out — the
   *  `needle` of a `ParsedQuery`, not the raw field text. Sending the raw text
   *  would have Rust searching file contents for the literal characters `*.md`,
   *  which is exactly what the query grammar exists to prevent. */
  query: string;
  kinds: SearchKind[];
  /** The query's path-shaped filters, precompiled by `compilePathFilter`.
   *  Applied here rather than in Rust: the grammar is a frontend concept and
   *  `search_content` knows nothing about globs, `path:` or `ext:` filters.
   *  Omitted means no restriction. Filtering after the walk means the backend's
   *  own caps (`MAX_HITS`, `MAX_MATCHES`) are counted first, so a narrow glob
   *  over a large repository can come back truncated with few surviving rows. */
  accept?: (path: string) => boolean;
  /** How `query` should be read. All three default to the plain
   *  substring-anywhere-case-insensitive search the old placeholder
   *  approximated, since nothing upstream sets them yet — `./query.ts` is where
   *  a real query language will eventually turn into these. */
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Aborts a search whose results nobody is waiting for any more. */
  signal: AbortSignal;
}

/** Run a search. Resolves with whatever the backend found — possibly capped,
 *  see `SearchResponse.truncated`. Rejects only on abort, which
 *  `useSearchSession.ts`'s `.catch()` already expects rather than treating as
 *  an unexpected failure; a slow search's `.then()` is guarded against
 *  overwriting a newer one's results whichever promise settles first. */
export async function runSearch(request: SearchRequest): Promise<SearchHit[]> {
  const { clusterId, query, kinds, accept, signal } = request;
  const caseSensitive = request.caseSensitive ?? false;
  const wholeWord = request.wholeWord ?? false;
  const regex = request.regex ?? false;

  if (query.trim() === "" || kinds.length === 0) return [];
  if (signal.aborted) throw abortError();

  // No cluster, nothing to search — the same empty answer `search_content`
  // itself gives a cluster with no project. Handled here so a caller with
  // nothing open never pays for an `invoke` round trip whose answer is empty.
  if (clusterId === null) return [];

  const wanted = new Set(kinds);

  // `search_content` is a single request/response call, not a stream — there is
  // no partial progress to cancel *into*. Racing the invoke against the abort
  // signal is what makes `runSearch` reject the moment the caller aborts rather
  // than whenever the walk finishes; the walk keeps running (Rust cannot
  // preempt a thread mid-scan from here) but notices a newer search on its own
  // — see `SearchState` in `search.rs` — and stops early.
  const call = searchContent(clusterId, query, caseSensitive, wholeWord, regex);

  const response = await Promise.race([call, rejectOnAbort(signal)]);

  const hits: SearchHit[] = [];
  for (const hit of response.hits) {
    const name = basename(hit.path);
    const kind = kindOf(hit.path);
    if (!wanted.has(kind)) continue;
    if (accept !== undefined && !accept(hit.path)) continue;

    hits.push({ path: hit.path, name, kind, matches: hit.matches });
  }

  return hits;
}

/** The basename of an absolute path, forward- or back-slashed alike — the path
 *  arrives however `Path::display` renders it on this platform (see
 *  `SearchFileHit.path`'s doc in `search.rs`), which is backslashed on Windows
 *  and not necessarily what a browser `URL`/`Intl` API expects. */
function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/** A promise that never resolves and rejects the moment `signal` aborts, for
 *  racing against the one `invoke` call this module makes. */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

function abortError(): DOMException {
  return new DOMException("search aborted", "AbortError");
}
