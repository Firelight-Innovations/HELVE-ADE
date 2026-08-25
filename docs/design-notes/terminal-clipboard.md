# Terminal clipboard

## src/shell/terminal/clipboard.ts

The terminal's clipboard is owned by this module rather than left to xterm,
whose own behaviour is wrong for a Windows terminal in both directions at once.
Issue #50 reported the two directions as two bugs.

### Ctrl+V never reached the clipboard

xterm's keyboard table maps every `Ctrl`+letter to its control byte, with no
clipboard binding layered over it. `Ctrl+V` became `SYN` (`0x16`) and the event
was cancelled, so the webview's own paste — the one the right-click menu uses
and the one `src/shell/titlebar/useEditTarget.ts` tells the user about — never
got to run. In a terminal `Ctrl+V` genuinely *is* literal-next, so this was not
a missing feature so much as an unarbitrated collision between two conventions.

`isPasteKey` claims `Ctrl+V` and `Ctrl+Shift+V`, because a Windows terminal
conventionally takes either and somebody arriving from Windows Terminal, VS
Code's terminal or PowerShell will try one of the two without thinking about it.
`Alt` disqualifies the combo: `Ctrl+Alt` *is* `AltGr` on most non-US keyboard
layouts, where `AltGr+V` is a character somebody means to type, and claiming it
would break typing on those layouts to gain a shortcut nothing asks for.

**What this costs, and why no replacement binding is added.** `Ctrl+V` no longer
sends `SYN`, so readline's `quoted-insert` is no longer on it. Readline binds
`quoted-insert` to `Ctrl+Q` as well, so the escape hatch already exists and is
one nobody has to be taught by us. Inventing a second one — `Ctrl+Alt+V` was the
candidate — would have cost the `AltGr` collision above for a duplicate.

**Reading the clipboard here was rejected.** The obvious implementation is to
call `navigator.clipboard.readText()` on `Ctrl+V` and hand the result to the
emulator. That call is gated on the `clipboard-read` permission, and what a
Tauri v2 WebView2 window does with that request is unverified —
`docs/design-notes/shell-chrome.md` says so at length, and the Edit menu's Paste
is disabled over exactly that uncertainty. So `handleKey` returns `false`
instead, which xterm treats as "not yours": it returns without emitting anything
**and without cancelling the event**, and the webview then runs its own paste.
That needs no permission at all and reuses the route right-click → Paste already
proves works. Clipboard *write* is unaffected either way and always was.

### A paste was left lying in the hidden textarea

xterm's paste handler forwards the text to the pty and blanks the off-screen
`<textarea>`, but never calls `preventDefault()`. The browser's default action
then writes the same text straight back into that textarea, where nothing clears
it.

xterm's `contextmenu` handler — bound unconditionally, and running on the
right-click *event* rather than on any menu item — then moves that textarea
under the mouse at `z-index: 1000`, focuses it, loads it with the current
selection and calls `select()` on it. So every right-click re-armed a focused,
fully-selected editable element still holding the previous paste, sitting under
the pointer, for the webview's own edit machinery to replay. The menu item was
never involved, which is why the second right-click pasted without one being
chosen.

`handlePaste` removes the precondition rather than the symptom: it hands the
text to the emulator once, calls `preventDefault()` so nothing is ever deposited
in the textarea, and `stopPropagation()` so xterm's handler does not send the
same text a second time.

**xterm's right-click handling is left in place.** Moving the textarea under the
cursor is what makes WebView2 offer Copy and Paste at all — the native menu is
built for whatever editable element the click landed on, and without that move
the click lands on the terminal's canvas and the menu has no Paste on it.
Suppressing the handler would have broken the one paste route that worked.
`handleContextMenu` instead adds the invariant the handler is missing: *after a
right-click the textarea holds the terminal's selection and nothing else*. The
selection has to stay there, because it is what the menu's Copy reads.

This is deliberately terminal-local. The shell's app-wide context-menu
behaviour is not touched, and neither is any global suppression of it.

### Why the policy is a module and not four lines in `XTermView.tsx`

`vitest.config.ts` runs on `node` with no DOM and no rendering library, so a
component test is not merely absent but currently impossible — STANDARDS.md §8.3
is explicit that this is the arrangement and that the shell's testable weight
belongs in pure modules. Both bugs are policy questions ("is this key a paste?",
"may a right-click write to the pty?") with no rendering in them, so the policy
is four exported functions over the narrowest slice of xterm and of the DOM
events they read, and `attachClipboard` is the single impure line of wiring left
in the component. `clipboard.test.ts` covers the policy; the wiring is the part
that has to be seen in the app.
