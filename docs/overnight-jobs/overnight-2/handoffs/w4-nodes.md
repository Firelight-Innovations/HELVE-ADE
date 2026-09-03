# Wave 4 handoff — node anatomy

Branch `schematify/w4-nodes`, stacked on `schematify/w3-engine`. Pull request
opened with `--base schematify/w3-engine`; the orchestrator retargets it to
`main` once Wave 3 lands.

**The fixture-drawing acceptance condition is met only against a hand-typed
stand-in, not against real data.** The genuine `fixtures/saas-backend/`
fixture PRD §16.1 describes exists solely inside `crates/schematify-core` on
a branch that has never merged here, and no front-end wave — this one
included — has ever read it. Every badge, count and caption this wave built
and tested is checked against `graph/fixture.ts`'s `AUTH_SERVICE_GRAPH`, a
value this wave hand-typed to match WIREFRAME-EXTRACT.md §1.1's strings. Once
the real backend is wired (another agent is doing that now), every one of
those assertions needs re-verification against what the real fixture and a
real loader actually produce — this wave proves the rendering rules are
correct for the data it was given, not that the given data is real.

## 1. How a node box is composed

Everything is decided in 2 files, and drawn by a 3rd:

- `engine/anatomy.ts` is new this wave. Every function is pure: `badgesFor`,
  `facetChipsFor`, `countStringsFor` and `captionFor` take a node's own data
  and return strings; `LIFECYCLE_TREATMENTS` is a lookup table from a
  lifecycle state to a geometry descriptor; `healthWedgeFor` and
  `healthRollupFor` are PRD §12.8's channel; `zoomTierFor` is the 3-tier
  rule; `headerOccupants` is the health-wedge/node-menu geometry; `contentBox`
  and `contentOf` are the content-derived sizing PRD §17's `config.ts` doc
  comment always said Wave 4 would build ("the one callback: Wave 4 sizes a
  node from its content").
- `frame.ts`'s `drawNode` calls every one of those and puts the results on
  `DrawnNode`: `badges`, `facetChips`, `counts`, `caption`, `containsCaption`,
  `lifecycle`, `health`, `headerOccupants`, `zoomTier`. Nothing is stored —
  every field is recomputed every frame, per PRD §0.4.
- `SchematicCanvas.tsx`'s `NodeBox` only maps that data onto markup and a
  `--kv-*` token reference. It makes no decision `anatomy.test.ts` cannot
  already see, holding Wave 3's "the renderer decides nothing" rule.

`config.ts`'s `nodeBox` callback signature widened from `(kind) => Size` to
`(kind, content?) => Size`. `presets.ts`'s `boxFor` now calls `contentBox`
underneath, so a node's box grows by a fixed per-row amount (description 24px,
facets 16px, libraries 14px, caption 16px) for whichever of those 4 rows its
own content has — a plain node with none of them keeps exactly Wave 3's base
box. `content` is optional, so `engine.ts`'s `toggleCollapse` (which always
shrinks a box to its kind's own base size on collapse, regardless of what it
holds) compiles and behaves unchanged.

**What Wave 5 configures:** the presets in `presets.ts` — box base sizes per
kind, and eventually per-facet-kind boxes at tier 3. `arrange.ts`'s layout
strategy is untouched. Nothing about node anatomy is tier-specific in
`anatomy.ts` itself; `tier` is passed to `badgesFor` only to choose
`ENTRY`/`ENTRY POINT` and to suppress the layer badge at tier 3.

**What Wave 6 configures:** the Inspector reads the same `SchematicNode`
fields this wave added (`description`, `facets`, `libraries`, `health`, etc.)
rather than a second copy — nothing new to build there for these fields to
reach the Inspector, since they are already on the document.

## 2. The 8 lifecycle states, and how they stay apart without colour

Each state is a row in `anatomy.ts`'s `LIFECYCLE_TREATMENTS`, described by 8
fields, only 3 of which name a `--kv-*` token (`borderToken`, `dotToken`,
`bottomFillToken`) — every other field is a discrete geometric or textual
choice: border style (solid/dashed) and weight (1px/1.5px), whether the
header dot is a hollow ring or a filled disc, which glyph (if any: `◇` `◐` `✓`
`⚠`) sits in the header, how wide the bottom-edge fill runs (0/64%/100%),
whether a diagonal stripe overlays the card, the card's own opacity
(100%/40%), and whether the title is struck through.

`lifecycleSignature()` strips the 3 token fields and joins the rest into one
string. **`assigned` and `specified` collide on that signature alone** — a
review finding caught this build drawing a Rate Limiter node with 2 diamonds,
1 from the `◇ AGENT`/`◇ AGENT DRAFT` badge `badgesFor` always draws for an
assigned node, and a 2nd, redundant one from this treatment's own
`headerGlyph`. The fix drops the inline glyph (`badgesFor`'s badge is the only
diamond now) and `hasGuaranteedBadge()` records that `assigned`'s
distinguishing mark is that guaranteed badge rather than a treatment field.
`anatomy.test.ts`'s "the 8 lifecycle states are mutually distinguishable by
geometry alone" block folds `hasGuaranteedBadge` into each state's
fingerprint before computing `new Set(fingerprints).size === 8` — a Set-size
check rather than 8 hand-typed expected strings, so 2 states silently
colliding cannot pass by coincidence, and a `not.toBe("◇")` guard over every
treatment plus an end-to-end single-diamond check on Rate Limiter in
`frame.anatomy.test.ts` are this bug's own regression tests. In 3 lines:
draft is the only dashed/hollow-dot state; assigned is marked by its
guaranteed badge alone, and the other 4 in between differ by which header
glyph they draw (if any) and how wide the bottom fill runs (0/64%/100%);
accepted, stale and deprecated each add one more geometric fact on top (1.5px
border, a stripe overlay, or 40% opacity+strikethrough) that no other state
shares.

## 3. Acceptance conditions (PRD §17 Wave 4)

| Condition | Result |
|---|---|
| Node anatomy — badge set, count strings, caption strings, wedge glyphs | **Pass.** Every closed-set badge, every count string PRD §12.6 lists, the one-caption-per-state priority rule, and the header glyphs (`✓`/`◐`/`⚠`, folded into `LifecycleTreatment.headerGlyph`) are built and unit-tested in `anatomy.test.ts`; the Service Schematic fixture exercises most of them end to end in `frame.anatomy.test.ts`. |
| 8 lifecycle treatments | **Pass.** All 8 built, table in §2 above. |
| 4 health wedges, including the service roll-up in words | **Pass**, with a caveat. The 4 wedge treatments (none/amber/red/neutral) are built and drawn from the fixture (`clock-skew` and `rate-limiter` draw the neutral no-data wedge, `audit-emitter` draws amber). `healthRollupFor` — the "worst contained: N ... trending" words — is built and unit-tested against a synthetic document, but **not reachable through this wave's own Service Schematic fixture**: no node in `AUTH_SERVICE_GRAPH` is `service`-kind (only `module`), since the Stack Schematic that would draw a `service` node is Wave 5's. See §4 assumption 3. |
| 3 zoom tiers | **Pass.** `zoomTierFor` and the CSS `data-zoom-tier` rules in `engine.css`. See §4 assumption 6 for where the tier boundaries sit and why. |
| Every lifecycle state draws distinctly with colour removed — tested, not asserted | **Pass.** §2 above; the Set-size proof is in `anatomy.test.ts`. |
| Health wedge never overlaps the node menu | **Pass, and now actually the geometry that draws.** `headerOccupants` places the 2 rects by construction (menu shifted left of the wedge by its own width plus a 4px gap), and `anatomy.test.ts` proves no overlap across 9 node widths from 54px (the smallest this app ever draws, WIREFRAME-EXTRACT.md §2.4's own 22%-tier card) up to 452px (the widest preset box); `frame.anatomy.test.ts` repeats the check over every node the fixture actually draws. **A review finding caught this proof running against a function nothing rendered from** — `SchematicCanvas.tsx` positioned the wedge and menu with fixed CSS offsets, kept "in step" with `headerOccupants` only by a comment. Fixed: both are now positioned by an inline style computed from `headerOccupants` itself (scaled by zoom, `rectStyle()`), and `engine.css` no longer states a position for either — there is exactly 1 source of truth for the geometry now, and it is the tested one. |
| Border weight and overlay geometry survive at 22% zoom | **Pass.** `frame.anatomy.test.ts`'s own block asserts every node's `borderWidthPx`, `borderStyle`, `overlayStripe`, `bottomFillPct` and `health` are identical at zoom 1 and zoom 0.22, and that every node's `zoomTier` reads `"geometry"` at 0.22. |
| Every badge, count, and caption `fixtures/saas-backend` can produce draws from that fixture | **Pass, against this app's stand-in only — see the note at the top of this handoff.** The real fixture lives solely inside `crates/schematify-core`, has never been read by any front-end wave, and is not on this branch. `graph/fixture.ts`'s `AUTH_SERVICE_GRAPH` gained every anatomy field WIREFRAME-EXTRACT.md §1.1 draws for the auth-service screen, and `frame.anatomy.test.ts` checks each node's drawn badges/counts/captions against that section's literal strings, paired with a check on the fixture's own input field per node — but every one of those checks needs re-running against real data once the real loader lands. |
| Unit test for FRONTEND and EXTERNAL badges (fixture holds no such node) | **Pass.** `anatomy.test.ts`, "draws the FRONTEND and EXTERNAL layer badges" — builds a bare node with `layer: "frontend"`/`"external"`, asserts the input field first, then the badge. |
| `pnpm verify` | **Pass** for every foreground piece (`build`, `test:js`, `lint:js`, `lint:comments`, `lint:version`, `lint:identity`, `lint:branding`, `format:check`). `test:rust`/`lint:rust` running in the background — no Rust file was touched this wave, so no regression is expected; this handoff will be updated if either surprises. |

## 4. Assumptions, every one of them

0. **`fixtures/saas-backend/` does not exist on this branch.** Read PRD §17
   Wave 4's fixture-badge acceptance condition against `graph/fixture.ts`'s
   `AUTH_SERVICE_GRAPH` instead, the same reading Wave 3 already gave the
   dense fixture (its handoff, assumption 10). Cheap to reverse: a real
   loader replaces `loadGraph()`'s body only, per that file's own doc comment.
1. **`◇ AGENT DRAFT` supersedes the plain `◇ AGENT` badge** when a node is
   both `assigned` and agent-authored at once. PRD §12.6's table gives the 2
   badges 2 separate conditions with no stated precedence, but
   WIREFRAME-EXTRACT.md §1.1's Rate Limiter — `assigned` and agent-authored —
   draws only 1 diamond, not 2 side by side. `badgesFor` reads that as the
   more specific badge winning.
2. **A node's default lifecycle, absent from its data, treats as `specified`**
   (solid border, neutral dot, no bottom fill) — `frame.ts`'s `drawNode` does
   `LIFECYCLE_TREATMENTS[node.lifecycle ?? "specified"]`. No source states a
   default; `specified` is the least-marked of the 8 treatments, and several
   fixture nodes (`http-entry`, `token-issuer`, `token-verifier`, `jwks-cache`,
   `session-store`, `session-codec`, `session-index`) carry no `lifecycle`
   field, matching Wave 3's own "the box drawn today is deliberately plain."
3. **The service health roll-up's exact wording is a generalisation from 1
   drawn example.** WIREFRAME-EXTRACT.md §1.1 draws
   `worst contained: 1 soft budget trending` once, for Auth Service on the
   Stack Schematic. No source gives the wording for a hard-fail or no-data
   roll-up; `healthRollupFor` reads `hard budget failing` and `no run data` by
   the same pattern. Untested against a real fixture this wave (see the
   acceptance table above); tested directly against a synthetic document.
4. **The lifecycle dot's per-state fill colour is a redundant cue, exactly as
   WIREFRAME-EXTRACT.md's own §10.3 resolution rules** (2.2's note, §8.2's
   ruling) — never the sole distinguishing signal, and deliberately excluded
   from `lifecycleSignature`'s colour-blind proof.
5. **`--kv-warn-wash`, `--kv-accent-wash` and `--kv-ok-wash`** (new tokens in
   `tokens.css`) are `color-mix()` derivations of the existing solid tokens
   rather than the wireframe's own literal `rgba(...)` values, for the same
   reason Wave 2 derived `--kv-bg-root` and `--kv-accent-hover`: a value that
   appears nowhere inside a product screen does not earn `[W]`. `--kv-warn-wash`
   specifically (the `stale` overlay stripe) has no wireframe-drawn value to
   derive from at all and is `[P]` on that basis.
6. **The 3 zoom tiers' boundaries sit at `>0.55` (full), `>0.22` (mid), else
   geometry — not literally at the wireframe's 3 reference points of
   100%/55%/22%.** Reading them that literally would drop the facet row at
   the Service Schematic's own default 68% zoom (`SERVICE_CONFIG.zoom.initial`),
   contradicting WIREFRAME-EXTRACT.md §1.1, which draws facet counts on that
   exact screen at that exact zoom. `anatomy.ts`'s `zoomTierFor` doc comment
   carries the full reasoning.
7. **Content-derived box growth (24/16/14/16px per row) is an engineering
   estimate**, not a wireframe-measured constant — no source gives a
   per-row-height ladder to derive one from, only 1 finished box size per
   drawn node (WIREFRAME-EXTRACT.md §1.2).
8. **The node-menu control's own size (12px) and inset (4px) are `[P]`** — no
   wireframe measures the `[⋯]` control itself, only that it "sits inside the
   header row."

## 5. What a human must look at

No browser was available this wave either — same limit Wave 3's handoff
records, and the same reason `SchematicCanvas.tsx` carries no test of its
own. Open Schematify's `auth-service` Service Schematic (the default view) and
look for:

1. **The 8 lifecycle treatments, in mixed company.** `clock-skew` (draft:
   dashed border, hollow dot, no fill), `token-issuer`/`http-entry`/others
   with no `lifecycle` set (specified treatment), `rate-limiter` (assigned:
   exactly 1 diamond — the `◇ AGENT DRAFT` badge chip and its caption, and no
   2nd inline glyph in the header), `password-hasher` (reviewed: `◐` glyph,
   100%-width neutral bottom fill),
   `crypto-primitives` (accepted: 1.5px green border, `✓` glyph, saturated
   fill), `audit-emitter` (stale: 1.5px border, diagonal amber stripe, `⚠`
   glyph, 2-line caption). Nothing in the fixture is `deprecated`, so that
   treatment (40% opacity, struck title) is unverified on screen — build one
   by hand if you want to see it.
2. **The health wedge's exact corner**, on `audit-emitter` (amber) and
   `clock-skew`/`rate-limiter` (neutral no-data) — confirm it sits at the very
   top-right corner and the `[⋯]` node menu is visibly clear of it, not just
   non-overlapping by the numbers.
3. **Wheel-zoom down to roughly 20-25%** on the whole Schematic and confirm
   text disappears (title, slug, description, facets, captions) while every
   border, the bottom-edge fill, and `audit-emitter`'s diagonal stripe stay
   visible.
4. **`token-verifier`'s `contains 2` caption**, on the expanded parent box
   holding `jwks-cache` and `clock-skew` — distinct wording from
   `session-store`'s `collapsed · 2 children` on its own collapsed box.
5. **`session-store`'s roll-up caption reads `1 edge aggregated`, not `3`.**
   This is a known, explained divergence from WIREFRAME-EXTRACT.md §1.1's
   drawn `3 edges aggregated` — see §3's acceptance-table note and
   `frame.anatomy.test.ts`'s own comment on the Session Store block. The
   stand-in fixture's edge topology is Wave 3's own construction, not a real
   loader's, and PRD §0.4 makes the computed value the truth over a drawn one
   in exactly this situation.
6. **Badge chip layout when a node has several at once** — no fixture node
   this wave draws more than 1 badge, so multi-badge wrapping is
   unverified; the CSS (`kv-node__badges`, `flex-wrap: wrap`) is written for
   it but nobody has seen it.

## 6. Left undone, on purpose

- **The service health roll-up is untested against a real running
  Schematic** — no `service`-kind node exists until Wave 5's Stack Schematic.
- **Content-derived box growth is not wireframe-matched per node** — it grows
  a base box by fixed row amounts rather than reproducing
  WIREFRAME-EXTRACT.md §1.2's exact per-node pixel table. No acceptance
  condition asks for pixel parity with that table; matching it exactly would
  mean hardcoding 12 one-off sizes rather than a rule Wave 5 can reuse for
  facet cards.
- **The `[⋯]` node menu draws but does nothing** — no click handler, no menu
  content. PRD §12.6 only asks for the control to sit in the header row; what
  it opens is Inspector-adjacent, Wave 6 territory.
- **`EXPORTED`, `HARD`, `SOFT` and `MODULE ROOT · CANNOT BE DELETED` are
  built and unit-tested but not fixture-exercised** — no facet-kind node or
  module-root node exists in the Service Schematic pipeline this wave; Wave
  5/6 build the Module Schematic that draws them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EkL1TAeCe1DYp1FZFRhfXQ
