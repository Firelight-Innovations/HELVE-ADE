# Handoff: make the File, Edit and View menus real

The titlebar's menu row renders six menus. Five of them do nothing. This is the
work to make **File**, **Edit** and **View** actually operate the app.

Terminal is already wired and is your worked example. Run and Help are out of
scope — leave them exactly as they are.

## Where things stand

`src/shell/titlebar/TitleBar.tsx:85`, `defaultMenus()`. Its own header says it
plainly: all six menus carry "plausible items", and every `onSelect` except the
Terminal menu's is left `undefined`. So this is scaffolding that was never
claimed to be more.

The pieces you will be working with:

| File | What it is |
|---|---|
| `src/shell/titlebar/TitleBar.tsx` | `defaultMenus()` — the menu tree, and `TerminalMenuHandlers`, the pattern to copy |
| `src/shell/titlebar/MenuBar.tsx` | Renders the bar; open/hover/Escape behaviour. Needs no changes for this work |
| `src/shell/contract.ts:426` | `MenuItem` — `label`, `accelerator?`, `separatorBefore?`, `onSelect?`, `disabled?` |
| `src/shell/WindowRoot.tsx:432` | The only caller of `defaultMenus()`, and the owner of the state most View items need |
| `src/shell/keys/useKeyboard.ts` | The shell's global shortcuts. Binds **only** ⌘1–9, ⌘R and ⌘. today |
| `src/shell/toolwindow/ToolWindow.tsx:142` | The `helve/painted` handler — the precedent for a shell↔app message |
| `docs/files-app-methods.md` | Every RPC the Files app answers |
| `docs/tool-protocol.md` | The contract of record. Anything you add to the protocol gets documented here |

## The constraint that shapes all of this

The titlebar lives in the orchestrator shell. The Files app runs in an **iframe,
over the bridge**. The shell must not reach into the app's internals — no
importing Files' hooks, no poking its DOM.

Read `ToolWindow.tsx`'s header before you design anything. It already states the
rule and the one existing exception:

> Traffic runs the other way too: a Tauri event the backend broadcasts is
> forwarded into app frames as a transport-B `event` message. That is the only
> way anything reaches a frame unprompted — every other message here answers one
> the frame sent first.

So a menu command going *shell → app* is genuinely new traffic, and you get to
choose how it rides. Two defensible designs:

1. **A menu-command message posted to the active app frame** by the shell,
   answered by the app. Direct, no backend round trip.
2. **A backend broadcast** reusing the existing event forwarding, at the cost of
   a pointless trip through Rust for something both ends are already in the
   browser for.

Prefer (1) unless you find a reason it cannot work. Whichever you pick, the app
must **declare which commands it currently handles**, because the menu has to
grey out what the active app cannot do — and the shell must not hardcode a list
of Files' capabilities, or the next app to arrive breaks the menu.

Document whatever you add in `docs/tool-protocol.md`.

## Item-by-item

Verdicts are from reading the source, not guesses. Where something needs new
backend work, that is called out; where the honest answer is a disabled item,
that is called out too.

### File

| Item | What backs it | Verdict |
|---|---|---|
| New File | `files/create-file` | **Wire.** Needs a target folder — reuse the same resolution the context menu already does rather than inventing a second rule |
| New Window | `detach_tool` exists but detaches a *tool*, not a fresh window | **Investigate.** If there is no real new-window path, disable it rather than half-wiring detach |
| Open… | `home/open-project` — already opens a native folder picker | **Wire** |
| Open Recent | `home/state` returns recents; `home/open-recent` opens one | **Blocked on the contract.** `MenuItem` has no submenu. Either extend it or make this open the Home app's recent list. Do not fake a submenu |
| Save | `files/write` | **Wire**, disabled when nothing is open or nothing is dirty |
| Save As… | No backend — needs a native save dialog | **New work**, or disable. Say which you chose |
| Close Window | `getCurrentWindow().close()`; `WindowControls.tsx` already does exactly this | **Wire.** Easiest item here |

Braden also asked for a **Trash** entry that opens the trash view, and for
**Delete** and **Duplicate**. Trash and Delete exist (`trash/list`,
`files/delete`). **Duplicate does not** — add `files/duplicate` with the same
collision discipline as create and rename, or say plainly that you skipped it.

### Edit

Undo, Redo, Cut, Copy, Paste, Find, Replace all belong to **whatever has focus**,
which is usually the Monaco editor inside the Files iframe. Monaco exposes these
as editor actions; route them as menu commands and let the app trigger them.

Two things to get right:

- **Focus may not be in the app at all.** If focus is in a shell input, Edit
  should act on that or be disabled — not silently fire into an iframe the user
  is not typing in.
- **Cut/Copy/Paste in a webview** have real clipboard-permission constraints.
  Verify what actually works in the Tauri webview rather than assuming
  `document.execCommand` will do it. If Paste cannot be made to work reliably,
  disable it and say why — a Paste that silently does nothing is worse than one
  that is visibly unavailable.

### View

This menu is the easy win: most of it is shell state that already exists in
`WindowRoot`.

| Item | What backs it | Verdict |
|---|---|---|
| Command Palette… | `searchExpanded` / `SearchSlot` | **Wire** |
| Toggle Secondary Panel | `panelCollapsed` in `WindowRoot` | **Wire** |
| Toggle Terminal | The panel's terminal state | **Wire** |
| Toggle Full Screen | `getCurrentWindow().setFullscreen()` | **Wire** |
| Zoom In / Zoom Out | **Nothing.** No zoom implementation exists anywhere in the tree | **New work** — webview zoom, or disable |

## Rules

**No dead items.** An item you cannot back must be **visibly disabled** —
`MenuItem.disabled`, the real `disabled` attribute, per the contract's own note.
A menu whose items silently no-op teaches the user the menu lies, which is worse
than a menu that is honestly inert.

**Items must reflect live state.** Save disabled when nothing is dirty. Delete
and Rename disabled when there is no active file. Toggle items should show which
way they will go.

**One code path per action.** If an action already exists in the context menu,
the menu bar must call the *same* code — including the same confirmation.
A menu-bar Delete that skips the confirmation because it arrived by a different
route would be a serious bug.

**Accelerators: bind them or drop them.** They are currently Mac glyphs — `⌘N`,
`⇧⌘S`, `⌃\`` — on a Windows-only app. They should read `Ctrl+N`,
`Ctrl+Shift+S`. And `useKeyboard.ts` binds only ⌘1–9, ⌘R and ⌘., so nearly every
accelerator on display today is unbound. If you show it, make the keystroke work;
otherwise do not show it. Note that `TitleBar.tsx:133` already admits this
("Accelerators are displayed only"), so fixing it is a deliberate change to that
position, not an oversight to quietly correct.

Adding bindings means touching `useKeyboard.ts`, whose header explains why it
deliberately leaves ⌘K and Escape alone. **Read it before adding a binding** —
two handlers racing for one key is exactly the failure it was written to avoid.

## Constraints

From `CLAUDE.md`, binding:

- **Never run `pnpm app`, `pnpm dev`, or `tauri dev`.** Port 1420 is Braden's,
  and `tauri dev` orphans a Vite child that holds it until killed by pid. Use
  `pnpm dev:agent` (1430+) if you need a browser, with `?fake=1` for the
  no-backend shell. Browser verification has been unreachable in this
  environment, so plan to hand runtime checks to Braden.
- Verify with **`pnpm build`** (runs `tsc` first), **`cargo check
  --manifest-path src-tauri/Cargo.toml`** and **`cargo test`**. All green before
  reporting.
- **Edit tool only.** Never rewrite a file via PowerShell `Get-Content |
  -replace | Set-Content` — PS 5.1 reads as ANSI and silently corrupts every
  em-dash into mojibake that both `cargo check` and `tsc` accept.
- Keep `src/shell/state/fakeBackend.ts` working for anything you add.
- Match the surrounding voice: this codebase writes prose comments explaining
  *why*, not restatements of what.

## What to report

Per menu: what you wired, what you disabled and why, what needed new backend
work. Then the accelerators you actually bound, the shell→app design you chose
and why, pasted tails of the three verification commands, and a numbered manual
test plan for `pnpm app`.

State assumptions and keep going rather than stopping. If something turns out
materially harder than it looks, finish everything else in full and say exactly
what you left and why — narrowing the scope is Braden's call, not yours.
