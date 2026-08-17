# Design notes

Long-form rationale that used to live in module headers.

`scripts/check-comments.mjs` caps comment *concentration*, not comment total:
no file may be more than half comment lines, and none may carry an unbroken run
of more than twenty. STANDARDS.md §4 is unchanged — this codebase still explains
itself in prose, and a comment recording a rejected alternative is still the most
valuable thing in it. What the cap says is that a forty-line essay above a
five-line function is an essay with an illustration in it, not a documented
function.

Three things happen to a header that is over the cap, in this order:

1. **It is distributed.** Most long headers are describing several specific items
   further down the file, so each paragraph moves onto the item it is about. Same
   words, same total, now at the point of use.
2. **It is tightened.** Same claims, fewer words.
3. **It moves here.** Only genuinely module-wide design rationale with no single
   item to attach to — the argument for why a module is shaped the way it is,
   what was considered and rejected, how a mechanism works end to end. It is
   copied across verbatim, and the source file points at the page.

Nothing was summarised on the way in. If a claim is in one of these pages, it is
in the words it was written in.

Each page is named for the area it covers and holds one `## <path>` section per
source file it took prose from. Start from the source file: it will name the page
if it has one, and if it does not, then everything about it is still in the file.
