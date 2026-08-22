/**
 * A picked element, written out for a coding agent to read.
 *
 * This is the end of the feature — everything before it exists so that this
 * function has something to describe. It is deliberately plain Markdown and
 * deliberately pure: what an agent gets is decided in one testable place, not
 * assembled in a click handler beside the clipboard call that ships it.
 *
 * The shape follows the same reasoning as the probe's budgets. An agent reads
 * this inside a context window it is also using for the codebase, so the
 * ordering is what identifies the element first (selector, path, text) and the
 * bulk last (markup), and anything the probe found empty is left out entirely
 * rather than printed as a blank row. A wall of `initial` and `none` teaches
 * nothing and costs the same tokens as a real answer.
 */
import type { PickedElement } from "./probe";

/** How the destination is described in the prose, so the text reads sensibly
 *  whether it was copied for pasting or is being shown in the app. */
export interface PromptOptions {
  /** A screenshot was taken and is on its way separately. Says so, so an agent
   *  that receives only the text does not describe an image it cannot see. */
  withScreenshot?: boolean;
}

const fence = (body: string, language: string) => `\`\`\`${language}\n${body}\n\`\`\``;

/** Non-empty entries only, `key: value` per line. */
function entries(map: Record<string, string>): string[] {
  return Object.entries(map)
    .filter(([, value]) => value.trim() !== "")
    .map(([key, value]) => `${key}: ${value}`);
}

/**
 * Styles worth printing.
 *
 * `getComputedStyle` answers for every property whether or not the author set
 * one, so the great majority of what comes back is the initial value. These
 * four say "nothing was specified" in the four ways CSS says it, and a line
 * carrying one is a line that answers no question anybody had.
 */
const UNINFORMATIVE = new Set(["none", "normal", "auto", "0px"]);

function styleLines(styles: Record<string, string>): string[] {
  return entries(styles).filter((line) => {
    const value = line.slice(line.indexOf(":") + 1).trim();
    return !UNINFORMATIVE.has(value);
  });
}

function section(heading: string, body: string): string {
  return `**${heading}**\n${body}`;
}

/**
 * The whole block, ready to paste.
 *
 * Opens by saying what it is, because an agent receiving this in a terminal has
 * no other signal that a wall of markup is a deliberate handoff rather than
 * something the user fumbled in.
 */
export function toPrompt(picked: PickedElement, options: PromptOptions = {}): string {
  const { page, target } = picked;
  const parts: string[] = [];

  parts.push(`I selected a \`<${target.tagName}>\` element in a running page.`);

  const where = [`page: ${page.url || "(unknown)"}`];
  if (page.title) where.push(`title: ${page.title}`);
  if (target.selector) where.push(`selector: ${target.selector}`);
  if (target.ancestors) where.push(`inside: ${target.ancestors}`);
  where.push(
    `box: ${Math.round(target.rect.width)}×${Math.round(target.rect.height)} at ` +
      `${Math.round(target.rect.x)},${Math.round(target.rect.y)}`,
  );
  parts.push(section("Where", where.map((line) => `- ${line}`).join("\n")));

  if (target.text) parts.push(section("Text", `> ${target.text}`));

  const attributes = entries(target.attributes);
  if (attributes.length > 0) parts.push(section("Attributes", fence(attributes.join("\n"), "")));

  const styles = styleLines(target.styles);
  if (styles.length > 0) parts.push(section("Computed styles", fence(styles.join("\n"), "css")));

  if (target.html) parts.push(section("Markup", fence(target.html, "html")));

  if (options.withScreenshot) {
    parts.push(
      "A cropped screenshot of this element was copied alongside the text. " +
        "If you cannot see an image, work from the markup and styles above.",
    );
  }

  return parts.join("\n\n");
}

/**
 * A one-line description, for the app's own list of what has been picked.
 *
 * Shares no code with {@link toPrompt} on purpose. They answer different
 * questions — one is a handoff, one is a row in a list — and the last time
 * these were the same function, every change to the prompt moved the list.
 */
export function toLabel(picked: PickedElement): string {
  const { target } = picked;
  const text = target.text ? ` — ${target.text.slice(0, 48)}` : "";
  return `${target.selector || target.tagName}${text}`;
}
