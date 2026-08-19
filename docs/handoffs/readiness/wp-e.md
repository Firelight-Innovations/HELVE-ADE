# WP-E · Documentation hygiene

Started 2026-08-18. Branch `docs/hygiene`. Worktree: yes,
`.worktrees/hygiene`. Plan: `docs/contributor-readiness-plan.md`, WP-E.

**Claimed:**

- `docs/tool-protocol.md` — the header paragraph that pointed at `company/`,
  and a new §6.
- `docs/handoffs/readiness/wp-e.md` (new) — this file.

**Not claimed, and deliberately:** `README.md` (WP-H's, two deltas below),
`docs/open-source-plan.md` (WP-H's — its "Decisions still open" items 2 and 3
are now answered on paper in `docs/tool-protocol.md` §6 and should be marked as
such when WP-H does its pass), and every file under `docs/handoffs/`. Item 4
below is a recommendation, not an action: nothing was deleted or moved.

---

## 1. What changed in `docs/tool-protocol.md`

**The `company/` pointer is gone.** The paragraph it sat in said "this file is
the mechanical half; the reasoning lives over there." That was not true even
before the pointer broke — the reasoning is already in this document, beside
each rule, which is what STANDARDS.md §4.2 asks for and what makes the handshake
and command-versus-event sections worth reading. So the sentence now claims the
document is both halves, and points at §6 for the part it genuinely does not
cover. Nothing was brought across from the private file, because nothing needed
to be.

**§6 Stability is new**, and it is the honest version rather than the flattering
one. Three findings shaped it, all from reading the code rather than the docs:

- The `helve/hello` check in §2 — reject the tool if `protocol != 1` or if `id`
  disagrees with the manifest — is **specified and enforced nowhere.**
  `HANDSHAKE_FAILED` (`-32002`) is defined in `crates/helve-rpc/src/codec.rs`,
  exported from `lib.rs`, and never raised, because the code that would raise it
  is the broker. `examples/echo-tool` answers `helve/hello` correctly and
  nothing checks that it did. §6 says so.
- Transport B is real and runs on every launch, but only for frames the shell
  answers itself. **No tool frontend has ever been mounted in this shell.**
  `src-tauri/src/tool_frontend.rs` resolves a URL for one; nothing docks it.
- `[permissions]` is not merely unenforced, it is unparsed —
  `crates/helve-tool-manifest/src/lib.rs:317` types it as an opaque
  `toml::Value` while every sibling table is `deny_unknown_fields`. Anything a
  tool author writes in it today is a note to themselves.

The versioning rule is the two protocol integers (`protocol` on transport A,
`helve` on transport B) as the single breaking-change lever, additive change
leaving it at 1, and package semver held explicitly separate from protocol
version. It also names the one asymmetry that will otherwise be found the hard
way: a new optional manifest key is additive for tool authors and *not* for
hosts, because unknown keys are a hard error, so a tool adopting one has
declared a minimum shell version.

The two security questions from `docs/open-source-plan.md` are written as
explicitly open, with tradeoffs and a recommendation each, and both end **"Not
decided."** Section 5 of this file is the short form, so answering them does not
require opening the protocol document first.

---

## 2. Delta for WP-H — `README.md:311`, the second `company/` reference

`README.md`, "Apps" section, third paragraph. Replace:

> How they will mount is settled: `company/docs/design/helve-tool-integration.md`
> has the reasoning, `docs/tool-protocol.md` has the wire format.

with:

> How they will mount is settled, and `docs/tool-protocol.md` is the whole of
> it — the wire format, and the reasoning behind each rule that has one.

The rest of the paragraph is unchanged and still reads correctly after the
substitution. Because: the referenced file is in a repository the reader does
not have, in the document that introduces the protocol the open-core model rests
on, and the claim it was making about `tool-protocol.md` — wire format only — is
no longer true of that file.

**Second, smaller delta, same section:** consider adding a sentence pointing at
`docs/tool-protocol.md` §6, since the README's own status line already says the
broker is not built and §6 is where a reader finds out what that costs them.

---

## 3. Delta for WP-H — the stack table

### What the audit found

GitHub visibility cannot be checked from here. Everything else can, and the
result is more decisive than the visibility question:

**All seven repos are placeholders.** Each sibling checkout under
`checkout-root` is a real clone of the URL `helve.toml` names, and each one has
**one commit, two tracked files (`README.md` and `.gitignore`), and a `v0.1.0`
tag** — which is exactly the version `helve.toml` pins. There is no code in any
of them. A second consequence worth knowing: with no `Cargo.toml` or
`package.json` to read, all seven report **`unversioned`** in the shell's own
health list, not `v0.1.0`.

| id | Repo | Pinned | Local checkout | What is in it |
|---|---|---|---|---|
| `engine` | `helve-engine` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |
| `forger` | `helve-forger` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |
| `journeyman` | `helve-journeyman` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |
| `turner` | `helve-turner` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |
| `scrivener` | `helve-scrivener` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |
| `quickener` | `helve-quickener` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |
| `wright` | `helve-wright` | 0.1.0 | present, tagged `v0.1.0` | README + `.gitignore` |

So the table's problem is not only that `helve-engine` will 404 for an outsider.
It is that six links that *do* resolve lead to a README, and the sentence under
the table — "each repo cuts tagged semantic-version releases" — describes a
release process that has released nothing. A reader who clicks two of them stops
clicking, and what they take away is that the project overstates itself.

### Recommendation

Add a status column, keep the six links, and drop the link on `helve-engine`
rather than pointing at a 404. A status column is better than removing the links
because the repos genuinely exist and are the multi-repo argument the section is
making; what has to go is the *implication* that there is code behind them.

Ready to paste, replacing the table and the paragraph after it:

```markdown
| Repo | What it is | Ships with a game? | Status |
|---|---|---|---|
| helve-engine | Runtime core (Rust) — lighting, audio playback, spatial audio built in | **Yes** | Closed source, not published |
| [helve-forger](https://github.com/Firelight-Innovations/helve-forger) | Technical design software — specs out the stack and its boundaries | No | Placeholder — README only |
| [helve-journeyman](https://github.com/Firelight-Innovations/helve-journeyman) | Game design software — design prototyping, rough playable systems | No | Placeholder — README only |
| [helve-turner](https://github.com/Firelight-Innovations/helve-turner) | Procedural art system — generates art from an artist's rough shape | No | Placeholder — README only |
| [helve-scrivener](https://github.com/Firelight-Innovations/helve-scrivener) | Narrative/dialogue authoring tool | No | Placeholder — README only |
| [helve-quickener](https://github.com/Firelight-Innovations/helve-quickener) | NPC behavior / AI tooling | No | Placeholder — README only |
| [helve-wright](https://github.com/Firelight-Innovations/helve-wright) | Audio authoring/composition tooling | No | Placeholder — README only |

Only this repository has code in it today. The other six are tagged `v0.1.0`
against a README, which is what `helve.toml` pins and what the health list
reports as `unversioned` — the pin is a placeholder holding a shape, not a
release. **`helve-engine` is closed source and stays that way**, which is the
open-core line: the tool protocol is the boundary, and the engine sits on the
far side of it exactly as a third-party tool would.

Each repo will cut tagged semantic-version releases (`v0.1.0`, …) rather than
tracking a floating branch tip. This repo pins specific tagged versions of each
component, not branch heads.
```

Two notes for whoever applies it:

- The last paragraph is the existing one with "cuts" changed to "will cut". That
  is the whole fix to the release-process claim.
- The `helve-engine` row is deliberately unlinked and named rather than removed.
  Removing it would hide the one component that ships with a finished game, and
  `open-source-plan.md` phase 4.5 argues that the commercial parts get stated up
  front rather than discovered.

**One thing to confirm, not a finding:** `helve-engine`'s README ends with "Part
of the [Helve](https://github.com/Firelight-Innovations/helve) stack", and this
repository's directory is `orchestrator` while its README calls it `helve`.
Whatever the public repository is finally named, those two should agree before
anyone links to either.

---

## 4. `docs/handoffs/` — inventory and recommendation

Nothing here was removed. This is the audit the plan asked for.

### Why it matters which way decision 3 goes

The plan's decision 3 is fresh squashed history versus keeping it. **If history
is kept, deleting these files in a commit does not remove them** — the brand
packet, the logo zip and the two screenshots stay reachable in the pack forever,
and scrubbing them out afterwards means rewriting published history. The whole
directory arrived in three commits on 2026-08-12 (`df44d84`, `0338c3b`,
`380317c`), so a filter is *possible*, but `open-source-plan.md` phase 4.3
already recommends squashing for exactly this reason and is right.

**Recommendation: squash, and remove the directory in the same motion.** If
history is kept instead, then removing the four binary-ish files is not enough
and a history filter becomes mandatory rather than optional.

### The inventory

**(c) — possibly not ours to publish**

| File | Size | What it is |
|---|---|---|
| `vs-code-folder-icons.png` | 67 KB | Screenshot of Microsoft Visual Studio Code's UI, kept as a visual reference while the file icons were built |
| `vs-code-startup.png` | 97 KB | Screenshot of VS Code's start-up window, same purpose |

These are the clearest of the three. They are screenshots of a third party's
shipped product, carried in our tree as design reference, and there is no reason
for them to be in a public repository. Remove regardless of which way decision 3
goes.

`HELVE Brand Packet.html` and `HELVE logo ideation.zip` are the two the plan
flagged, and the legal half of the worry did **not** hold up: the only embedded
third-party asset in the packet is IBM Plex Sans and Mono as `woff2` subsets,
which is SIL OFL and redistributable, and there are no other embedded images or
fonts. The four SVGs in the zip are earlier iterations of this app's own mark —
same filenames as `assets/helve-mark.svg`, `helve-icon.svg`,
`helve-icon-256.svg` and `helve-icon-textured.svg`, all four differing from the
tracked versions that `df44d84` shipped. So they are ours.

What I cannot verify from here is whether anything in the packet's *design* was
lifted from a reference board rather than authored. Braden should confirm that
before it is published anywhere, but on the evidence available it is a
publication question rather than a licensing one, so both files sit under (b).

**(b) — working material, remove before publication**

| File | Size | What it is |
|---|---|---|
| `HELVE Brand Packet.html` | 592 KB | A bundled single-file export of a generated brand-guidelines page. Internal brand direction, and WP-F supersedes it — `branding.toml` plus `assets/` becomes the source of truth for exactly this |
| `HELVE logo ideation.zip` | 13 KB | Four mark iterations, superseded by the tracked SVGs in `assets/`. A binary archive in a docs folder is also the wrong shape for a public repo |
| `HELVE-Shell-Handoff-standalone.html` | 614 KB | Bundled export of the shell specification |
| `shell-spec.html` | 65 KB | The decoded payload of the file above, carrying a header that says "Regenerate, do not hand-edit". The shell it specifies is now built, and `docs/design-notes/shell-*.md` is where its reasoning lives |
| `IMPLEMENTATION-PROMPT.md` | 6.6 KB | An agent prompt — "You are the implementation lead… do not start building until the plan is reviewed." It reads exactly like what it is |
| `agent-claims.md` | 5.7 KB | File claims from finished parallel sessions. Its own instructions say to delete a block when the work lands; nobody did |
| `files-app-split.md` | 18 KB | Agent-to-agent handoff, addressed to a named branch. The split has landed |
| `git-source-control-plan.md` | 11 KB | Implementation plan naming a worktree and a pushed branch. Landed — `src-tauri/src/git.rs` and `src/shell/worktree/SourceControlView.tsx` exist |
| `menu-bar-wiring.md` | 8.8 KB | Handoff for the File/Edit/View menus. Landed — `src/shell/titlebar/menus.ts` |
| `multi-instance-layout.md` | 26 KB | Marked "Status: built… kept as the design record". The only one with a claim to survive; see below |

**(a) — safe to publish**

None of them, in their current form.

`multi-instance-layout.md` is the near miss and deserves a decision rather than
a sweep. It is a real design record and it says so at the top. But
`docs/design-notes/` is not a place to put it: that directory has a stated and
narrow convention — rationale moved *verbatim* out of a module header to stay
under the comment-concentration cap, with the source file pointing back at the
page. A handoff document dropped in there breaks the convention and nothing
points at it.

So: check `docs/design-notes/shell-surfaces.md` and `shell-state.md` for what
they already carry about panes, clusters and instances, and if a unique argument
survives that comparison, fold it in the way §4 describes — into the page the
source already points at — rather than moving the file. Then remove the file
with the rest.

### The two exceptions

`docs/handoffs/readiness-claims.md` and `docs/handoffs/readiness/` are this
project's own coordination and are live right now, so they are outside this
inventory. They are also working material by construction: WP-H already plans to
delete the claims file, and this directory should go with it. Neither should
survive into a public first commit.

---

## 5. The two open security questions, in short

Both are written out in full in `docs/tool-protocol.md` §6, with the tradeoffs.
Both need an answer from Braden and neither blocks any other work package.

**Clone or signed artifact?** Nothing today puts a tool checkout on disk — a
person clones by hand and `checkout-root` finds it. The moment the shell fetches
for itself, cloning a URL out of a TOML file and running its `core.bin` is
arbitrary code execution authorized by a line of configuration, it needs `git`
on the user's machine, and a pin that resolves to a tag is a pointer somebody
can move. A signed artifact with a checksum is verifiable before anything runs,
needs no `git`, and pins one build permanently; it costs a release pipeline per
tool repo. **Recommendation:** signed artifacts for anything the shell fetches,
hand-cloned checkouts kept as the development path — `dist` and `dev-url` are
already that split, so the cost lands on distribution, not on the inner loop.

**What is a mounted tool allowed to do?** The protocol bounds the frontend well
— own origin, identity resolved from `event.source` so no tool can impersonate
another, `helve/open` confined to app kinds in its own cluster — and bounds the
core not at all. **A tool's core is a child process with the user's full
privileges**, and Tauri's capability system governs webviews, which a core is
not. `[permissions]` as it stands is the author declaring intent, not the host
imposing a limit. **Recommendation:** give `[permissions]` a real schema before
the broker ships rather than after, deny by default on the tool window's Tauri
capability set since a tool frontend needs nothing from Tauri directly, and
state in the protocol document that a core is unsandboxed under v1 rather than
letting the frontend's isolation imply a guarantee that does not reach it.

An install-time prompt is worth having and is not an answer on its own: it is
the only moment a person has the context to decide, and a prompt nobody
understands is a prompt everybody accepts.
