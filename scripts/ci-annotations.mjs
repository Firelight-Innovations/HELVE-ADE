/**
 * Read a failed `pnpm verify` log and say which lines to fix.
 *
 * GitHub draws a workflow command written to stdout against the line it names,
 * in the pull request's Files changed tab. `.github/workflows/verify.yml` has
 * the reasoning for preferring that to a posted comment.
 */

// Every pattern below was taken from the tool that produced it, on Windows,
// rather than written from memory — see the fixtures in the test file. Four of
// them differed from the obvious guess, and each difference was silent.
//
// The parsing is deliberately forgiving: an unrecognised failure still reports
// the stage that failed rather than reporting nothing at all.

// eslint-disable-next-line no-control-regex -- matching the escape is the point
const ANSI = /\x1b\[[0-9;]*m/g;

/** Every tool here colours its own output, and none of it survives to a match. */
export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

/** Repo-relative, forward-slashed. GitHub ignores an annotation it cannot place. */
export function relativize(filePath, repoRoot) {
  // `//?/` is Win32's extended-length prefix, and rustfmt really does print it.
  // Left on, every Rust annotation would carry a path GitHub cannot resolve.
  const slashed = filePath
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/\/\?\//, "");
  const root = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const prefix = root + "/";
  const relative = slashed.toLowerCase().startsWith(prefix.toLowerCase())
    ? slashed.slice(prefix.length)
    : slashed;
  return relative.replace(/^\.\//, "");
}

/**
 * The stage banner pnpm prints before each script it runs.
 *
 * `pnpm verify` is four commands behind one name, and when a parser does not
 * recognise the failure this is all that separates "the build broke" from "the
 * formatter is unhappy". Tracked for every line, used only if nothing else
 * matched.
 */
const STAGE = /^\s*>\s+\S+@\S+\s+([\w:-]+)\s*$/;

const MATCHERS = [
  // tsc, which is reached through `pnpm build` and so is the first thing a
  // broken branch usually trips.
  {
    tool: "typescript",
    line: /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/,
    build: (m) => ({ file: m[1], line: +m[2], col: +m[3], message: `${m[4]}: ${m[5]}` }),
  },
  // Rust panics carry their own location, so a failing `cargo test` lands on
  // the assertion rather than on the test's declaration.
  //
  // The `(74608)` is the thread id, which current Rust prints and older Rust
  // does not. It is optional here for the same reason rustfmt's two spellings
  // both are: the alternative is annotations that quietly stop working when a
  // toolchain moves under us.
  {
    tool: "cargo test",
    line: /^thread '(.+?)'(?:\s+\(\d+\))? panicked at (.+?):(\d+):(\d+):$/,
    build: (m, next) => ({
      file: m[2],
      line: +m[3],
      col: +m[4],
      message: `${m[1]} panicked: ${(next ?? "").trim()}`,
    }),
  },
  {
    tool: "vitest",
    line: /^\s*(?:❯|at)\s+(\S+?\.test\.[cm]?[jt]sx?):(\d+):(\d+)/,
    build: (m) => ({ file: m[1], line: +m[2], col: +m[3], message: "test failed here" }),
  },
  // `cargo fmt --check` names a file and a line but prints the diff after it,
  // so the message has to be generic. Running `pnpm format` is the whole fix.
  //
  // Two spellings, because rustfmt changed its mind: older builds write `at
  // line N:` and the current one writes `:N:`. Accepting both costs one
  // alternation and means a contributor on an older toolchain still gets
  // annotations rather than silence.
  {
    tool: "rustfmt",
    line: /^Diff in (.+?)(?: at line |:)(\d+):$/,
    build: (m) => ({
      file: m[1],
      line: +m[2],
      message: "not rustfmt-formatted — run `pnpm format`",
    }),
  },
  {
    tool: "prettier",
    line: /^\[warn\]\s+(\S.*\.\w+)$/,
    build: (m) => ({ file: m[1], message: "not Prettier-formatted — run `pnpm format`" }),
  },
];

/** Vitest names the case on the FAIL line and the location several lines later. */
const VITEST_FAIL = /^\s*FAIL\s+(\S+\.test\.[cm]?[jt]sx?)\s*>\s*(.+?)\s*$/;

/**
 * ESLint's default formatter puts the path on its own line and the findings
 * under it, so a finding is only placeable if the last unindented line was a
 * path. Warnings are skipped on purpose — eight of them predate this and none
 * of them fail the build, so annotating them would bury the errors.
 */
const ESLINT_FILE = /^(\S+\.(?:[cm]?[jt]sx?))$/;
const ESLINT_FINDING = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/;

/**
 * Three of the checks are ours, and all three report the same way: a header,
 * then files indented two spaces, then that file's problems indented four.
 * `branding` is the odd one — it has no second level, and folds the file into
 * the problem string as a prefix.
 */
const BLOCKS = [
  { tool: "clippy", header: /^clippy: new warnings beyond the baseline/, nested: true },
  { tool: "comment density", header: /^comment density: files above their limit/, nested: true },
  { tool: "branding", header: /^branding: \d+ problem\(s\)/, nested: false },
];

function parseBlock(lines, start, block) {
  const found = [];
  let file = null;
  let i = start + 1;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break;
    const text = raw.trim();
    if (!block.nested) {
      const split = text.match(/^(\S+?):\s+(.*)$/);
      found.push(split ? { file: split[1], message: split[2] } : { message: text });
    } else if (indent <= 2) {
      file = text;
    } else if (file) {
      found.push({ file, message: text });
    }
  }
  return { found, next: i };
}

/**
 * `output` is the combined stdout and stderr of one `pnpm verify` run.
 *
 * Findings come back in the order they were printed, which is the order the
 * four checks run in, so the first one is nearly always the one to fix first.
 */
export function parse(output, repoRoot = process.cwd()) {
  // Colour is stripped first, and it is not cosmetic. GitHub Actions advertises
  // a colour-capable terminal, so Prettier really does print `[33mwarn[39m`
  // there — a `[warn]` pattern matches that in a local pipe and never in the
  // one place this runs.
  const lines = stripAnsi(output).split(/\r?\n/);
  const findings = [];
  let stage = null;
  let eslintFile = null;
  let vitestCase = null;

  // Seen keys live beside the findings rather than on them, so that what comes
  // back is exactly what a caller needs. Duplicates are real: a Rust panic is
  // printed once per failing test and again in the trailing `failures:` list.
  const seen = new Set();
  const push = (tool, raw) => {
    if (!raw) return;
    const file = raw.file ? relativize(raw.file, repoRoot) : undefined;
    const key = `${tool}|${file}|${raw.line}|${raw.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ tool, ...raw, file });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stageMatch = line.match(STAGE);
    if (stageMatch) stage = stageMatch[1];

    const block = BLOCKS.find((b) => b.header.test(line));
    if (block) {
      const { found, next } = parseBlock(lines, i, block);
      for (const one of found) push(block.tool, one);
      i = next - 1;
      continue;
    }

    const failing = line.match(VITEST_FAIL);
    if (failing) {
      vitestCase = failing[2];
      push("vitest", { file: failing[1], message: `failing test: ${failing[2]}` });
      continue;
    }

    if (ESLINT_FILE.test(line)) eslintFile = line.trim();
    const finding = line.match(ESLINT_FINDING);
    if (finding && eslintFile && finding[3] === "error") {
      push("eslint", {
        file: eslintFile,
        line: +finding[1],
        col: +finding[2],
        message: finding[5] ? `${finding[4]} (${finding[5]})` : finding[4],
      });
      continue;
    }

    for (const matcher of MATCHERS) {
      const m = line.match(matcher.line);
      if (!m) continue;
      const built = matcher.build(m, lines[i + 1]);
      if (matcher.tool === "vitest" && vitestCase) built.message = `failing test: ${vitestCase}`;
      push(matcher.tool, built);
      break;
    }
  }

  // A failure nobody parsed is still a failure worth naming. Reporting the
  // stage beats reporting silence, which would read as "CI found nothing".
  if (!findings.length && stage) {
    findings.push({ tool: stage, message: `\`pnpm ${stage}\` failed — see the full log` });
  }
  return findings;
}

/** The `::error` form GitHub reads. A finding with no file becomes a bare one. */
export function toWorkflowCommands(findings) {
  return findings.filter((f) => !MATCHED_BY_THE_RUNNER.has(f.tool)).map(toCommand);
}

/**
 * `actions/setup-node` registers problem matchers for tsc and for both ESLint
 * formatters, so the runner already annotates those two on its own — observed,
 * not assumed, on the first red run of this workflow. Emitting them again would
 * put two markers on one line saying the same thing.
 *
 * They are still parsed, because the job summary is a separate surface and a
 * table that omitted every TypeScript error would be lying about what broke.
 */
const MATCHED_BY_THE_RUNNER = new Set(["eslint", "typescript"]);

function toCommand(f) {
  const escaped = String(f.message).replace(/%/g, "%25").replace(/\r?\n/g, "%0A");
  if (!f.file) return `::error title=${f.tool}::${escaped}`;
  // A line of zero is what a checker that reports per-file rather than per-line
  // leaves behind, and GitHub accepts the annotation but will not draw it in the
  // diff. Line one at least puts it on the right file.
  const where = [`file=${f.file}`, `line=${f.line || 1}`];
  if (f.col) where.push(`col=${f.col}`);
  return `::error ${where.join(",")},title=${f.tool}::${escaped}`;
}

/** The run page's summary: the same findings, grouped, as a Markdown table. */
export function summarize(findings) {
  if (!findings.length) return "## verify passed\n";
  const byTool = new Map();
  for (const f of findings) byTool.set(f.tool, [...(byTool.get(f.tool) ?? []), f]);

  const out = [`## verify failed — ${findings.length} problem(s)`, ""];
  for (const [tool, items] of byTool) {
    out.push(`### ${tool} (${items.length})`, "", "| Where | What |", "|---|---|");
    for (const f of items) {
      const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`` : "—";
      out.push(`| ${where} | ${String(f.message).replace(/\|/g, "\\|")} |`);
    }
    out.push("");
  }
  out.push("Run `pnpm verify` locally to reproduce all of it in one command.");
  return out.join("\n");
}
