/**
 * Shared plumbing for the 6 `pnpm bench:*` scripts PRD §14.7 names.
 *
 * `runProbe` is §14.7's own instruction made mechanical: where a budget is
 * already asserted from a test suite, run that test and report the number it
 * printed, rather than re-measuring anything — two implementations of one
 * budget drift, and the test is the one that gates a wave.
 *
 * `stub` is the honest alternative for a budget with no test suite yet: print
 * that plainly and exit nonzero, so nothing checking only an exit code
 * mistakes it for a pass.
 */

import { spawn } from "node:child_process";

/**
 * @param {object} opts
 * @param {string} opts.name - metric name, e.g. `graph_load_ms`.
 * @param {string} opts.budget - threshold in words, e.g. `under 1000 ms, hard`.
 * @param {string} opts.command - the executable to spawn.
 * @param {string[]} opts.args - its arguments.
 * @param {RegExp} opts.pattern - matched against the captured output; group 1
 *   is the reported number.
 */
export function runProbe({ name, budget, command, args, pattern }) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let captured = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      captured += chunk;
      process.stdout.write(chunk);
    });
  }

  child.on("error", (error) => {
    console.error(`bench:${name}: could not run ${command}: ${error.message}`);
    process.exit(2);
  });

  child.on("close", (code) => {
    const match = pattern.exec(captured);
    if (code === 0) {
      if (match) {
        console.log(`\nbench: ${name} = ${match[1]} ms (budget: ${budget})`);
      } else {
        // The probe passed, but this script's own pattern did not find the
        // number inside its output — a real result, reported honestly as
        // "unparsed" rather than silently printing nothing.
        console.log(
          `\nbench: ${name} passed, but the reported number could not be parsed from its output`,
        );
      }
    } else {
      console.error(`\nbench: ${name} FAILED (budget: ${budget})`);
    }
    process.exit(code ?? 1);
  });
}

/**
 * The honest alternative to a fabricated number: state that no probe exists,
 * and exit nonzero so nothing downstream mistakes this for a pass.
 *
 * @param {object} opts
 * @param {string} opts.name - the metric name.
 * @param {string} opts.budget - the threshold in words.
 * @param {string} opts.reason - why there is nothing to run yet.
 */
export function stub({ name, budget, reason }) {
  console.error(`bench: ${name} — NOT IMPLEMENTED (budget: ${budget})`);
  console.error(`bench: ${reason}`);
  process.exit(1);
}
