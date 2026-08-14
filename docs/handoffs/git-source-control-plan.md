# Git/GitHub source control panel — implementation plan

Worktree: `orchestrator-git-panel` (branch `feature/git-source-control`, pushed to
`origin/feature/git-source-control`, based off `origin/main` @ c08983c).

## Decisions already made (don't re-litigate)

- **Shell out to system `git`** via `std::process::Command`, not the `git2` crate — reuses the
  user's existing credential helper/SSH config, matches how VS Code itself handles auth-heavy git
  ops. `gh` CLI is installed on the dev machine and available for a later GitHub PR phase, but is
  **not used in this phase**.
- **This phase (MVP) scope**: live changed-files status (staged vs. unstaged, untracked), click a
  file to view its diff, stage/unstage individual files, write a commit message and commit.
  **Not in scope**: push/pull/fetch, branch switching/creation, GitHub PR view/auth. Leave clean
  seams for those (see "Future phases" below) but do not build them now.
- Git commands take a `toolId: string` (not a raw path) and resolve to `checkout_path` server-side,
  mirroring `tool_frontend::resolve` / `reveal_tool`'s existing convention — the frontend already
  knows the active tool's id (`shownToolId` in `WindowRoot.tsx`), so no new "focused tool" lookup
  is needed on the Rust side.
- Git status/diff/commit are one-shot request→response calls, not a streaming session — **do not**
  reuse `pty.rs`'s session/backlog/event machinery. A plain `#[tauri::command]` returning
  `Result<T, AppError>` is correct; non-zero exit maps to `Err(AppError::Git { .. })` built from
  stderr.
- No filesystem watcher exists or is being added this phase. `GitControl` methods are plain
  request/response (`invoke` + `isFake()`), not push/`subscribe`-based like the old
  `WorktreeSource`. The UI re-fetches status after every mutating action (stage/unstage/commit) and
  when the active tool changes.

## Current placeholder being replaced

- `src/shell/worktree/WorktreeView.tsx` — dumb renderer over one `Worktree` snapshot, no
  staging/diff/commit. Its own comment already flags it as a placeholder — treat it as disposable,
  not sacred.
- `src/shell/stubs/worktree.ts` — `stubWorktreeSource`, hardcoded fixture. Will be replaced by real
  `gitControl` wiring in `WindowRoot.tsx`.
- `src/shell/contract.ts` — `ChangeKind = "M"|"A"|"D"` and `Worktree`/`WorktreeSource` are too
  narrow (no staged/unstaged split, no untracked, no rename) — extend/replace with the types below.
- `src/shell/diff/DiffView.tsx` — already built, unmounted. Takes `{ original, modified, language? }`
  as plain strings, Monaco read-only diff editor. Reuse as-is; new code fetches the two text blobs
  and hands them to it unchanged.

## Rust backend — new `src-tauri/src/git.rs`

Commands (registered in `lib.rs`'s `tauri::generate_handler![...]` alongside the existing ~20):

```rust
#[tauri::command]
pub fn git_status(app: tauri::AppHandle, id: String) -> Result<GitStatus>

#[tauri::command]
pub fn git_diff(app: tauri::AppHandle, id: String, path: String, staged: bool) -> Result<GitDiff>

#[tauri::command]
pub fn git_stage(app: tauri::AppHandle, id: String, paths: Vec<String>) -> Result<()>

#[tauri::command]
pub fn git_unstage(app: tauri::AppHandle, id: String, paths: Vec<String>) -> Result<()>

#[tauri::command]
pub fn git_commit(app: tauri::AppHandle, id: String, message: String) -> Result<()>
```

Each resolves `id` → `ResolvedTool` the same way `tool_frontend::resolve` does (`AppState::get()` →
`snapshot.tools.iter().find(|t| t.spec.id == id)`), returns `AppError::UnknownTool(id)` if missing,
and checks `tool.is_git_repo` before running anything (mirrors the existing `EmptyState` case).

Add a small private helper, e.g. `fn run_git(cwd: &Path, args: &[&str]) -> Result<String, AppError>`,
using `std::process::Command::new("git").current_dir(cwd).args(args).output()`. Map spawn/io errors
and non-zero exit (`!status.success()`) both to a new `AppError::Git { op: String, reason: String }`
variant (mirror the existing `Pty { id, reason }` shape — flattened string fields, no `#[source]`,
since neither `io::Error` nor a raw exit code is worth preserving structurally). `reason` should come
from stderr (trimmed) when the process ran but failed, or `e.to_string()` when it failed to spawn.

**`git_status` implementation**: run `git status --porcelain=v1 -z` in the checkout, plus
`git rev-parse --abbrev-ref HEAD` for the branch name, plus ahead/behind via
`git rev-list --left-right --count HEAD...@{u}` — this fails (no upstream) on a fresh branch with
no tracking ref, which is expected and should map to `ahead: 0, behind: 0`, not a hard error; only
`git status` itself failing should surface as `AppError::Git`.

Parsing `--porcelain=v1 -z`: each entry is `XY<space>PATH\0`, except renames/copies which are
`XY<space>PATH\0ORIG_PATH\0` (two NUL-terminated fields, new path first, then the old path — no
literal `->` when `-z` is used, unlike the non-`-z` format). `X` = index/staged status, `Y` =
worktree/unstaged status. `??` means untracked (both chars literally `?`). Map letters to the kind
enum below (`M`→modified, `A`→added, `D`→deleted, `R`/`C`→renamed, `?`→untracked, `U`→conflicted).
A single path can appear with both an `X` (staged) and a `Y` (unstaged) status simultaneously (e.g.
staged-then-further-modified) — emit it into **both** `staged` and `unstaged` arrays in that case,
each as its own `GitFileChange`.

**`git_diff`**: for `staged: true`, compare `git show HEAD:<path>` (may fail with "path does not
exist" if newly added — treat as empty original) against `git show :<path>` (the index). For
`staged: false`, compare the index (`git show :<path>`, or `HEAD:<path>` if unstaged-only) against
the working tree file read via `std::fs::read_to_string(cwd.join(path))`. Untracked files: original
is empty, modified is the file's current contents. Return `{ original: String, modified: String }`.

**`git_stage`/`git_unstage`**: `git add -- <paths...>` / `git restore --staged -- <paths...>`.

**`git_commit`**: `git commit -m <message>` — fail with a clear `AppError::Git` message when there's
nothing staged (git's own stderr already says this; just surface it).

### `AppError` (`error.rs`)

Add:
```rust
#[error("git {op} failed: {reason}")]
Git { op: String, reason: String },
```

## Frontend — new types (`src/shell/contract.ts`)

```ts
export type GitChangeKind =
  | "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface GitFileChange {
  path: string;       // repo-relative, forward slashes
  file: string;        // basename, for display
  dir: string;          // dirname, for display (mirrors WorktreeChange's split)
  kind: GitChangeKind;
  staged: boolean;
  renamedFrom?: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
}

export interface GitDiff {
  original: string;
  modified: string;
}

export interface GitControl {
  status(toolId: string): Promise<GitStatus | null>;   // null: not a git repo / no checkout
  diff(toolId: string, path: string, staged: boolean): Promise<GitDiff>;
  stage(toolId: string, paths: string[]): Promise<void>;
  unstage(toolId: string, paths: string[]): Promise<void>;
  commit(toolId: string, message: string): Promise<void>;
}
```

`Worktree`/`WorktreeSource`/`ChangeKind`/`WorktreeChange`/`CHANGE_TOKEN` get removed once nothing
references them — grep before deleting. `WORKTREE_TAB` string constant in `SecondaryPanel.tsx` stays
as-is (just relabel if desired; tab id doesn't need to change).

## Frontend — new `src/shell/state/git.ts`

Mirror `terminals.ts`'s exact shape: one exported `gitControl: GitControl` object, each method a
one-liner branching on `isFake()`:

```ts
export const gitControl: GitControl = {
  status(toolId) {
    if (isFake()) return fakeGitControl.status(toolId);
    return invoke<GitStatus | null>("git_status", { id: toolId });
  },
  // ...same pattern for diff/stage/unstage/commit
};
```

Add a matching `fakeGitControl` to `src/shell/state/fakeBackend.ts` (mutable in-memory fixture —
`stage`/`unstage`/`commit` should actually mutate the fake state so the panel is exercisable end to
end under `?fake=1` without Tauri).

## Frontend — UI (`src/shell/worktree/`)

Build a new component (name it `SourceControlView.tsx` — `WorktreeView.tsx` can be deleted once
this replaces it) that owns:

- Branch row (reuse the existing `BranchRow` look: icon + branch name + ahead/behind).
- Staged section + Unstaged section, each a list of `GitFileChange` rows with a checkbox
  (staged→checked, clicking toggles stage/unstage via `gitControl.stage`/`unstage`, then re-fetches
  status).
- Clicking a row (not the checkbox) selects it and shows its diff — call `gitControl.diff`, feed
  the result into the existing `DiffView`. Given the panel is ~380px wide and Monaco side-by-side
  needs more room, **decide during implementation** whether the diff renders inline below the file
  list (cramped but simple) or the panel widens temporarily when a file is selected — don't block on
  this, pick the simpler inline option for the MVP and leave a note if it's cramped.
- A commit message `<textarea>` + "Commit" button pinned at the bottom, disabled when `staged` is
  empty or the message is blank. On commit, clear the message and re-fetch status.
- Empty state when `status` is `null` (no git repo) — reuse existing `EmptyState` component/copy
  from `WorktreeView.tsx`.

Wire into `src/shell/WindowRoot.tsx`: replace the `stubWorktreeSource`/`WorktreeView` wiring with
`<SourceControlView control={gitControl} toolId={shownToolId} />` (or equivalent), re-fetching
status on mount and whenever `shownToolId` changes.

## Verification (must pass before calling this phase done)

- `pnpm build` (runs `tsc` then `vite build`) — zero type errors.
- `cargo check --manifest-path src-tauri/Cargo.toml` — zero errors.
- Manual check via `pnpm dev:agent` + `?fake=1` in Chrome (`mcp__claude-in-chrome__*` tools): open
  the tab, see fake staged/unstaged files, click one to see a diff, stage/unstage toggles, type a
  commit message and commit, list updates.
- **Do not** run `pnpm app`, `pnpm dev`, or `tauri dev` — those are reserved for the human
  (`CLAUDE.md`). Real-Tauri verification against an actual repo is the human's job after handoff.

## Future phases (not this pass — leave clean seams, don't build)

- Push/pull/fetch with streaming progress — this *would* want something pty.rs-shaped (long-running,
  progress output), unlike everything in this phase.
- Branch switch/create.
- GitHub PR list/view/checkout — needs `gh` CLI shell-out or an HTTP client + auth (PAT/OAuth);
  nothing for this exists yet in either manifest.
