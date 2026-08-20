/**
 * Run `pnpm verify` in CI, then report what broke where.
 *
 * `verify.yml` says not to split the gate into one step per check, and this
 * does not. It runs the same single command a contributor runs, streams its
 * output through unchanged, and on failure reads back what it just printed to
 * write annotations. The gate is still one command; this only reads the log
 * afterwards.
 *
 * Spawning from Node rather than piping in the shell is what makes that true on
 * Windows. `tee` with `pipefail` is a bash construct, the runner's default
 * shell there is PowerShell, and swapping the shell to capture output would
 * change how the gate itself executes — a real variable to introduce into the
 * one job that decides whether a pull request is mergeable.
 */

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { parse, summarize, toWorkflowCommands } from "./ci-annotations.mjs";

const child = spawn("pnpm", ["verify"], {
  cwd: process.cwd(),
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let captured = "";

// Both streams are forwarded as they arrive and kept as one string, because the
// checks interleave them — tsc writes errors to stdout, our linters write to
// stderr, and a finding's file and its message can arrive on different streams.
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    captured += chunk;
    process.stdout.write(chunk);
  });
}

child.on("error", (error) => {
  console.error(`could not run pnpm verify: ${error.message}`);
  process.exit(2);
});

child.on("close", (code) => {
  if (code === 0) {
    process.exit(0);
  }

  const findings = parse(captured, process.cwd());
  const commands = toWorkflowCommands(findings);

  // GitHub caps a run at ten annotations per level and silently drops the rest,
  // so a branch that fails a hundred lint rules would otherwise show ten at
  // random and no sign that it was a sample.
  const shown = commands.slice(0, 10);
  process.stdout.write(`\n${shown.join("\n")}\n`);
  if (commands.length > shown.length) {
    const rest = commands.length - shown.length;
    process.stdout.write(`::error title=verify::${rest} more problem(s) — see the job summary\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summarize(findings)}\n`, "utf8");
  }

  process.exit(code ?? 1);
});
