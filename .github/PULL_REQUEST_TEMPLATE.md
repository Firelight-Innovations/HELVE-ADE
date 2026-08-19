## What this changes

<!-- A sentence or two. The commit messages carry the detail. -->

## Three questions

Three, rather than a checklist. A checklist gets ticked; a question has to be
answered, and the answers are what a reviewer actually needs.

**Which layer does this touch?** STANDARDS.md §1 — frontend, backend, or the
protocol crates. If it crosses the boundary between them, say why it had to.

**Did the full `pnpm verify` pass?** The full one, not `verify:fast`. The
difference is `vite build`, which is the only check that catches an app missing
from `vite.config.ts` — a failure that is otherwise silent.

**If this is a bug fix, where is the test that would have caught it?** Name the
file. STANDARDS.md §8 calls this the one non-negotiable test rule, and it is the
question this project would rather ask up front than in review.

<!--
Not a bug fix, and the change genuinely has no test-shaped answer? Say so here
in a line. "No test" with a reason is fine. "No test" on its own is the thing
this template exists to catch.
-->
