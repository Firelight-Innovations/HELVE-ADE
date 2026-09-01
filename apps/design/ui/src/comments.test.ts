/**
 * What a list of comments looks like once it reaches the panel.
 *
 * The interesting decisions here are all about *order and emphasis*, which is
 * exactly the kind of thing that is obviously right when written and silently
 * wrong three changes later — a resolved comment floating to the top, a
 * question that stops drawing its reply box.
 */
import { describe, expect, it } from "vitest";
import {
  STATUS_WORDING,
  elementLabel,
  elsewhere,
  forDisplay,
  pendingQuestion,
  type Comment,
  type Status,
} from "./comments";

function comment(id: string, status: Status, updated: number): Comment {
  return {
    id,
    status,
    page: { url: "http://localhost:5173/", title: "Home" },
    element: {
      tag: "button",
      selector: ".cta",
      ancestors: "",
      text: "",
      html: "",
      attributes: {},
      styles: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    },
    request: "make this bigger",
    thread: [],
    created: 1,
    updated,
    hasShot: false,
  };
}

describe("forDisplay", () => {
  it("puts what is blocked on the reader first and history last", () => {
    const ordered = forDisplay([
      comment("c1", "resolved", 90),
      comment("c2", "open", 80),
      comment("c3", "question", 10),
    ]);

    expect(ordered.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
  });

  it("orders within a group by what moved most recently", () => {
    const ordered = forDisplay([
      comment("c1", "open", 10),
      comment("c2", "open", 30),
      comment("c3", "open", 20),
    ]);

    expect(ordered.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
  });

  // The backend answers oldest-first for the agent's sake, and React state is
  // shared; a sort in place would reorder the array the poll just stored.
  it("does not reorder the list it was given", () => {
    const list = [comment("c1", "resolved", 1), comment("c2", "question", 2)];
    forDisplay(list);
    expect(list.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("pendingQuestion", () => {
  it("finds the question a comment is waiting on", () => {
    const asked = comment("c1", "question", 2);
    asked.thread = [{ author: "agent", text: "how much bigger?", at: 2 }];

    expect(pendingQuestion(asked)).toBe("how much bigger?");
  });

  it("is silent for a comment that is not waiting on anybody", () => {
    const open = comment("c1", "open", 2);
    open.thread = [{ author: "agent", text: "done", at: 2 }];

    expect(pendingQuestion(open)).toBeNull();
    expect(pendingQuestion(comment("c2", "resolved", 2))).toBeNull();
  });

  // A state the backend does not produce. Showing no box is better than
  // showing one under somebody's own last words.
  it("is silent when the last word was the user's", () => {
    const odd = comment("c1", "question", 2);
    odd.thread = [{ author: "user", text: "twice", at: 2 }];

    expect(pendingQuestion(odd)).toBeNull();
  });
});

describe("elsewhere", () => {
  it("marks a comment left on another page", () => {
    const other = comment("c1", "open", 1);
    other.page = { url: "http://localhost:5173/settings", title: "Settings" };

    expect(elsewhere(other, "http://localhost:5173/")).toBe(true);
    expect(elsewhere(comment("c2", "open", 1), "http://localhost:5173/")).toBe(false);
  });

  // Nothing is loaded, so there is no "elsewhere" to be. Marking every row
  // would be marking none of them.
  it("marks nothing when no page is loaded", () => {
    expect(elsewhere(comment("c1", "open", 1), null)).toBe(false);
  });
});

describe("elementLabel", () => {
  it("prefers the selector and falls back to the tag", () => {
    expect(elementLabel(comment("c1", "open", 1))).toBe(".cta");

    const nameless = comment("c2", "open", 1);
    nameless.element.selector = "";
    expect(elementLabel(nameless)).toBe("button");
  });
});

describe("STATUS_WORDING", () => {
  // Written from the reader's side, and each has to say something different —
  // a badge that reads the same in two states is a badge nobody looks at.
  it("names every status distinctly", () => {
    const words = Object.values(STATUS_WORDING);
    expect(new Set(words).size).toBe(words.length);
    expect(STATUS_WORDING.question).toMatch(/you/i);
  });
});
