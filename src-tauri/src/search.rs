//! Content search: what the search overlay actually searches.
//!
//! The frontend's first cut (`src/shell/search/searchSource.ts`) walked a
//! cluster's directory over the Files app's `files/list` and matched only file
//! *names* — an explicit placeholder, documented as such in that file's own
//! header. This is the real thing it was waiting on: a walk that also opens
//! every file and reports every line a query matches, with enough position
//! information (line, column, length) for find-and-replace to step through
//! matches one at a time and for the preview pane to highlight exactly the
//! right span.
//!
//! Built from the same crates ripgrep itself is built from — `ignore` for the
//! walk, `grep-regex` to turn a query into a matcher, `grep-searcher` to drive
//! that matcher over a file's bytes — rather than shelling out to an `rg`
//! binary the way `git.rs` shells out to `git`. The difference from that
//! precedent is deliberate: `git` is something every developer's machine
//! already has for its own reasons, `rg` is not, and this feature cannot
//! depend on a tool a user never chose to install.
//!
//! Using `ignore` buys `.gitignore` support for free — the same walker
//! VS Code's own search is built on — which is what lets this module retire
//! the old hardcoded `node_modules`/`dist`/`target` skip list entirely rather
//! than carry it forward beside a real ignore engine.
//!
//! Like `git.rs`, every command here takes a cluster *id*, never a path — the
//! frontend never gets to name a directory for the backend to run a search in.

use crate::error::{AppError, Result};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks, BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, State};

/// One occurrence of the query inside a file, positioned for an editor to
/// jump to it.
///
/// Mirrors `SearchMatch` in `src/shell/search/types.ts` field for field —
/// that type's doc comments are the authority on what each field means to the
/// UI; this is only the wire shape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: u32,
    pub column: u32,
    pub text: String,
    pub length: u32,
}

/// One file worth of results.
///
/// `matches` is empty for a file that matched on its *name* only — the same
/// file-with-no-nested-rows case `SearchHit.matches` documents on the
/// TypeScript side. Whether a name matched at all is not carried as a
/// separate field: a file with no name match and no content matches is simply
/// never turned into a `SearchFileHit`, so every hit that reaches the
/// frontend already deserves to be there.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileHit {
    /// Absolute, in whatever form `Path::display` gives on this platform —
    /// backslashes on Windows. Matches `apps/files.rs`, which is what the old
    /// name-only walk read its paths from; the preview pane and locator tree
    /// already expect this form, not git's forward-slash convention.
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

/// Every hit the walk found, plus whether it stopped early.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchFileHit>,
    /// True when the match cap below cut the walk short, or a newer search
    /// superseded this one before it finished. Either way the result set is
    /// real but incomplete, and the UI must not present it as the whole
    /// answer — see `MAX_MATCHES` and `SearchState` for the two cases this
    /// covers.
    pub truncated: bool,
}

/// How many matches one search collects before it stops walking.
///
/// A cap on *matches*, not files: a single generated file with the query on
/// every line would otherwise produce a response of unbounded size from one
/// hit. The number is generous enough that an ordinary "how is this function
/// called" search never brushes it, and small enough that hitting it — some
/// repo-wide token like a common word — returns in a search-as-you-type
/// budget rather than after walking the whole tree.
const MAX_MATCHES: usize = 1000;

/// Files larger than this are still checked for a *name* match but never
/// opened for a content one.
///
/// A large file is disproportionately likely to be a bundle, a lockfile, or a
/// data dump rather than something a search-as-you-type feature is aimed at,
/// and scanning one line by line is the single most expensive thing this walk
/// can do per file. 8 MiB comfortably covers real source files — the
/// generated ones this excludes are exactly the ones nobody is searching by
/// hand.
const MAX_CONTENT_BYTES: u64 = 8 * 1024 * 1024;

/// How many *files* one search reports, independent of `MAX_MATCHES`.
///
/// `MAX_MATCHES` alone does not bound the response: a query that matches
/// hundreds of file *names* but appears in no file's contents — `"test"`
/// across a typical repo, say — never advances the match counter at all, so
/// without a separate cap here the two limits would leave that one case
/// unbounded. `MAX_MATCHES` still comfortably outnumbers this, since a single
/// file is expected to be a handful of matches, not hundreds.
const MAX_HITS: usize = 500;

/// The single counter that makes an in-flight search abandon itself the
/// moment a newer one starts.
///
/// There is no id round-trip from the frontend and no separate "cancel"
/// command — `search_content` bumps this counter itself, on the async side,
/// before the walk (which runs on a blocking worker, see the command's own
/// doc comment) ever starts. The walk then checks, once per directory entry,
/// whether the counter still reads its own value; the moment it does not, some
/// later call has already started and this one has nothing left to contribute,
/// so it stops rather than spending more of the blocking thread pool on a
/// result nobody will read.
///
/// This is coarser than per-search cancellation would be — a search anywhere
/// in HELVE invalidates a search anywhere else — but the search overlay is a
/// single session shared by one window (`useSearchSession.ts`), so "newest
/// search wins" is already the exact rule the frontend enforces with its own
/// `AbortController`. One counter is enough to mirror it on this side without
/// inventing a second cancellation vocabulary.
///
/// `u64` rather than something smaller: this increments once per keystroke a
/// user pauses on, for as long as the app runs, and a `u32` is not obviously
/// safe against wrapping over a long session.
#[derive(Default)]
pub struct SearchState {
    generation: AtomicU64,
}

impl SearchState {
    /// Claim the current generation and report it as "the one in progress".
    /// The value returned is what the walk must keep checking against.
    fn begin(&self) -> u64 {
        // `Ordering::SeqCst` rather than a weaker ordering: this is one atomic
        // read-modify-write a debounce cycle, not a hot loop, so there is
        // nothing to gain from reasoning about a cheaper ordering and real
        // cost to getting it wrong.
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Whether `generation` is still the most recent one claimed.
    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }
}

/// Search a cluster's directory for `query`, both in file names and in file
/// contents, and report every match.
///
/// ## Why this is `async` and hops to a worker
///
/// A `#[tauri::command]` that is a plain synchronous function runs on the
/// **main thread** — the same one driving every window's UI. `commands::
/// app_call`'s doc comment lays out the failure mode this avoids: a
/// filesystem walk of any real size would freeze every HELVE window for as
/// long as it took. `tauri::async_runtime::spawn_blocking` moves the walk to
/// a worker thread and this command `.await`s it, which is the same shape
/// `app_call` already uses for exactly this reason.
///
/// ## Why the generation is claimed before the hop, not inside it
///
/// `SearchState::begin` runs synchronously, before `spawn_blocking` is even
/// called. Two `search_content` invocations arrive in the order the frontend
/// made them; claiming the generation here preserves that order. Doing it
/// inside the worker instead would let two blocking-pool threads race to
/// claim it, and whichever happened to be scheduled second would — correctly
/// by its own logic, wrongly for the user — invalidate the newer search.
///
/// ## Flags
///
/// `case_sensitive`, `whole_word`, and `regex` all apply to *both* halves of
/// the search — a file's name and its contents are matched with the one
/// matcher built from them, so "case-insensitive" cannot mean one thing for
/// `README` and another for a line inside it.
#[tauri::command]
pub async fn search_content(
    app: AppHandle,
    cluster_id: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
) -> Result<SearchResponse> {
    let generation = app.state::<SearchState>().begin();

    tauri::async_runtime::spawn_blocking(move || {
        let Some(root) = crate::project::cluster_path(&app, &cluster_id) else {
            // No project, or the project's folder is gone — the same "nothing
            // to search" state `git_cluster_status` draws as empty rather than
            // as an error.
            return Ok(SearchResponse {
                hits: Vec::new(),
                truncated: false,
            });
        };

        let matcher = build_matcher(&query, case_sensitive, whole_word, regex)?;
        let state = app.state::<SearchState>();

        Ok(walk(&root, &matcher, &state, generation))
    })
    .await
    // The worker panicked or the runtime is shutting down — `app_call`'s own
    // comment on the identical `.unwrap_or_else` explains why this becomes a
    // plain error rather than an unwrap that would take the main thread with
    // it. There is no `RpcError` vocabulary here, so this crosses as an
    // ordinary `AppError`.
    .unwrap_or_else(|e| {
        Err(AppError::Search(format!(
            "the search did not complete: {e}"
        )))
    })
}

/// A query plus its three flags, compiled into one matcher that both the
/// name check and the content scan below reuse.
///
/// `regex: false` does not mean "skip the regex engine" — `grep-regex` is a
/// regex engine start to finish, including for a literal query. It means
/// "escape the query first", via `regex_syntax::escape`, so that a search for
/// `a.b()` looks for those five characters rather than "any character, b,
/// then a captured empty group". Building a literal search this way rather
/// than hand-writing a byte comparison is what lets `whole_word` — which is
/// itself implemented as a regex word-boundary wrapper — apply uniformly to
/// both modes.
fn build_matcher(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
) -> Result<grep_regex::RegexMatcher> {
    let pattern = if regex {
        query.to_string()
    } else {
        regex_syntax::escape(query)
    };

    RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .word(whole_word)
        .build(&pattern)
        .map_err(|e| AppError::Search(format!("`{query}` is not a usable search pattern: {e}")))
}

/// The walk itself, once there is a directory and a compiled matcher.
///
/// Never returns an error: an unreadable entry, an unreadable file, or a
/// generation that has moved on are all ordinary outcomes here, the same way
/// `git.rs`'s walk-adjacent functions treat one bad record as something to
/// skip rather than something to fail the whole call over.
fn walk(
    root: &Path,
    matcher: &grep_regex::RegexMatcher,
    state: &State<'_, SearchState>,
    generation: u64,
) -> SearchResponse {
    let mut hits = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;

    let mut searcher = SearcherBuilder::new()
        // Ripgrep's own default: the first NUL byte in a file's opening bytes
        // is treated as proof the file is not text, and the file is skipped
        // rather than scanned line by line for a query that was never going
        // to appear in it meaningfully.
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();

    let walker = WalkBuilder::new(root)
        // Dotfiles are ordinary search targets here — `.env`, `.github/`,
        // HELVE's own `.helve/` — unlike ripgrep's own default, which is
        // tuned for a terminal user who types `--hidden` when they want them.
        // A GUI search box has no equivalent flag to reach for, so this always
        // includes them.
        .hidden(false)
        .build();

    for entry in walker {
        // Checked once per entry — cheap compared to the filesystem work
        // around it — so a superseded search stops within one directory
        // listing of the newer one starting, not after walking whatever was
        // left of the tree.
        if !state.is_current(generation) {
            truncated = true;
            break;
        }

        let Ok(entry) = entry else {
            // A permission error or a path that vanished mid-walk. One
            // unreadable entry is not reason to lose every hit found so far.
            continue;
        };

        // `.git` is excluded regardless of `.gitignore` — nothing in a normal
        // repository *lists* `.git` there, since it is not inside the working
        // tree `.gitignore` describes, so `hidden(false)` above would
        // otherwise walk straight into it. Its contents are git's internal
        // object store, never something a text search is aimed at, and once a
        // cluster is on a worktree it can be large enough on its own to
        // dominate the walk.
        if entry.file_name() == OsStr::new(".git") {
            continue;
        }

        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy();
        let name_matches = matcher.find(name.as_bytes()).ok().flatten().is_some();

        let too_large = entry
            .metadata()
            .map(|m| m.len() > MAX_CONTENT_BYTES)
            .unwrap_or(false);

        let mut matches = Vec::new();
        if !too_large {
            let hit_cap = search_file(
                &mut searcher,
                matcher,
                path,
                &mut matches,
                &mut total_matches,
            );
            if hit_cap {
                truncated = true;
            }
        }

        if name_matches || !matches.is_empty() {
            hits.push(SearchFileHit {
                path: path.display().to_string(),
                matches,
            });
        }

        if total_matches >= MAX_MATCHES || hits.len() >= MAX_HITS {
            truncated = true;
            break;
        }
    }

    SearchResponse { hits, truncated }
}

/// Scan one file's contents, appending every match into `matches` and
/// counting it against the shared `total_matches` budget. Returns whether the
/// budget ran out during this file.
///
/// A file that fails to open or turns out not to be valid enough to search —
/// permission denied, deleted between the walk listing it and this reading
/// it, or ruled out mid-read by binary detection — is silently left with
/// whatever matches (possibly none) had already been found in it, the same
/// "skip, do not sink the walk" rule the entry-level errors above follow.
fn search_file(
    searcher: &mut grep_searcher::Searcher,
    matcher: &grep_regex::RegexMatcher,
    path: &Path,
    matches: &mut Vec<SearchMatch>,
    total_matches: &mut usize,
) -> bool {
    let mut hit_cap = false;

    // `sinks::Bytes` rather than `sinks::UTF8`: the latter errors out of the
    // whole file the moment one line is not valid UTF-8, which is exactly the
    // all-or-nothing failure `git.rs`'s `run_git` rejects for the same reason
    // (see its doc comment on `String::from_utf8_lossy`). Decoding lossily
    // here means a source file with one stray non-UTF-8 byte still yields
    // every match on every other line, with a replacement character standing
    // in on the one line that has a problem.
    let result = searcher.search_path(
        matcher,
        path,
        sinks::Bytes(|line_number, line_bytes| {
            // The searcher includes the line's terminator in what it hands
            // back; trimmed here so `SearchMatch.text` is the line a person
            // would say they are looking at, not that line plus an invisible
            // newline.
            let text = String::from_utf8_lossy(line_bytes)
                .trim_end_matches(['\n', '\r'])
                .to_string();

            // The searcher finds which *lines* contain a match but does not
            // report where within them — the same reason ripgrep's own
            // printer crate re-runs the matcher per matched line to recover
            // exact spans, rather than a limitation specific to this code.
            let find_result = matcher.find_iter(text.as_bytes(), |m| {
                matches.push(SearchMatch {
                    line: line_number as u32,
                    column: utf16_column(&text, m.start()),
                    text: text.clone(),
                    length: utf16_len(&text[m.start()..m.end()]),
                });
                *total_matches += 1;
                *total_matches < MAX_MATCHES
            });

            if find_result.is_err() || *total_matches >= MAX_MATCHES {
                hit_cap = *total_matches >= MAX_MATCHES;
                // `Ok(false)` tells the searcher to stop reading this file —
                // there is no more budget left for it, so there is nothing to
                // gain from reading the rest.
                return Ok(false);
            }

            Ok(true)
        }),
    );
    let _ = result;

    hit_cap
}

/// A UTF-8 byte offset into `line`, converted to the 1-based UTF-16 column
/// `SearchMatch.column` is documented in.
///
/// This is the one place this module has to think about the gap between how
/// Rust and JavaScript count through a string. `grep_matcher::Match` reports
/// byte offsets — Rust's own indexing unit — but the frontend hands
/// `SearchMatch.column` straight to Monaco's `revealMatch`
/// (`previewMonaco.ts`), which measures in UTF-16 *code units*, the unit
/// every JavaScript string uses. The two agree for plain ASCII text and
/// silently disagree the moment a line has an emoji, an accented letter
/// outside Latin-1, or any other character whose UTF-8 encoding is not one
/// byte — so this walks the bytes before the match and counts them the way a
/// JavaScript string would, rather than assuming the byte count is already
/// the right answer.
fn utf16_column(line: &str, byte_offset: usize) -> u32 {
    // `str::get` rather than slicing with `[..byte_offset]`: a `Match` from
    // this module's own `find_iter` call always lands on a char boundary
    // (grep-matcher guarantees it), so this can never actually fail — `get`
    // is used anyway because an indexing panic here would take down the whole
    // search over one line of one file, and `unwrap_or(1)` is a far cheaper
    // insurance policy than proving the guarantee holds under every future
    // change to this function.
    line.get(..byte_offset)
        .map(|s| s.encode_utf16().count() as u32 + 1)
        .unwrap_or(1)
}

/// The UTF-16 length of a str slice — `SearchMatch.length`'s counterpart to
/// `utf16_column`, for the same reason.
fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}
