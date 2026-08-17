/**
 * Clippy with a ratchet.
 *
 * `cargo clippy -- -D warnings` is the goal, but this repository was written
 * before clippy was configured and has 298 pre-existing warnings. Turning them
 * into errors on day one would mean either a weekend of refactoring or a wall
 * of `#![allow]` at the top of twenty files. What is used instead is a counted
 * baseline, described at the comparison below. The full account — including why
 * `#![allow(...)]` per file, the usual Rust answer, was rejected — is in
 * `docs/design-notes/scripts.md`.
 *
 * Usage:
 *   node scripts/clippy-baseline.mjs            check against the baseline
 *   node scripts/clippy-baseline.mjs --update   rewrite the baseline
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "clippy-baseline.json");
const update = process.argv.includes("--update");

/** Run clippy and return a `{ "path::lint": count }` map. */
function collect() {
  // `--all-targets` covers tests and benches too; without it a warning can be
  // introduced in a test and never seen. `--message-format=json` is what makes
  // the output parseable rather than scraped.
  const result = spawnSync(
    "cargo",
    ["clippy", "--workspace", "--all-targets", "--message-format=json"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  if (result.error) {
    console.error(`could not run cargo clippy: ${result.error.message}`);
    process.exit(2);
  }

  const counts = {};
  let hardErrors = 0;

  for (const line of result.stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.reason !== "compiler-message") continue;

    const diagnostic = message.message;
    if (!diagnostic) continue;

    // A compile error is never something to baseline — fail loudly instead.
    if (diagnostic.level === "error") {
      hardErrors += 1;
      continue;
    }
    if (diagnostic.level !== "warning") continue;

    const span = (diagnostic.spans || []).find((s) => s.is_primary);
    if (!span) continue;

    // Warnings from dependencies under ~/.cargo are not ours to fix.
    const path = relative(repoRoot, join(repoRoot, span.file_name)).split("\\").join("/");
    if (path.startsWith("..") || path.includes("target/")) continue;

    const lint = diagnostic.code?.code ?? "(uncoded)";
    const key = `${path}::${lint}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  if (hardErrors > 0) {
    console.error(`clippy reported ${hardErrors} compile error(s) — fix those first.`);
    process.exit(2);
  }

  return counts;
}

const current = collect();
const total = Object.values(current).reduce((a, b) => a + b, 0);

if (update) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  console.log(
    `clippy baseline written: ${total} warnings across ${Object.keys(sorted).length} file/lint pairs`,
  );
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("clippy-baseline.json is missing. Create it with:");
  console.error("  node scripts/clippy-baseline.mjs --update");
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const regressions = [];
let improved = 0;

// `clippy-baseline.json` records how many warnings of each lint each file
// currently has, so this fails only when a count goes *up*, or when a lint
// appears in a file that had none. Existing code is grandfathered; new code is
// not, and neither is a new violation added to an old file.
for (const [key, count] of Object.entries(current)) {
  const allowed = baseline[key] ?? 0;
  if (count > allowed) regressions.push({ key, count, allowed });
}
for (const [key, allowed] of Object.entries(baseline)) {
  const count = current[key] ?? 0;
  if (count < allowed) improved += allowed - count;
}

if (regressions.length > 0) {
  console.error("clippy: new warnings beyond the baseline\n");
  for (const { key, count, allowed } of regressions) {
    const [path, lint] = key.split("::");
    console.error(`  ${path}`);
    console.error(`    ${lint}: ${allowed} allowed, ${count} found (+${count - allowed})`);
  }
  console.error("\nFix them, or if they are genuinely intended, re-baseline with:");
  console.error("  node scripts/clippy-baseline.mjs --update");
  process.exit(1);
}

const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`clippy: ${total} warnings, none above the baseline of ${baselineTotal}.`);
if (improved > 0) {
  console.log(`${improved} fewer than the baseline — run --update to bank the improvement.`);
}
