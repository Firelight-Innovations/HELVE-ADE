import { describe, expect, it } from "vitest";
import type { PickedElement } from "./probe";
import { toLabel, toPrompt } from "./prompt";

const element = (overrides: Partial<PickedElement["target"]> = {}): PickedElement => ({
  page: {
    url: "http://localhost:5173/checkout",
    title: "Checkout",
    viewportWidth: 1200,
    viewportHeight: 800,
    devicePixelRatio: 1,
  },
  target: {
    tagName: "button",
    selector: "form#pay > button.primary",
    ancestors: "main > form#pay",
    text: "Pay now",
    html: '<button class="primary">Pay now</button>',
    attributes: { class: "primary", type: "submit" },
    styles: { color: "rgb(255, 255, 255)", "background-color": "rgb(20, 100, 200)" },
    rect: { x: 40.4, y: 320.6, width: 128, height: 36 },
    ...overrides,
  },
});

describe("toPrompt", () => {
  it("says what it is before it says anything else", () => {
    const text = toPrompt(element());
    expect(text.split("\n")[0]).toContain("selected a `<button>` element");
  });

  it("carries what identifies the element and what it looks like", () => {
    const text = toPrompt(element());
    expect(text).toContain("form#pay > button.primary");
    expect(text).toContain("http://localhost:5173/checkout");
    expect(text).toContain("main > form#pay");
    expect(text).toContain("Pay now");
    expect(text).toContain("background-color: rgb(20, 100, 200)");
    expect(text).toContain('<button class="primary">Pay now</button>');
  });

  it("rounds the box, because a subpixel rect is noise in a prompt", () => {
    expect(toPrompt(element())).toContain("128×36 at 40,321");
  });

  /**
   * The budget rule, and the reason this function exists rather than a
   * `JSON.stringify`. `getComputedStyle` answers for every property whether the
   * author set one or not, so most of what arrives is the initial value — and
   * every line of it costs the same context as a line that answers something.
   */
  it("leaves out styles that only say nothing was specified", () => {
    const text = toPrompt(
      element({
        styles: {
          display: "flex",
          border: "none",
          margin: "0px",
          "font-weight": "normal",
          "z-index": "auto",
          opacity: "",
        },
      }),
    );
    expect(text).toContain("display: flex");
    expect(text).not.toContain("border:");
    expect(text).not.toContain("margin:");
    expect(text).not.toContain("font-weight:");
    expect(text).not.toContain("z-index:");
    expect(text).not.toContain("opacity:");
  });

  it("omits a whole section rather than printing an empty one", () => {
    const text = toPrompt(element({ text: "", attributes: {}, styles: {}, html: "" }));
    expect(text).not.toContain("Attributes");
    expect(text).not.toContain("Computed styles");
    expect(text).not.toContain("Markup");
    // What is left still has to identify the element.
    expect(text).toContain("form#pay > button.primary");
  });

  // An agent that gets only the text must not describe a picture it never
  // received, so the mention is conditional on there being one.
  it("mentions a screenshot only when one was taken", () => {
    expect(toPrompt(element())).not.toContain("screenshot");
    expect(toPrompt(element(), { withScreenshot: true })).toContain("screenshot");
  });

  it("still names the page when the probe could not sanitise its URL", () => {
    const blank = element();
    blank.page.url = "";
    expect(toPrompt(blank)).toContain("(unknown)");
  });
});

describe("toLabel", () => {
  it("leads with the selector and adds the text", () => {
    expect(toLabel(element())).toBe("form#pay > button.primary — Pay now");
  });

  it("falls back to the tag when there is no selector", () => {
    expect(toLabel(element({ selector: "", text: "" }))).toBe("button");
  });

  it("does not let a paragraph become the row", () => {
    const long = toLabel(element({ text: "x".repeat(200) }));
    expect(long.length).toBeLessThan(120);
  });
});
