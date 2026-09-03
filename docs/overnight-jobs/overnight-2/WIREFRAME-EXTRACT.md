# Wireframe extraction — the six Schematify screens

This document distills `Forger Wireframes.html` so that later waves never have to
open the 670 KB export themselves. It is produced against PRD section 15's file
list: `1a Service canvas`, `1b Node anatomy`, `1c Inspector tabs`,
`1d Module canvas`, `1e Stack canvas`, `1f Module dashboard`.

**Method.** The export is a single line per `<script>` block containing an
HTML-in-JSON string (`\"`, `/`, `\n` escapes). Each screen's
`data-screen-label` attribute marks an exact byte offset. The six regions were
extracted by byte range and unescaped back to literal HTML, then read in full.
No content was skipped or summarized from a distance.

**Markers.** `[W]` = read directly from the wireframe (this document, section
0.3 of the PRD). `[P]` = this document's own inference or judgment call, never
a wireframe fact. An unmarked table cell inside a "strings" or "values" table is
`[W]` by default, since the whole point of those tables is transcription.

---

## 1. Screen 1a — Service canvas (tier 2)

Wireframe caption: `Service canvas (tier 2) — nesting, dependency edges,
groups, comments, refused drop, problems open` [W]. Card width `1920px`,
content height `1012px` [W].

### 1.1 Strings, in reading order

| Region | String |
|---|---|
| Title bar | `saas-backend` |
| Title bar | `~/work/saas-backend · main · 3 uncommitted` |
| Title bar window controls | `–` `□` `✕` |
| Tab strip | `SDD` (active tab, accent-colored) |
| Tab strip | `Files` |
| Tab strip | `Journeyman` |
| Tab strip | `Forger` (active, with a small red status dot) |
| Tab strip | `Terminal` |
| Tab strip search | `Search all apps` |
| Tab strip search | `Ctrl+K` |
| Breadcrumb | `Stack` |
| Breadcrumb | `Auth Service` |
| Breadcrumb slug line | `auth-service` |
| Toolbar | `Search nodes, methods, markers…` |
| Toolbar | `Auto-sort` |
| Toolbar | `Fit` |
| Outline header | `OUTLINE — CONTAINMENT` |
| Outline rows | `auth-service` |
| Outline rows | `http-entry` with badge `ENTRY` |
| Outline rows | `token-issuer` |
| Outline rows | `token-verifier` (selected row) |
| Outline rows | `jwks-cache` |
| Outline rows | `clock-skew` |
| Outline rows | `session-store` with trailing count `2` |
| Outline rows | `crypto-primitives` |
| Outline rows | `password-hasher` |
| Outline rows | `rate-limiter` |
| Outline rows | `audit-emitter` with badge `STALE` |
| Outline footer | `12 nodes · depth 3` |
| Edge legend (in-canvas SVG labels) | `depends_on` |
| Edge legend (in-canvas SVG labels) | `implements` |
| Edge legend (in-canvas SVG labels) | `references_ui` |
| Group box | `▾` `Token pipeline` `group · annotation` |
| Node: HTTP Entry | `HTTP Entry` / `http-entry` / `📌 ENTRY POINT` / `4 exports` |
| Node: Token Issuer | `Token Issuer` / `token-issuer` / `Mints access and refresh pairs, binds them to a session record.` / `⬤ 3 meth` `⬤ 5 test` `⬤ 2 budg` / `▸ jose` `▸ zod` |
| Node: Token Verifier (collapsed group-style box) | `▾` `Token Verifier` `token-verifier` `contains 2` |
| Node: JWKS Cache | `JWKS Cache` / `jwks-cache` / `⬤ 2 meth` `⬤ 6 test` |
| Node: Clock Skew | `Clock Skew` / `clock-skew` / `draft · no run data` |
| Node: Session Store | `▸` `Session Store` / `session-store` / `collapsed · 2 children` / `3 edges aggregated` |
| Node: Crypto Primitives | `Crypto Primitives` / `crypto-primitives` / `SHARED · AT LCA` / `2 dependents` / `⬤ 6 meth` `⬤ 14 test` `⬤ 1 budg` |
| Node: Password Hasher | `Password Hasher` / `password-hasher` / `Argon2id hashing with per-tenant cost parameters.` / `reviewed · awaiting accept` |
| Node: Rate Limiter | `Rate Limiter` / `rate-limiter` / `◇ AGENT DRAFT` / `Pre-filled by agent. Not reviewed.` |
| Node: Audit Emitter | `Audit Emitter` / `audit-emitter` / `⚠ STALE — upstream contract changed` / `crypto-primitives.sign changed 2h ago. Re-review required.` |
| Comment box | `COMMENT · ANNOTATION` `m.ross` `Two caches here on purpose — the JWKS one is remote-backed, the skew one is not. Don't merge.` |
| Drop-refused toast | `✕` `Drop refused` / `A comment is annotation tier. It cannot carry covers or any semantic edge.` |
| Screen reference chip | `◈ JOURNEYMAN` `screen/login-form` |
| Export strip header | `EXPORTED INTERFACE` `4 · authored` |
| Export strip rows | `issue_pair` → `token-issuer` |
| Export strip rows | `verify_signature` → `token-verifier ←` (selected, marker on owning row) |
| Export strip rows | `revoke` → `session-store` |
| Export strip rows | `check_password` → `password-hasher` |
| Export strip footer | `Everything not listed is internal by construction.` |
| Zoom readout | `68%` |
| Zoom/legend footer | `contains = nesting · depends_on = drawn` |
| Inspector tabs | `Identity` (active) `Lifecycle` `Contract` `Tests` `More` |
| Inspector Identity | `TITLE` → `Token Verifier` |
| Inspector Identity | `SLUG` → `token-verifier` |
| Inspector Identity | `DESCRIPTION` → `Verifies JWT signatures against the rotating key set, tolerating bounded clock skew between issuer and verifier.` |
| Inspector Identity | `OPAQUE ID` → `0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8` with `copy` |
| Inspector Identity | `KIND` → `module` |
| Inspector Identity | `LAYER` → `backend` |
| Inspector Identity | `DECISIONS` → `decision://DEC-TEC-AUTH-004` |
| Inspector footer | `Open module canvas` `Assign` |
| Dock tabs | `Problems` with badges `3` `2` |
| Dock tabs | `Runs` `Registries` `Rules` |
| Dock header note | `Errors first · never hidden` |
| Problems columns | `SEVERITY` `RULE` `NODE` `LOCATION` |
| Problems row 1 | `● ERROR` / `Dependency graph is acyclic` / `session-codec → token-issuer → …` / `Stack › Auth Service` |
| Problems row 2 | `● ERROR` / `Budget declared without a probe` / `token-verifier · cold_start_p95` / `› Token Verifier` |
| Problems row 3 | `● ERROR` / `Annotation node carrying a semantic edge` / `comment "Two caches here…"` / `Stack › Auth Service` |
| Problems row 4 | `▲ WARN` / `Shared node sits above the LCA of its dependents` / `crypto-primitives` / `Stack › Auth Service` |
| Problems row 5 | `▲ WARN` / `Contract method with no covers edge` / `token-issuer.mint` / `› Token Issuer` |
| Status bar | `sdd/ · 12 nodes · 9 edges` |
| Status bar | `layout/auth-service.json clean` |
| Status bar | `3 errors · 2 warnings` |
| Status bar | `run #1184 · 2h ago` |
| Callout (annotation, not product copy) | `edge routing: orthogonal, crosses group borders, never enters a sibling box` / `collapsed parent aggregates edges to its own border (session-store)` / `panel split 238 / flex / 360, dock 196` / `exports pinned as a right-edge strip inside the canvas` |

### 1.2 Layout

| Region | Dimension (CSS) |
|---|---|
| Title bar | `height:34px` |
| Tab strip | `height:36px` |
| Breadcrumb/toolbar bar | `height:40px` |
| Outline | `width:238px` |
| Schematic (canvas SVG viewBox) | `0 0 1320 700` |
| Inspector | `width:360px` |
| Bottom dock | `height:196px` |
| Status bar | `height:22px` |
| Export strip (pinned right edge inside canvas) | `width:160px`, inset from `left:1160px` inside a 1320-wide canvas |
| Group box (Token pipeline) | `width:452px;height:330px`, dashed `1px #3a404b`, `border-radius:4px` |
| Grid dots | `background-size:22px 22px` |

Node boxes (left, top, width, height, all `px`, absolute inside the canvas):

| Node | left | top | width | height |
|---|---|---|---|---|
| HTTP Entry | 16 | 280 | 152 | 96 |
| Token Issuer | 222 | 70 | 204 | 124 |
| Token Verifier (group-style) | 222 | 210 | 410 | 130 |
| JWKS Cache | 238 | 252 | 182 | 74 |
| Clock Skew | 434 | 252 | 182 | 74 |
| Session Store | 700 | 40 | 226 | 104 |
| Crypto Primitives | 700 | 170 | 210 | 120 |
| Password Hasher | 946 | 170 | 200 | 120 |
| Rate Limiter | 200 | 396 | 204 | 118 |
| Audit Emitter | 432 | 396 | 204 | 118 |
| Comment (m.ross) | 676 | 400 | 230 | 100 |
| Drop-refused toast | 396 | 530 | 352 | auto |
| Screen-reference chip | 960 | 340 | 180 | 48 |
| Minimap-like thumbnail (bottom right, unlabeled) | 980 | 560 | 160 | 110 |

### 1.3 Colour, type, geometry as drawn

Hex colours present in this screen: `#14161a #1b1e24 #22262e #2c313b #3a404b
#4a505b #4f5663 #5b616c #5f95d9 #5fb37a #6d747f #949cab #956fd9 #c9ced8 #d9635f
#d98a3f #d9a93f #e4e7ec`.

`#5f95d9` appears exactly once in this screen, as the color of the group's `▾`
collapse triangle text glyph — the only occurrence found across all six
screens (see Divergences, §7.6).

| Purpose | Value(s) drawn |
|---|---|
| Edge stroke, `depends_on` | `stroke:#6d747f` `stroke-width:1.25` solid, arrowhead fill `#6d747f` |
| Edge stroke, `implements` | `stroke:#6d747f` `stroke-width:1.25` `stroke-dasharray:5 4`, arrowhead hollow (`fill:#14161a;stroke:#6d747f`) |
| Edge stroke, `references_ui` | `stroke:#956fd9` `stroke-width:1.25` `stroke-dasharray:1.5 4`, arrowhead fill `#956fd9` |
| Edge stroke, cycle-conflict edge (session-codec → token-issuer) | `stroke:#d9635f` `stroke-width:1.5` `stroke-dasharray:4 3`, arrowhead fill `#d9635f` |
| Node border, default | `1px solid #2c313b` |
| Node border, entry point / accent | `1.5px solid #d98a3f` |
| Node border, health-passing accent | `1.5px solid #5fb37a` |
| Node border, draft/dashed | `1px dashed #3a404b` |
| Health wedge, amber | `background:#d9a93f`, 14px corner triangle via `clip-path:polygon(100% 0,100% 100%,0 0)` |
| Health wedge, red | same shape, `background:#d9635f` |
| Facet-count text | `#949cab` |
| Library chip text | `#5b616c` |
| Badge `ENTRY POINT` / `SHARED · AT LCA` bg | `rgba(217,138,63,…)` accent family / `rgba(95,179,122,.14)` ok family |
| Port ring, default | `border:1px solid #4f5663;background:#14161a` |
| Port ring, references_ui target | `border:1px solid #956fd9` |
| Port ring, error/comment | `border:1px solid #d9635f` |
| Problems `● ERROR` text | `#d9635f` |
| Problems `▲ WARN` text | `#d9a93f` |
| Font family throughout | `'IBM Plex Mono',monospace` (sans nowhere inside the screen) |
| Font sizes seen | `8px 8.5px 9px 9.5px 10px 10.5px 11px 11.5px 12px` |
| Font weights seen | `500` (tab-strip active label), `600` (titles) |
| Letter-spacing seen | `.06em` `.07em` |
| Border-radius seen | `2px` (badges), `3px` (nodes, controls), `8px` (dock count pill) |

---

## 2. Screen 1b — Node anatomy

Wireframe caption: `Node anatomy — eight lifecycle states, four health
wedges, three zoom levels` [W]. Card width `1180px`.

### 2.1 The anatomy reference node and its callouts, in reading order

Reference node drawn: **Token Verifier** / `token-verifier` / description
`Verifies JWT signatures against the rotating key set.` / facet row
`⬤ 3 methods` `⬤ 7 tests` `⬤ 2 budg` / library row `▸ jose` `▸ zod`.

Callout labels beside it, in order, each paired with its caption text:

| Callout label | Caption text |
|---|---|
| `header` | `lifecycle dot · title · node menu` |
| `slug` | `mono, dimmed, mutable, unique in parent` |
| `description` | `two lines, clamped` |
| `facets` | `counts only, tier 2 only` |
| `libraries` | `allowed_libraries, resolved from registry` |
| `wedge` | `health, from the latest ingested run` |
| `ports` | `in left, out right — edge drag targets` |
| `no uuid` | `never on the face — Inspector only` |

Note: this reference node uses the **long-form** facet labels (`3 methods`,
`7 tests`) [W], distinct from the **short-form** labels (`3 meth`, `5 test`,
`2 budg`) drawn on actual Schematic nodes in 1a/1d/1e. PRD 12.6 states
Schematify draws the short form; this reference card is the long-form
exhibit only, not a second drawn convention. [P]

### 2.2 Lifecycle states — the eight example cards

Heading: `LIFECYCLE — GEOMETRY CARRIES THE SIGNAL, NOT COLOUR`.

| # | Node shown | Slug | Border | Header dot fill | Header glyph | Bottom-edge fill | Legend caption |
|---|---|---|---|---|---|---|---|
| 1 | Clock Skew | `clock-skew` | `1px dashed #3a404b`, bg `rgba(27,30,36,.6)` | hollow, `1px solid #4f5663` | none | none | `draft — dashed, muted fill` |
| 2 | Session Store | `session-store` | `1px solid #2c313b` | solid `#949cab` | none | none | `specified — solid, neutral` |
| 3 | Rate Limiter | `rate-limiter` | `1px solid #2c313b` | solid `#949cab` | badge `◇ AGENT` | none | `assigned — agent glyph` |
| 4 | Token Issuer | `token-issuer` | `1px solid #2c313b` | solid `#d9a93f` | none | `64%` width, `2.5px`, `#d98a3f` | `implemented — filled edge` |
| 5 | Password Hasher | `password-hasher` | `1px solid #2c313b` | solid `#5fb37a` @ 55% opacity | `◐` | `100%` width, `2.5px`, `#3a404b` | `reviewed — half check` |
| 6 | Crypto Primitives | `crypto-primitives` | `1.5px solid #5fb37a` | solid `#5fb37a` | `✓` | `100%` width, `2.5px`, `#5fb37a` | `accepted — full check, saturated` |
| 7 | Audit Emitter | `audit-emitter` | `1.5px solid #5fb37a` + diagonal amber stripe overlay (`repeating-linear-gradient(135deg,rgba(217,169,63,.19) 0 6px,transparent 6px 13px)`) | solid `#5fb37a` | `⚠` amber | `100%` width, `2.5px`, `#d9a93f` | `stale — accepted + stripe` |
| 8 | Legacy Session | `legacy-session → session-store` | `1px solid #2c313b`, whole card `opacity:.4` | solid `#4f5663` | title struck through | none | `deprecated — 40%, struck` |

`[P]` The per-example header-dot fill color (grey for draft/specified/
assigned, amber for implemented, green for reviewed/accepted/stale, dim grey
for deprecated) is drawn but never named as a rule anywhere in the PRD or the
wireframe text. It may be illustrative-only rather than a header-dot-encodes-
state rule; flagged under Silences (§8.3).

### 2.3 Health wedges — the four example swatches

Heading: `HEALTH — SEPARATE CHANNEL, LATEST RUN ONLY`. Each swatch is a bare
`110px`-wide, `44px`-tall card.

| Caption | Wedge |
|---|---|
| `all passing` | none |
| `soft / test fail` | 15px amber (`#d9a93f`) corner triangle |
| `hard budget fail` | 15px red (`#d9635f`) corner triangle |
| `no run data` | 15px neutral (`#2c313b`) corner triangle |

### 2.4 Three zoom levels

Heading: `THREE ZOOM LEVELS — WHAT SURVIVES`.

| Caption | Card size | What is drawn |
|---|---|---|
| `100% — everything` | 186×106 | Full node: header, slug, description, facet counts, bottom-edge fill, health wedge |
| `55% — title, slug, state` | 116×58 | Header, slug, bottom-edge fill, health wedge — no description, no facet row |
| `22% — geometry only` | 54×28 | Border, bottom-edge fill, health wedge only — no text at all |

Callout text (annotation): `border weight + bottom edge fill + overlay stripe
survive to 22%; dots and text do not` / `health wedge is the only top-right
occupant, so it never collides with the node menu`.

---

## 3. Screen 1c — Inspector tabs

Wireframe caption: `Inspector — Contract, Tests, Budgets, populated` [W].
Card width `1220px`, three panels of `380px` each, side by side.

### 3.1 Tab strip (repeated identically atop each of the 3 panels)

`Identity` `Contract` `Tests` `Budgets` — no `Lifecycle`, no `More` tab in this
standalone exhibit (contrast with 1a's in-application 5-tab strip: `Identity
Lifecycle Contract Tests More`).

### 3.2 Panel 1 — Contract (active)

| Field | Value |
|---|---|
| Count header | `3 METHODS` |
| Toggle | `Signatures` / `OpenAPI` (OpenAPI shown active) |
| Method 1 | `verify_signature` badge `EXPORTED` · `(token: string, jwks: KeySet)` → `Result<Claims, VerifyError>` · `Rejects on expiry, unknown kid, or skew beyond the configured window.` · `✓ 4 covers edges` |
| Method 2 | `refresh_keys` · `(force?: boolean) → Promise<void>` · `✓ 3 covers edges` |
| Method 3 | `skew_window` · `() → Duration` · `▲ no covers edge from any test case` |
| Footer control | `+ add method` |

### 3.3 Panel 2 — Tests (active)

| Field | Value |
|---|---|
| Summary | `7 CASES` `5 passing` `1 failing` `1 unlinked` |
| Case 1 | `expired token is rejected` (green dot) · `given a token past exp` `when verify_signature runs` `then Err(Expired)` · `@forger:0192f4a1…a7b8 · linked · 41ms` |
| Case 2 | `unknown kid triggers one refetch` (red dot) · `linked, failing` `expected 1 fetch, saw 2` |
| Case 3 | `clock skew at the boundary` (dashed/hollow dot) · `Declared, no marker found in code. Different problem from a failing test.` · `Copy marker token` |

`[W]` `Copy marker token` is drawn **only on case 3** (the unlinked case), not
on cases 1 or 2. See Divergences §7.2 — PRD 12.12 claims it sits on every
case.

`[W]` The marker token literal is `@forger:0192f4a1…a7b8` — the retired app
name, unrenamed in the wireframe (expected per PRD 15).

### 3.4 Panel 3 — Budgets (active)

| Field | Value |
|---|---|
| Summary | `3 BUDGETS` · `run #1184 · 2h ago` |
| Budget 1 | `verify_p95` badge `HARD` · value `1.8 ms` · threshold `< 3 ms` · sparkline (green, trending down/good) |
| Budget 2 | `jwks_refetch_rate` badge `SOFT` · value `0.9 /min` · threshold `< 1 /min` · sparkline (amber, trending up toward the line) · note `trending to breach · sign-off required` |
| Budget 3 | `cold_start_p95` badge `HARD` · value `—` · body `No probe declared` / `An unmeasurable claim is a lint error, not a warning.` · controls `Add probe` `Drop budget` |

Callout text (annotation): `three tabs shown side by side; in the app they
occupy one 360–380px column` / `unlinked test and failing test are drawn as
different problems, per spec §6`.

---

## 4. Screen 1d — Module canvas (tier 3)

Wireframe caption: `Module canvas (tier 3) — root node, typed facets,
palette · plus the empty state` [W]. Card width `1500px`. This screen draws
**two states**: a populated Module Schematic (`height:600px` region) and,
below it, the empty first-run state (`height:296px` region).

### 4.1 Header strings

`Stack › Auth Service › Token Verifier` breadcrumb, no second slug line on
this header (contrast 1a). `tier 3 — deepest drill-down`. Controls:
`Module dashboard`, `Pre-fill with agent`.

### 4.2 Facet palette (left rail, `width:172px`)

`FACET PALETTE` heading, then in order: `contract-method`, `test-case`,
`budget`, `doc-block`, `external-dep`. Then `ANNOTATION` heading with
`comment`, `group`. Footer: `Drag onto the canvas, or let an agent draft and
review after.`

### 4.3 Root node

`Token Verifier` / `token-verifier` / badge `MODULE ROOT · CANNOT BE DELETED`
/ body `Same node as the box on the service canvas. One id, two renderings.`
/ two-line footer `layer backend · 4 facets` and `journeyman://screen/login-form`.

### 4.4 Facet cards drawn (7 total)

| Card kind | Header badge(s) | Content |
|---|---|---|
| `CONTRACT-METHOD` | `EXPORTED` | `verify_signature` · `(token: string, jwks: KeySet)` → `Result<Claims, VerifyError>` · `✓ 4 covers · matched in code` |
| `CONTRACT-METHOD` | none | `refresh_keys` · `(force?: boolean) → Promise<void>` · `✓ 3 covers · matched in code` |
| `BUDGET` | `HARD` | `verify_p95 < 3 ms` · `probe: pnpm bench:verify` · `1.8 ms · run #1184` |
| `DOC-BLOCK` | `◇ AGENT DRAFT` | `audience: agent · "Call verify_signature before any session lookup; the key set is cached and refreshed lazily…"` · controls `Accept` `Edit` `Discard` |
| `TEST-CASE` | none | `expired token rejected` · `passing` |
| `TEST-CASE` | none | `unknown kid refetches once` · `failing` |
| `EXTERNAL-DEP` | none | `jose@5.2.4` · `MIT · registry ✓` |

`[W]` No `skew_window` contract-method facet card is drawn on this canvas,
though 1c's Inspector Contract tab shows 3 methods for this same module
including `skew_window`. See Silences §8.1.

### 4.5 Edges drawn (with in-canvas text labels)

`[W]` Three edge-kind labels are drawn directly on the canvas next to their
lines: `contains` (root → each facet, grey `#6d747f`, mixed solid/dashed),
`covers` (green `#5fb37a`, test-case → contract-method), `satisfies` (green
`#5fb37a`, described in the callout box as node → budget). This directly
contradicts PRD 12.5's edge-style table, which states `contains` is "Not
drawn, expressed as nesting" everywhere. See Divergences §7.1.

### 4.6 Free-floating annotation boxes

`COVERAGE OF DESIGN` (heading colored `#5fb37a`) → `7 of 8 covers edges
present. skew_window has none — the number line coverage never reports.`

`SATISFIES` (heading colored `#949cab`) → `A dep can satisfy a budget. Edge
types at tier 3 are closed: covers, satisfies, documents.`

`[P]` No zoom-percent readout and no edge-kind legend chip (the kind drawn in
1a/1e's lower-left corner) appear anywhere on this canvas. See Silences §8.2.

### 4.7 Empty first-run state (below the populated canvas)

Heading above both states: `SAME CANVAS, EMPTY — FIRST RUN`.

Lead: `A module is one unit of implementable work.`

Body: `It carries a public contract, the test cases that cover it, resource
budgets with probes, and the libraries it may use. Three facets are
pre-seeded so the shape is obvious.`

Boundary note, headed `◈ NOT HERE`: `User-facing behaviour, flows and
wireframes belong in Journeyman. Forger references them; it does not hold
them.`

Three pre-seeded, dashed placeholder cards: `CONTRACT-METHOD` → `name the
first method…`; `TEST-CASE` → `given / when / then…`; `BUDGET` → `metric,
threshold, probe…`.

### 4.8 Layout and geometry

| Element | Dimension |
|---|---|
| Header bar | `height:40px` |
| Facet palette rail | `width:172px` |
| Populated canvas region | `height:600px`, SVG viewBox `0 0 1328 600` |
| Empty-state region | `height:296px` |
| Root node | `left:20 top:74 width:238` |
| Contract-method cards | `width:290` |
| Budget / doc-block cards | `width:290` |
| Test-case / external-dep cards | `width:136` |
| Coverage/Satisfies annotation boxes | `width:270` |
| Grid dots | `background-size:22px 22px` (same as 1a) |

---

## 5. Screen 1e — Stack canvas (tier 1)

Wireframe caption: `Stack canvas (tier 1) — services, nesting, rolled-up
health` [W]. Card width `1920px`, height `820px`.

### 5.1 Strings, in reading order

| Region | String |
|---|---|
| Title bar | `saas-backend` / `~/work/saas-backend · main` (**no** `· N uncommitted` suffix here — see Divergences §7.4) |
| Tab strip | `SDD` `Files` `Journeyman` `Forger` `Terminal` `Search all apps` `Ctrl+K` (identical to 1a) |
| Header | `Stack` |
| Header count | `6 services · 7 dependency edges` |
| Toolbar | `Search nodes, methods, markers…` `Auto-sort` (**no** `Fit` control drawn — matches PRD 12.1's claim that Schematify adds `Fit` here as [P]) |
| Outline header | `OUTLINE — SERVICES` |
| Outline rows | `api-gateway` badge `ENTRY` |
| Outline rows | `platform-core` |
| Outline rows | `auth-service` (selected, indented under platform-core) |
| Outline rows | `session-service` (indented under platform-core) |
| Outline rows | `billing-service` |
| Outline rows | `notification-service` |
| Outline rows | `event-bus` |
| Node: API Gateway | `API Gateway` / `api-gateway` / badge `EDGE` / `📌 ENTRY` / `11 exports` `4 modules` |
| Group: Platform Core | `▾ Platform Core` / `platform-core · contains 2` |
| Node: Auth Service | `Auth Service` / `auth-service` / `✓` / `BACKEND` `4 exports` `12 modules` / `worst contained: 1 soft budget trending` |
| Node: Session Service | `Session Service` / `session-service` / `DATA` `2 exports` `6 modules` |
| Node: Billing Service | `Billing Service` / `billing-service` / `BACKEND` `6 exports` `9 modules` |
| Node: Notification Service | `Notification Service` / `notification-service` / `draft · 0 exports authored` |
| Node: Ledger Store | `Ledger Store` / `ledger-store` / `DATA` `3 exports` `schemas ✓` |
| Node: Event Bus | `Event Bus` / `event-bus` / `✓` / `SHARED · AT LCA` `4 dependents` |
| Annotation box | `WHY EVENT-BUS SITS HERE` / `Four consumers, so its containment parent is their lowest common ancestor — the stack root — not any one of them. Same rule at tier 2.` |
| Zoom readout | `100%` |
| Zoom/legend footer | `click a service to drill into its modules` |
| Inspector empty state header | `CANVAS PROPERTIES` |
| Inspector empty state body | `Nothing selected. The inspector shows canvas-level properties: 6 services, 7 dependency edges, containment depth 2, layout saved 4m ago.` |
| Derived tech stack header | `DERIVED TECH STACK` |
| Tech stack rows | `jose` `5.2.4 · MIT` `6` |
| Tech stack rows | `zod` `3.23.8 · MIT` `14` |
| Tech stack rows | `argon2` `0.31 · Apache-2.0` `2` |
| Tech stack rows | `postgres` `3.4 · Unlicense` `9` |
| Tech stack footer | `Read-only. Derived from per-module allowed_libraries against the registry.` |
| Status bar | `sdd/ · 6 services` |
| Status bar | `3 errors · 2 warnings` |
| Callout | `health rolls up as the worst contained status, stated in words on the node, not just as a wedge` / `tech-stack view sits in the inspector's empty state, where it can't be mistaken for an editor` |

### 5.2 Layout

| Region | Dimension |
|---|---|
| Outline | `width:238px` |
| Schematic (SVG viewBox) | `0 0 1320 660` |
| Right panel (Inspector empty state + tech stack, combined) | `width:300px` |
| Grid dots | `background-size:26px 26px` (Stack tier uses the larger grid — `--kv-grid-size-stack`) |
| Status bar | `height:22px` |

Node boxes:

| Node | left | top | width | notes |
|---|---|---|---|---|
| API Gateway | 26 | 126 | 208 | accent border |
| Platform Core (group) | 300 | 66 | 260, h:290 | translucent container |
| Auth Service | 316 | 120 | 228 | health-ok green border, inside Platform Core |
| Session Service | 316 | 250 | 228 | inside Platform Core |
| Billing Service | 300 | 400 | 260 | amber wedge, 38% bottom fill |
| Notification Service | 300 | 526 | 260 | dashed/draft, grey wedge |
| Ledger Store | 660 | 92 | 240 | |
| Event Bus | 660 | 430 | 240 | health-ok green border |
| "Why event-bus" annotation | 980 | 260 | 250 | |

### 5.3 Edges drawn

`[W]` 8 `<path>` elements with arrowheads are drawn in the SVG, all
`stroke:#6d747f` `stroke-width:1.5`, no dashing, using marker `s1a`. `[P]`
Two of the eight terminate at the `WHY EVENT-BUS SITS HERE` annotation box
rather than at a node face (endpoints `x:980,y:300` and `x:980,y:336`), so
they read as pointer lines from Ledger Store and Event Bus to their
explanatory callout, not as `depends_on` edges. That leaves 6 lines that
connect node-to-node. Neither 6 nor 8 matches the drawn `7 dependency edges`
string. See Counts §9 and Divergences §7.5.

---

## 6. Screen 1f — Module dashboard

Wireframe caption: `Module dashboard — read-only record` [W]. Card width
`1500px`.

### 6.1 Strings, in reading order

| Region | String |
|---|---|
| Breadcrumb | `Stack › Auth Service › Token Verifier` |
| Header badge | `READ ONLY · THE RECORD OF WHAT HAPPENED` |
| Header path | `runs/0192f4a1-…-a7b8/` |
| Latest-run line | `LATEST RUN` `#1184 · 2026-08-25 14:02Z · 4f2c9ab · ci/verify.yml` |
| Counter 1 | `BUDGETS` `2 / 3` `1 hard budget has no probe` |
| Counter 2 | `TESTS` `5 / 7` `1 failing · 1 unlinked` |
| Counter 3 | `LINTER` `0` `14 rules · 0 violations` |
| Counter 4 | `RECONCILIATION` `7 / 8` `1 declared, absent` |
| Budget history heading | `BUDGET HISTORY — THRESHOLD DRAWN, SO A TREND IS VISIBLE BEFORE IT BREACHES` |
| Budget graph 1 | `verify_p95` `HARD` `1.8 ms · < 3 ms` · threshold line labeled `3 ms hard` |
| Budget graph 2 | `jwks_refetch_rate` `SOFT` `0.9 /min · < 1 /min` · threshold line labeled `1 /min soft` · note `Twelve runs of monotonic climb. Sign-off named: m.ross, run #1179.` |
| Reconciliation heading | `RECONCILIATION — GRAPH TWIN AT SYMBOL GRANULARITY` |
| Reconciliation columns | `OUTCOME` `SITE` `COUNT` |
| Reconciliation row 1 | `matched` `src/auth/verifier.ts +3 more` `7` |
| Reconciliation row 2 | `declared, absent` `skew_window — no marker` `1` |
| Reconciliation row 3 | `present, unknown` `—` `0` |
| Reconciliation row 4 | `duplicate` `—` `0` |
| Contract history heading | `CONTRACT CHANGE HISTORY — WHAT TRIGGERS STALENESS DOWNSTREAM` |
| Contract history row 1 | `25 Aug 11:40` `verify_signature returns Result, was throw` |
| Contract history row 2 | `19 Aug 09:12` `skew_window added` |
| Contract history row 3 | `02 Aug 16:55` `refresh_keys force flag added` |
| Contract history footnote | `The 25 Aug change dropped audit-emitter from accepted to stale. Resolved only by human re-review.` |
| Audit log heading | `LIFECYCLE AUDIT LOG — APPEND-ONLY` |
| Audit log columns | `WHEN` `TRANSITION` `ACTOR` `REASON` |
| Audit row 1 | `25 Aug 14:02` `reviewed → accepted` `m.ross · human` `Result type resolves the throw-on-expiry ambiguity.` |
| Audit row 2 | `25 Aug 11:40` `implemented → reviewed` `m.ross · human` `Contract amended during review.` |
| Audit row 3 | `24 Aug 22:18` `assigned → implemented` `◇ agent · claude-sdd` `All declared tests linked. 1 failing, flagged not asserted.` |
| Audit row 4 | `24 Aug 09:05` `reviewed → specified` `j.okonkwo · human` `Bounced: skew tolerance was unspecified.` |
| Audit row 5 | `21 Aug 15:31` `specified → assigned` `j.okonkwo · human` `Handed to agent.` |
| Audit log footnote | `No agent row in this log can read → accepted. That transition is human-only by construction.` |
| Callout | `nothing on this screen is editable — no inputs, no buttons that change state` / `the actor column names human vs agent on every row, so the accepted-is-human-only rule is auditable by eye` |

`[W]` The audit-log footnote's exact wording (`No agent row in this log can
read → accepted. That transition is human-only by construction.`) is not
quoted anywhere in PRD 12.13, which only paraphrases it as "the footnote
states the human-only guarantee from section 7.3." This is a Silence, not a
contradiction — record the literal string here for later waves.

### 6.2 Layout

| Region | Dimension |
|---|---|
| Header bar | flex row, `padding:13px 18px` |
| Counter cards | 4-column grid, `repeat(4,1fr)`, `gap:12px` |
| Budget-history column | `flex:1` |
| Reconciliation/contract-history column | `width:520px` |
| Reconciliation table columns | `130px 1fr 58px` |
| Audit log columns | `126px 190px 150px 1fr` |
| Budget sparkline SVG | viewBox `0 0 620 96`, `preserveAspectRatio="none"` |

Counter card left-border accent colours: Budgets `#d9635f`, Tests `#d9635f`,
Linter `#5fb37a`, Reconciliation `#d9a93f`. Counter value font: `20px` bold
(the largest size seen in any of the six screens) with the `/ N` suffix at
`14px`, colour `#5b616c`.

---

## 7. Divergences

Per PRD 0.2, the wireframe wins in every row below; the PRD's text becomes
the error to fix at the point cited.

| # | PRD statement | Wireframe fact | Screen |
|---|---|---|---|
| 7.1 | 12.5: "`contains` — Not drawn, expressed as nesting" (stated as universal, no tier exception) | The Module Schematic (tier 3) draws visible `contains` edges — grey lines with arrowheads and an inline `contains` text label — from the root node to each facet card. Nesting-only rendering of `contains` holds at tier 1 and tier 2 (1e, 1a) but not at tier 3. | 1d |
| 7.2 | 12.12: "A `Copy marker token` control sits on every case." | Drawn on only 1 of the 3 test cases in the Tests tab — the unlinked case (`clock skew at the boundary`). The passing and failing linked cases show no such control. | 1c |
| 7.3 | 13.3: `--kv-accent-hover` `#e8a862` marked `[W]`, "appears once in the wireframes, … as a text color." 13.1: `--kv-bg-root` `#0e1013` marked `[W]`, "Behind the application frame." | Neither hex value occurs anywhere inside the 6 screen regions. Both occur only in the wireframe **document's own page chrome** (`body{background:#0e1013}` and `a:hover{color:#e8a862}`, byte offsets 543173/543135, ahead of the first screen at byte 544907) — the design tool's own styling, not product surface. `--kv-accent-hover` is correctly marked `[P]` in the same table row's prose, but its provenance column says `[P]` too — so this is a labeling-consistency note rather than a contradiction. `--kv-bg-root`'s `[W]` label is unsupported by any of the 6 screens. | none (document chrome only) |
| 7.4 | 12.1: "The count string shows when the count is above 0 and hides at 0. The Service Schematic draws `· 3 uncommitted`. The Stack Schematic draws no count." | Confirmed exactly as stated — 1a's title bar draws `· 3 uncommitted`, 1e's does not draw any uncommitted-file count. Not a divergence; recorded here because it is easy to mis-scan as one. | 1a, 1e |
| 7.5 | 16.4 lists two arithmetic conflicts. A third exists: the Stack Schematic's header and Inspector empty state both draw `7 dependency edges`, but the canvas SVG holds 8 `<path>` elements, of which 2 appear to point at the `WHY EVENT-BUS SITS HERE` annotation box rather than at a node-to-node dependency. Neither the "8 raw paths" reading nor the "6 node-to-node" reading equals the drawn `7`. | Ambiguous — flagged for an owner decision alongside the two 16.4 rows, not resolved here. | 1e |
| 7.6 | 13.3 groups `#e8a862` and `#5f95d9` together as "appear once each … both as a text color." | `#5f95d9` **is** found inside a screen (1a, the group-box `▾` triangle glyph) — that half of the claim holds. Only the `#e8a862` half is unsupported (see 7.3). | 1a |

## 8. Silences

### 8.1 PRD describes, wireframe never shows (unverified proposals — [P] until a wireframe confirms them)

| Element | PRD source | Note |
|---|---|---|
| Inspector — Lifecycle, Dependencies, Docs, References tabs | 12.12, S-05/S-09/S-10/S-11 | None of the 6 screens populate these tabs; only their existence as tab labels is confirmed (Lifecycle appears as a label in 1a; the other three are never even labeled in any screen). |
| Global search overlay (S-18), Library/Rule registries as tables (S-15/S-16), Screen registry, Flow editor, Project brief, Decision log, Review queue, Node-kind registration | 12.14–12.19 | Entirely undrawn. This document is their only source, as PRD 12.2 already states. |
| Minimap | 12.3 | Explicitly marked `[P]` in the PRD ("No wireframe draws a minimap") — confirmed true across all 6 screens. |
| Section switcher (`Design` / `Product` / `Decisions`) above the Outline tree | 12.1 | Marked `[P]` in the PRD — confirmed absent from both 1a's and 1e's Outline panels. |
| `FRONTEND`, `EXTERNAL` layer badges | 12.6 badge table, marked `[P]` | Confirmed absent — only `EDGE`, `BACKEND`, `DATA` badges appear anywhere (1a, 1e), all `[W]`. |

### 8.2 Wireframe shows, PRD section 12 never mentions (truth the PRD omitted)

| Element | Screen | Detail |
|---|---|---|
| `skew_window` contract-method has no facet card on the Module Schematic canvas, despite being one of the module's 3 methods (per 1c's Inspector) | 1d | The card set on canvas (7 cards) skips this method entirely; PRD 12.11 never notes the gap. |
| No zoom-percent readout and no edge-kind legend chip on the Module Schematic | 1d | 1a and 1e both draw a lower-left `NN% | legend text` chip; 1d has neither. PRD 12.1 says the Module Schematic legend "reads `contains`, `covers`, `satisfies`" (implying a legend UI element) but no such chip is drawn — the three edge kinds appear only as inline SVG text beside their own lines. |
| Distinct header-dot fill colour per lifecycle-state example in 1b (grey / amber / green-dim / green-full / dim-grey) | 1b | See §2.2 note — not named as a rule anywhere; may be incidental to the example set rather than a drawn convention. |
| A small unlabeled thumbnail/diagram in the lower-right of 1a (icons suggesting a dependency-map thumbnail) | 1a | Positioned where PRD 12.3's `[P]` minimap would go, but it is not a minimap (no error/health marks per 12.3's spec) and is not captioned. Likely decorative or an illustration of "what a minimap could show" rather than product chrome — treat as undecided, not as minimap evidence. |
| Session Store node in 1a and Platform Core group in 1e both use **1.5px** port-ring borders where ordinary nodes use 1px | 1a, 1e | Not called out by the PRD's node-anatomy section; may signal "group/collapsed" state visually beyond the badges already documented. |

### 8.3 Open interpretive question

The lifecycle reference dots in 1b (§2.2) are the one place this extraction
could not resolve confidently: they may encode lifecycle state, may encode
health, or may simply be illustrative color variety with no encoded meaning.
Recommend Wave 4 treat this as unspecified and default to the geometry-only
rule PRD 12.7 already states, rather than inventing a dot-color rule.

## 9. Counts

Per PRD 0.4, every count below is a drawing, not a stored value. Listed so a
later agent can tell whether its computed output matches the picture (a
confirmed `[W]` match) or reproduces a known conflict (flagged).

| Drawn string | Screen | Computed-value cross-check |
|---|---|---|
| `3 uncommitted` (title bar) | 1a | No cross-check possible from the six screens alone; carried from the fixture. |
| `12 nodes · depth 3` (Outline footer) | 1a | Matches the 12-module fixture table in PRD 16.1. |
| `EXPORTED INTERFACE` `4 · authored` | 1a | Matches the 4-row export strip drawn immediately below it, and PRD 16.1's "Export strip: 4 · authored." |
| `sdd/ · 12 nodes · 9 edges` (status bar) | 1a | Node count (12) matches the Outline footer; edge count (9) has no independent on-screen tally to check against — carried from PRD 16.1's "9 dependency edges." |
| `Problems` badges `3` `2` | 1a | Matches the 5 drawn problem rows exactly: 3 `● ERROR` rows, 2 `▲ WARN` rows. |
| `3 errors · 2 warnings` (status bar) | 1a | Same 5 rows — consistent with the dock badges. |
| `⬤ 3 meth ⬤ 5 test ⬤ 2 budg` (Token Issuer node) | 1a | No independent Inspector/dashboard view of Token Issuer in these 6 screens to cross-check against. |
| `6 services · 7 dependency edges` (header) | 1e | **Conflict, per PRD 16.4 row 1.** The Outline lists 6 rows of kind `service` plus 1 of kind `group` (`platform-core`) — but the fixture table (PRD 16.1) and the canvas itself both include `ledger-store` as an 7th `service`-kind node, which the Outline omits entirely (see §8.2 — no, this is a genuine Outline omission, tracked here as a count-relevant fact). Computed service count = 7. Edge count: 8 raw `<path>` elements drawn, of which 2 appear to terminate at an annotation box rather than a node — see §7.5. |
| Inspector empty state: `6 services, 7 dependency edges, containment depth 2` | 1e | Same `6 services` conflict as the header. `containment depth 2` matches the two-level nesting drawn (Platform Core → Auth/Session Service; Ledger Store nested inside Session Service would make depth 3, another facet of the same undercount). |
| `sdd/ · 6 services` (status bar) | 1e | Repeats the same `6 services` conflict a third time on this screen. |
| Derived tech stack module counts: `jose 6`, `zod 14`, `argon2 2`, `postgres 9` | 1e | Matches PRD 16.1's derived tech stack table exactly. |
| `layer backend · 4 facets` (module root) | 1d | **Conflict, per PRD 16.4 row 2.** 7 facet cards are drawn on the same canvas (2 contract-method, 1 budget, 1 doc-block, 2 test-case, 1 external-dep). Computed facet count = 7. |
| `COVERAGE OF DESIGN`: `7 of 8 covers edges present` | 1d | Internally consistent with the 3 contract-methods (2 covered, 1 — `skew_window` — with 0 covers per 1c) only if the module has 8 covers-edges total across all its methods; not independently verifiable from what's drawn on this canvas alone (skew_window has no card here). |
| `3 METHODS` (Contract tab) | 1c | Matches the 3 method blocks drawn directly below it (`verify_signature`, `refresh_keys`, `skew_window`). |
| `7 CASES` / `5 passing` `1 failing` `1 unlinked` (Tests tab) | 1c | Only 3 of the 7 cases are drawn; the summary numbers are not independently checkable from this screen but match PRD 16.1's fixture text exactly. |
| `3 BUDGETS` (Budgets tab) | 1c | Matches the 3 budget rows drawn (`verify_p95`, `jwks_refetch_rate`, `cold_start_p95`). |
| Dashboard counters: `2 / 3` budgets, `5 / 7` tests, `0` linter (of `14 rules`), `7 / 8` reconciliation | 1f | All four match PRD 16.1's fixture text exactly; the reconciliation table on the same screen sums to `7 + 1 + 0 + 0 = 8`, consistent with `7 / 8`. |

---

*Extraction performed against `Forger Wireframes.html` (672,641 bytes) by byte-range
extraction of each `data-screen-label` region, cross-checked against
`SCHEMATIFY-PRD.md` sections 0.3, 0.4, 12, 13, 15, and 16.*
