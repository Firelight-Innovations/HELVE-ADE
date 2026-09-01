/**
 * What the Run menu puts on a pty, and what it refuses to.
 *
 * Beside `contract.ts` rather than in `titlebar/`: the menu builds the rows and
 * `WindowRoot` carries out the verb, and STANDARDS.md §1.2 forbids either
 * importing the other. Pure, so it is testable with no DOM under it (§8.3).
 */

/** Ctrl+C, as the byte the key sends — the foreground job decides, exactly as
 *  it would from the keyboard. Not a kill; see the Stop row in `menus.ts`. */
export const INTERRUPT = "\u0003";

/** Enter. What turns a line the shell has read into a command it runs. */
const SUBMIT = "\r";

/** A command line, or the sentence explaining why it is not one — a union
 *  because the refusal is *shown*, under `MenuPrompt`'s field. */
export type CommandLine = { command: string } | { refused: string };

/** How much of a command a menu row shows before it is cut. */
const LABEL_BUDGET = 40;

/**
 * The line-break check is the one that matters: a command copied out of a code
 * block carries several, and written through unchanged every line would run.
 * Refused rather than split — a field labelled "a command" did not promise four.
 */
export function commandLine(input: string): CommandLine {
  const command = input.trim();
  if (command === "") return { refused: "Type a command to run." };
  if (/[\r\n]/.test(command)) {
    return {
      refused: "This runs one command. Remove the line breaks, or paste it into the terminal.",
    };
  }
  return { command };
}

/** The bytes that run `command`: the line, then Enter. */
export function terminalInput(command: string): string {
  return command + SUBMIT;
}

/** The Re-run row's label. Cutting the command at `LABEL_BUDGET` keeps the
 *  dropdown's width a property of the menu rather than of what anyone ran. */
export function rerunLabel(last: string | undefined): string {
  if (last === undefined) return "Re-run Last";
  const shown = last.length > LABEL_BUDGET ? `${last.slice(0, LABEL_BUDGET - 1)}…` : last;
  return `Re-run: ${shown}`;
}
