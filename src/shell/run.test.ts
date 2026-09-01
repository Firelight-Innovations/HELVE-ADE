/**
 * What the Run menu is allowed to put on a pty.
 *
 * The regression these guard is the one issue #40's fix could plausibly
 * introduce: a Run menu that hands a shell more than the person who typed into
 * it meant to run. A pasted code block is several commands; a blank field is
 * none; and Enter is what separates "the shell has a line" from "the shell ran
 * it". Everything here is a pure function, so all three are checkable without a
 * terminal under them (STANDARDS.md §8.3).
 */
import { describe, expect, it } from "vitest";
import { INTERRUPT, commandLine, rerunLabel, terminalInput } from "./run";

describe("a command line off the Run field", () => {
  it("takes an ordinary command", () => {
    expect(commandLine("pnpm verify")).toEqual({ command: "pnpm verify" });
  });

  it("trims the surrounding whitespace a paste brings with it", () => {
    expect(commandLine("  cargo test  ")).toEqual({ command: "cargo test" });
  });

  it("refuses a blank field with something to show", () => {
    expect(commandLine("   ")).toEqual({ refused: "Type a command to run." });
  });

  /**
   * The one that matters. A command copied out of a README carries a trailing
   * newline and one copied out of a code block carries several — written
   * through unchanged, every line would run.
   */
  it("refuses a paste that holds more than one line", () => {
    const refusal = commandLine("git add -A\ngit commit -m wip");
    expect(refusal).toHaveProperty("refused");
    expect(refusal).not.toHaveProperty("command");
  });

  it("refuses a carriage return as well as a newline", () => {
    expect(commandLine("echo one\recho two")).toHaveProperty("refused");
  });

  /** A trailing newline is whitespace, and trimming it leaves one command. */
  it("takes a command whose only line break is the trailing one", () => {
    expect(commandLine("pnpm build\n")).toEqual({ command: "pnpm build" });
  });
});

describe("what reaches the pty", () => {
  it("submits the command with Enter", () => {
    expect(terminalInput("pnpm verify")).toBe("pnpm verify\r");
  });

  /** Stop is the Ctrl+C byte and nothing else — not a kill, not a signal the
   *  shell would never see from a keyboard. */
  it("interrupts with the byte Ctrl+C sends", () => {
    expect(INTERRUPT).toBe("\u0003");
  });
});

describe("the Re-run row's label", () => {
  it("names the command it would run", () => {
    expect(rerunLabel("pnpm verify")).toBe("Re-run: pnpm verify");
  });

  it("says only that there is a last command to re-run when there is none", () => {
    expect(rerunLabel(undefined)).toBe("Re-run Last");
  });

  /** A long command must not decide how wide the dropdown is. */
  it("cuts a command too long to sit on a menu row", () => {
    const long = "cargo test --workspace --all-features -- --nocapture --test-threads 1";
    const label = rerunLabel(long);
    expect(label.length).toBeLessThan("Re-run: ".length + long.length);
    expect(label.endsWith("…")).toBe(true);
  });
});
