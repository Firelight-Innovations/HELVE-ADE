/**
 * Wrapper around `slop` (agent-slop-lint) that survives Windows.
 *
 * slop prints ✓ and ✗ and draws box rules. Python on Windows defaults stdout to
 * the console codepage, which here is cp1252, so every one of those characters
 * raises UnicodeEncodeError and the process dies mid-report — `slop init` even
 * managed to leave a zero-byte .slop.toml behind before crashing. `PYTHONUTF8=1`
 * puts the interpreter in UTF-8 mode for both stdout and file writes, which is
 * the whole fix.
 *
 * Arguments are passed straight through, so this is a drop-in:
 *
 *   pnpm slop                      same as `slop lint`
 *   pnpm slop check structural     one category
 *   pnpm slop rules                thresholds currently in force
 *
 * Running `slop` directly is fine too, as long as PYTHONUTF8=1 is set.
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const result = spawnSync("slop", args.length > 0 ? args : ["lint"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
});

if (result.error) {
  console.error(`could not run slop: ${result.error.message}`);
  console.error("Install it with:  pip install agent-slop-lint");
  console.error("It also needs fd, rg and git on PATH — check with:  slop doctor");
  process.exit(2);
}

process.exit(result.status ?? 0);
