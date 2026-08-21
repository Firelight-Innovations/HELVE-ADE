/**
 * Assert that this repository has exactly one answer to "what version is this".
 *
 * A release is cut from a tag, and a tag that disagrees with the version baked
 * into the binary produces an installer whose filename lies about what is
 * inside it. That failure is silent at build time and permanent afterwards,
 * because the artifact is already published by the time anybody reads the
 * number. So it is checked here, in `pnpm lint`, on every commit.
 *
 * `docs/dev/releases.md` has the table of where a version lives and why only
 * one of the four places is a copy.
 *
 * Usage:
 *   node scripts/check-version.mjs              report every disagreement
 *   node scripts/check-version.mjs --set 0.2.0  write a new version everywhere
 *   node scripts/check-version.mjs --tag v0.2.0 also require a tag to match
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(repoRoot, file), "utf8");
const write = (file, text) => writeFileSync(join(repoRoot, file), text);

/**
 * package.json is the source of truth. Cargo.toml's [workspace.package] is the
 * only real copy, because Cargo cannot read a version out of another file. The
 * other two indirect, and the checks below assert they still do.
 */
const PACKAGE_JSON = "package.json";
const WORKSPACE_CARGO = "Cargo.toml";
const TAURI_CARGO = "src-tauri/Cargo.toml";
const TAURI_CONF = "src-tauri/tauri.conf.json";

/** What `tauri.conf.json` must say instead of a number. Relative to src-tauri/. */
const CONF_INDIRECTION = "../package.json";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The `version` key of the root `[package]` table, and nothing else that
 * matches. Every `Cargo.toml` here has dependency versions too, and several
 * have a `[workspace.package]` as well, so the search is anchored to a table
 * header rather than run over the whole file.
 */
function cargoVersion(text, table) {
  const start = text.indexOf(`[${table}]`);
  if (start === -1) return null;
  const rest = text.slice(start);
  const end = rest.indexOf("\n[", 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  return /^version\s*=\s*"([^"]+)"/m.exec(section);
}

const problems = [];
const setting = process.argv.indexOf("--set");
const tagging = process.argv.indexOf("--tag");

const pkg = JSON.parse(read(PACKAGE_JSON));

if (setting > -1) {
  const next = process.argv[setting + 1];
  if (!next || !SEMVER.test(next)) {
    console.error(`version: --set needs a semver version, got: ${next ?? "(nothing)"}`);
    process.exit(1);
  }
  write(PACKAGE_JSON, read(PACKAGE_JSON).replace(/("version":\s*")[^"]*(")/, `$1${next}$2`));
  const cargo = read(WORKSPACE_CARGO);
  const found = cargoVersion(cargo, "workspace.package");
  if (!found) {
    console.error(`version: ${WORKSPACE_CARGO} has no [workspace.package] version to set`);
    process.exit(1);
  }
  write(WORKSPACE_CARGO, cargo.replace(found[0], `version = "${next}"`));
  console.log(`version: set ${pkg.version} -> ${next} in ${PACKAGE_JSON} and ${WORKSPACE_CARGO}`);
  console.log("version: run `cargo update -w` if Cargo.lock needs the new number");
  process.exit(0);
}

const version = pkg.version;
if (typeof version !== "string" || !SEMVER.test(version)) {
  problems.push(`${PACKAGE_JSON}: version ${JSON.stringify(version)} is not semver`);
}

const workspace = cargoVersion(read(WORKSPACE_CARGO), "workspace.package");
if (!workspace) {
  problems.push(`${WORKSPACE_CARGO}: no version under [workspace.package]`);
} else if (workspace[1] !== version) {
  problems.push(
    `${WORKSPACE_CARGO}: [workspace.package] version is ${workspace[1]}, ` +
      `but ${PACKAGE_JSON} says ${version}. Run: node scripts/check-version.mjs --set ${version}`,
  );
}

/**
 * The orchestrator crate must inherit rather than restate. It is the one member
 * that ever carried its own number, and it is also the one whose number reaches
 * a user, through `env!("CARGO_PKG_VERSION")`.
 */
const own = cargoVersion(read(TAURI_CARGO), "package");
if (own) {
  problems.push(
    `${TAURI_CARGO}: version = "${own[1]}" is a second copy. ` +
      `Use \`version.workspace = true\` and let the workspace answer.`,
  );
}

const confVersion = JSON.parse(read(TAURI_CONF)).version;
if (confVersion !== CONF_INDIRECTION) {
  problems.push(
    `${TAURI_CONF}: version is ${JSON.stringify(confVersion)}, expected ` +
      `${JSON.stringify(CONF_INDIRECTION)} so the bundle reads ${PACKAGE_JSON} directly.`,
  );
}

/**
 * Tag checking is the release workflow's use of this script, not a contributor's.
 * A tag is immutable in every way that matters once it is pushed, so the build
 * refuses to start rather than producing an artifact that has to be retracted.
 */
if (tagging > -1) {
  const tag = process.argv[tagging + 1] ?? "";
  const bare = tag.replace(/^refs\/tags\//, "").replace(/^v/, "");
  if (bare !== version) {
    problems.push(
      `tag ${tag} does not match ${PACKAGE_JSON} version ${version}. ` +
        `Either the tag is wrong, or the bump was never committed.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`version: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`version: ${version}, and every surface agrees`);
