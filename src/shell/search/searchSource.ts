/**
 * Where hits come from.
 *
 * This used to be a placeholder — see the git history of this file for what
 * it looked like before the real search landed. That version walked a
 * cluster's directory over the Files app's own `files/list`, breadth-first,
 * matching only file *names*: enough to make the overlay real (rows to draw,
 * a locator tree to reveal, files for the preview to open) without yet
 * answering whether search matches file names, file contents, or both.
 *
 * It matches both now. `search_content` (`src-tauri/src/search.rs`) is a real
 * `ignore`/`grep-searcher` walk — the same crates ripgrep is built from — that
 * opens every text file under a cluster's directory and reports every line a
 * query matches, with a line, a column, and a length. This module is the thin
 * frontend shell around that one Rust command: it resolves flags to sane
 * defaults, filters the response by kind (a purely client-side notion — see
 * `./kinds.ts` — that Rust knows nothing about), and turns an abort into the
 * same rejection the old walk produced so `useSearchSession.ts`'s existing
 * abort handling needs no changes.
 */
import { invoke } from "@tauri-apps/api/core";
import { fakeSearchContent, isFake } from "../state/fakeBackend";
import { kindOf } from "./kinds";
import type { SearchHit, SearchKind, SearchMatch } from "./types";

export interface SearchRequest {
  /**
   * Absolute directory being searched — kept for source compatibility with
   * the caller and because other parts of the overlay (the locator tree)
   * still need a root to display paths relative to. Unused for resolving
   * *where* to search: that is now `clusterId`'s job, resolved on the Rust
   * side the same way every other cluster-scoped command resolves one (see
   * `search.rs`'s module doc). The frontend cannot hand the backend a
   * directory to run in even if it wanted to — `cluster_path` is not
   * exposed to it.
   */
  root: string;
  /** Which cluster is asking. `null` means there is no cluster to search — see
   *  below — the same state a window with nothing open is in. */
  clusterId: string | null;
  /**
   * The search *term*, with every filter token already stripped out — the
   * `needle` of a `ParsedQuery`, not the raw field text. Sending the raw text
   * would have Rust searching file contents for the literal characters
   * `*.md`, which is exactly what the query grammar exists to prevent.
   */
  query: string;
  kinds: SearchKind[];
  /**
   * The query's path-shaped filters, precompiled by `compilePathFilter`.
   *
   * Applied here rather than in Rust because the grammar is a frontend
   * concept: `search_content` takes a needle and a cluster, and knows nothing
   * about globs, `path:` scopes or `ext:` filters. Omitted means no path
   * restriction, which is what an unfiltered query parses to.
   *
   * The cost of filtering after the walk rather than during it is that the
   * backend's own caps (`MAX_HITS`, `MAX_MATCHES`) are counted *before* this
   * runs — a query with a narrow glob over a large repository can come back
   * truncated with few surviving rows. Pushing the globs into Rust is the fix
   * when that becomes real; it is not real yet, and doing it now would mean a
   * second glob implementation to keep in step with `query.ts`.
   */
  accept?: (path: string) => boolean;
  /**
   * How `query` should be read. All three default to the plain
   * substring-anywhere-case-insensitive search the old placeholder
   * approximated, since nothing upstream sets them yet — `./query.ts` is
   * where a real query language will eventually turn into these.
   */
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Aborts a search whose results nobody is waiting for any more. */
  signal: AbortSignal;
}

/** Mirrors `search::SearchResponse` in `search.rs`. */
interface SearchResponse {
  hits: SearchFileHit[];
  /**
   * True when the backend's own caps (total matches, total files — see
   * `search.rs`'s `MAX_MATCHES`/`MAX_HITS`) cut the walk short, or a newer
   * search superseded this one before it finished. Not surfaced to the UI
   * today — there is nowhere in the results region to say "and more" yet —
   * but read here rather than dropped, so that wiring one in later is a
   * one-line change in the caller rather than a second trip through this
   * file's shape.
   */
  truncated: boolean;
}

/** Mirrors `search::SearchFileHit`. */
interface SearchFileHit {
  path: string;
  matches: SearchMatch[];
}

/**
 * Run a search.
 *
 * Resolves with whatever the backend found — possibly capped, see
 * `SearchResponse.truncated` above. Rejects only on abort, matching what the
 * placeholder walk did and what `useSearchSession.ts`'s `.catch()` already
 * expects: an abort is not treated as an unexpected failure, and a slow
 * search's `.then()` is guarded against overwriting a newer one's results
 * regardless of which promise settles first.
 */
export async function runSearch(request: SearchRequest): Promise<SearchHit[]> {
  const { clusterId, query, kinds, accept, signal } = request;
  const caseSensitive = request.caseSensitive ?? false;
  const wholeWord = request.wholeWord ?? false;
  const regex = request.regex ?? false;

  if (query.trim() === "" || kinds.length === 0) return [];
  if (signal.aborted) throw abortError();

  // No cluster, nothing to search — the same empty answer `search_content`
  // itself gives a cluster with no project. Handled here rather than sent to
  // Rust so a caller with nothing open never pays for an `invoke` round trip
  // whose answer is always going to be empty.
  if (clusterId === null) return [];

  const wanted = new Set(kinds);

  // `search_content` is a single request/response call, not a stream — there
  // is no partial progress to cancel *into*, only a result to still be
  // waiting for. Racing the invoke against the abort signal is what makes
  // `runSearch` reject the moment the caller aborts rather than whenever the
  // walk happens to finish; the walk itself keeps running after that (Rust
  // has no way to preempt a thread mid-scan from here), but it notices on its
  // own that a newer search has started — see `SearchState` in `search.rs` —
  // and stops early rather than spending the blocking thread pool on a result
  // this promise has already stopped listening for.
  // `?fake=1` has no Tauri under it, so `invoke` does not merely fail here — it
  // is not defined at all. The fixture is raced against the abort signal
  // exactly like the real call so that the two paths cannot diverge in their
  // cancellation behaviour, which is the half of this function most likely to
  // be wrong and least likely to be noticed.
  const call = isFake()
    ? fakeSearchContent(clusterId, query, caseSensitive, wholeWord, regex)
    : invoke<SearchResponse>("search_content", {
        clusterId,
        query,
        caseSensitive,
        wholeWord,
        regex,
      });

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

/** The basename of an absolute path, forward- or back-slashed alike — the
 *  path arrives however `Path::display` renders it on this platform (see
 *  `SearchFileHit.path`'s doc in `search.rs`), which is backslashed on
 *  Windows and not necessarily what a browser `URL`/`Intl` API expects. */
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
