# Design comments

How a sentence somebody typed against one element of a running page reaches an
agent in a terminal.

Design Mode used to end at the clipboard: pick an element, copy a wall of
Markdown and a picture of it, paste both into an agent. That works in a chat
window and nowhere else. An agent in a terminal cannot be pasted an image at
all, and a person with six changes to ask for cannot paste six times and keep
track of which one is done — there is no id to refer to, no state to read back,
and no way for the agent to say "which side did you mean?".

This is the record of what replaced it: a comment store both halves of the
product write to, and an MCP server that serves it.

## src-tauri/src/design_comments.rs

A comment is the user's request against one captured element. It has an id that
outlives the app, a status that says whose turn it is, and a thread the two
sides take turns in.

### The state machine

Three states, not two.

| State | Whose turn | What it means |
|---|---|---|
| `open` | the agent | act on it, ask about it, or resolve it |
| `question` | the user | the agent asked something and is waiting |
| `resolved` | nobody | done, kept as history |

"The agent needs something from me" is not the same as "nobody has looked at
this yet", and an app that draws them the same way is one where a question sits
unanswered forever. A user's reply to a `question` puts the comment back to
`open`: the agent is owed a turn again, and that is exactly what open means.

Every transition goes through one function, `Book::say`, which differs between
the four verbs — the user replying, the agent answering, the agent asking,
either side resolving — only in who is speaking and where the turn leaves the
comment. Four near-identical functions is how two of them end up forgetting to
touch `updated`.

The original `request` is kept out of the thread and never edited. It is the
thing every later turn is about, and a request that scrolled off the top of a
conversation is a request an agent stops answering.

### Ids

`c1`, `c2`, `c3` — a persisted counter, not a hash and not a position.

Short and typeable, because the id is what a model writes back into
`resolve_comment` and what a person reads in a list. **Rejected: a random hex
id**, which is what the first draft had. Uniqueness is already guaranteed by a
persisted counter in a single-instance application, so the twelve extra
characters bought nothing and cost a transcription error every time somebody
typed one.

The counter is persisted rather than derived from the highest id present.
Deriving it would reuse the id of a comment that had been forgotten, and a
reused id is worse than a gap — an agent holding `c7` from an earlier session
would resolve somebody else's request and report success.

### The file, and the pictures beside it

`%APPDATA%/<identifier>/design-comments.json`, beside `settings.json` and never
inside a project. A comment is about a page somebody is looking at, which is not
the same thing as a checkout, and a file that appeared in a repository because
somebody clicked a button would be a file they had to decide whether to commit.

It follows the same four rules as the five stores before it — never fatal,
atomic write, forward-compatible, outside the repo.

Screenshots are **one PNG per comment** under `design-shots/`, not base64 inside
the JSON. A screenshot is hundreds of kilobytes and the JSON is rewritten on
every reply, so inlining one would mean rewriting every picture in the store in
order to record a sentence. The record carries a `hasShot` flag instead, so
listing every comment does not read a megabyte per row.

Because the file is named for the id, the id has to exist before the picture can
be written, and the picture has to be on disk before `has_shot` can claim it is.
`Comments::add` reserves the id, writes the file outside the lock, then commits
both together — which is why `Book` has `reserve` and `push` rather than one
`add`.

A picture that will not decode or will not write leaves a comment that says it
has none. Failing the whole call would lose the sentence over the half of the
capture an agent can least act on.

### The cap

Resolved comments are kept, up to 200, then the oldest are forgotten with their
pictures. They are kept at all because "what did I already ask for" is a real
question and a store that empties itself the moment work finishes cannot answer
it. They are capped because nothing else would ever delete one, and an
append-only file behind a text box is a file that grows for as long as the app
is used.

**Only resolved comments are ever candidates.** An open comment is somebody's
outstanding request and no cap may quietly delete one, however many there are.

### Why the state is process-wide

Everything else in Design Mode is per-frame, deliberately: a second Design Mode
in a second cluster is a second frame with its own probe, and `apps/design.rs`
remembers nothing about either. The comment store is the exception, and it is
the other side of the same rule rather than a break in it — a comment belongs to
a *page*, not to whichever tab was showing it. Two tabs pointed at the same dev
server are two views of one set of outstanding requests, and an agent asking
"what is outstanding" is not asking about a tab.

## src-tauri/src/mcp/servers/design.rs

Five tools: `list_comments`, `read_comment`, `comment_screenshot`,
`resolve_comment`, `ask_comment`.

### Why the list and the record are two tools

`list_comments` returns a digest — id, status, page, selector, the request
clipped, the last thing said, whether there is a picture — and no markup at all.
`read_comment` returns the whole record.

An agent reads this inside a context window it is also using for the codebase.
Somebody who pastes three paragraphs into one comment should not push the other
nine off the end of a model's attention, and the markup of ten elements is
several thousand tokens spent before a single decision has been made. The same
reasoning the probe's own budgets follow.

### Why `resolve_comment` requires a note

The note is the only thing telling the person who wrote the comment what
happened. A resolution with an empty note is a comment that changed colour on
their screen and said nothing, which is worse than one left open.

The *user's* own "Close" button in the app does not ask for a note, and that
asymmetry is deliberate: that button exists for the case where somebody no
longer wants the comment, and asking them to write about that is asking them to
do work in order to stop having work. The direction that needs a note is the one
where the other party has no other way of finding out.

### Why this server may write

`mcp::handoff` puts a bearer token in a file readable by anything running as
this user, and says plainly that the trade only holds while the served surface
stays read-only — "a server that mutates anything has to reopen the decision
rather than inherit it". This is that decision, reopened.

What this server can write is a reply, a question and a resolution, all of them
into a thread the user can see in the app and undo there. It touches no path a
caller names, no window, no process and no file outside the comment store. A
leaked token here buys the ability to mark somebody's own request done — visible
on their screen the moment they look at it — where the `ui` server next door
buys their mouse and keyboard.

The comparison that settles it: an attacker holding this token already has
`shell_snapshot` and `recent_errors` from the debug server, which is more than a
comment thread tells them.

### Why it is not `dev_only`

The whole point is that an agent the user is running in an ordinary terminal can
read what they wrote in an ordinary release build. A server behind developer
mode would be a server for the people who least need it. `ui` is `dev_only`
because of what it writes — input into the user's own window — not because it
writes at all, and inheriting that gate here would have been reasoning from the
word rather than from the surface.

## apps/design/ui/src/useComments.ts

The app is not the only author of this store. An agent resolves a comment or
asks a question over MCP in another process entirely, and the panel has to
notice.

Nothing pushes that today: an app frontend receives host events through the
bridge, and the backend has no channel that reaches an app frame off its own
back. So the hook **polls**, every three seconds while the tab is visible, which
is the honest version of what a one-call read of an in-memory list costs.

**Rejected: adding an event topic from Rust into the app bridge for this one
store.** It is the right answer eventually and it is a change to the app
protocol, which is a larger decision than a comment panel gets to make on its
own. When it lands, `REFRESH_MS` and the interval beside it are the whole of
what it replaces.

## apps/design/ui/src/comments.ts

The backend answers oldest-first, because that is the order an agent should work
through a list in. The panel sorts by urgency — what is blocked on the reader,
then what is live, then history — and within a group by what moved most
recently. The two readers want opposite things and neither is wrong, so the sort
happens where it is displayed rather than being baked into the answer.

`elsewhere` marks a comment left on a page other than the one in the frame, and
is used to *label* a row, never to hide one. The comparison is between two URLs
that reach the app by different routes — one normalised by `design/target` from
what somebody typed, one reported by the probe from inside the page — and they
agree in the ordinary case and not in every case. A label that is occasionally
redundant costs a line; a filter built on the same comparison would occasionally
hide somebody's outstanding request.
