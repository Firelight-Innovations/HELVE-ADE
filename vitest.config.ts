import { defineConfig } from "vitest/config";

/**
 * Vitest for the shell and the first-party apps.
 *
 * Deliberately `node`, not `jsdom`, and with no rendering library. The shell's
 * testable weight is in pure modules — the query grammar, the kind table, the
 * layout maths — and that is also where the bugs with test-shaped answers are.
 * Pulling in jsdom and a rendering library is a real dependency decision, and
 * it belongs to the first pull request that actually needs to render something
 * rather than to the commit that switched the runner on. This is a starting
 * point, not a judgement that component tests are unwanted.
 *
 * `packages/` and `examples/` keep their own configs and their own runs — see
 * `test:js` in package.json, which is both halves.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "apps/*/ui/src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
