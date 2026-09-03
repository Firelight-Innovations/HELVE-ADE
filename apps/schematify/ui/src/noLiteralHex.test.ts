/**
 * PRD §17 Wave 2's acceptance condition, made a regression rather than a
 * one-time grep: "`packages/schematify-ui` holds no literal hex value" —
 * resolved to `apps/schematify/ui/` per `docs/audits/schematify-baseline.md`
 * §8. `./tokens.css` is the one documented exception (its own header comment
 * says why) — every other `.ts`, `.tsx`, and `.css` file under this app must
 * hold no `#RGB`/`#RRGGBB`/`#RRGGBBAA` literal.
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..");
const EXEMPT = new Set([join(APP_ROOT, "src", "tokens.css")]);
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      out.push(...collectFiles(path));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe("no literal hex color in Schematify's UI", () => {
  const offenders: Array<{ file: string; line: number; text: string }> = [];

  for (const file of collectFiles(join(APP_ROOT, "src"))) {
    if (EXEMPT.has(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (HEX_COLOR.test(line)) {
        offenders.push({ file, line: index + 1, text: line.trim() });
      }
    });
  }

  it("finds none outside tokens.css", () => {
    expect(offenders).toEqual([]);
  });
});
