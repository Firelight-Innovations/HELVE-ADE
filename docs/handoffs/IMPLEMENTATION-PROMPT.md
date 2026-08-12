# Prompt — HELVE orchestrator shell implementation plan

You are the implementation lead for the HELVE Engine orchestrator shell. Your deliverable in this pass is **a written plan**, not code. Do not start building until the plan is reviewed.

## What you are building

The orchestrator shell is the window frame that holds each HELVE tool. It is not any of the tools. Six regions make up the window:

| Region | Position |
|---|---|
| Title bar | Top, full width — logo, menu bar, centred title, window buttons |
| Tool switcher bar | Below the title bar, full width — tabs, warning badge, search |
| Tool window | Primary pane — mounts the active tool |
| Secondary panel | Trailing column — terminal tabs plus one worktree tab |
| Status bar | Bottom, full width — engine status leading, settings trailing |

There is no left rail. An earlier draft had one; it was removed and settings moved to the status bar. Do not add it back.

## Your source of truth

`HELVE-Shell-Handoff-standalone.html` — a single self-contained file. **Read the HTML source, do not only look at the rendered page.** The markup is the spec: every hex value, pixel height, padding, and flex structure in it is the intended value. It contains two full 1440x900 screens, 1:1 region crops, two drag interactions, and reference tables for geometry, colour tokens, state vocabulary, the responsive rule, and an explicit list of what has not been decided.

Lift values from that file. Do not invent colours, type sizes, spacing, or radii. If something you need is genuinely absent, list it as an open question in your plan rather than choosing for yourself.

## Stack

React with Framer Motion. Target a modern desktop application feel — smooth, responsive under load. The backend is Rust. Confirm the desktop shell technology before planning around it; the handoff does not assume one.

Motion belongs to seven moments and no others: switching tool tabs, collapsing and dragging the secondary panel, the drag ghost and its drop targets, the boot spinner and progress, menus and the health popover opening, the search field expanding, and a detached window appearing. Two hard constraints: the four bars and their heights never animate, only what sits inside them; and terminal output and the worktree list stay at native scroll speed with no animated list reordering.

## Stub policy — read this carefully

Engine specifics are not settled. **Almost everything behind the interface is a stub in this pass.** The point of the work is a shell that looks and feels finished while wired to nothing real.

Stub, with a clean seam for later:

- Engine status. Five strings only: Engine idle, Engine building, Engine running, Build failed, No engine. Their dot colours are in the reference table. No payload beyond the string and the state.
- Tool resolution. The backend reports one of four states per tool — `ready`, `mismatch`, `unversioned`, `missing`. Stub the resolver; keep the four states real in the type system.
- Tool mounting. The mechanism is undecided (iframe, separate OS window, or frontend module). The tool window is a generic container. Build the container and the boot sequence; leave the mount itself behind an interface with one fake implementation.
- Terminals. Real terminal emulation is out of scope. Stub the session so tabs, adding, dragging, and the agent-finished indicator all work against fake output.
- Worktree. Use an existing VS Code-style SCM list component rather than hand-rolling file rows. Stub the git data behind it.
- Search. Stub the index. The interaction — expansion, typing, the type filter checklist, result rows — should be complete.
- Menu bar. All eight menus present and opening. Items may be inert.

Build for real, because they are pure interface:

- Every layout, size, colour, and state in the handoff file.
- Tab switching, panel resize and collapse, search expansion, popovers, menus.
- Both drag interactions. Detaching a tool is drag-only — dragging a tab clear of the bar creates a window and removes the tab from the bar. There is no pop-out button anywhere in the shell. Terminals drag between any two HELVE windows.
- Keyboard: number keys for tool slots, the search shortcut, cancel during boot.

## Rules that came out of review — do not relitigate

- **No version numbers reach the interface.** Tools are a name and a short description. Versions exist in `helve.toml` and in the backend only.
- **No per-tool state on the tabs.** Tabs stay plain. A single warning badge in the switcher bar opens a health list. A tool that is not installed renders dim and inert. Coloured status chips on tabs were considered and rejected.
- **Status dots mean agent activity, not tool health.** The dot on a terminal tab means that agent finished.
- **User-facing state wording:** needs update, not tracked, not installed. Never mismatch, unversioned, missing.
- Tool icons are placeholders. Every tool shares one outline glyph until each earns its own. Tabler outline set, 1.5–2px stroke.
- The menu bar sits inline in the title bar. Below roughly 1100px window width it must collapse to a single hamburger button opening the same tree — the inline menu block and the centred title collide below that.

## What the plan must contain

1. **Component tree** for the shell, naming which components are pure presentation and which own state. Note where the six regions map onto it.
2. **State ownership** — what lives in shell state, what comes from the backend, what is per-window. Detached windows are a real architectural question: say how window state is shared or duplicated.
3. **The stub layer.** One section listing every interface you are stubbing, its shape, and what replacing it later will touch. This is the part reviewers will read most closely.
4. **Subagent decomposition.** Break the work into parcels sized for Sonnet subagents. For each: what it builds, which files it owns, what it may not touch, what it needs from other parcels, and how you will verify it. Parcels must not share ownership of a file. Say which parcels can run in parallel and what has to be sequential.
5. **Integration order** — what gets assembled when, and what the first runnable milestone looks like.
6. **Verification.** How each parcel is checked against the handoff file. Measured values, not impressions.
7. **Open questions.** Anything the handoff leaves undecided that blocks you, and what you would need to proceed. Do not fill these in yourself.

## Tone of the plan

Specific and short. Name files and components. Skip preamble about why planning matters. If a decision is not yours to make, say so and move on.
