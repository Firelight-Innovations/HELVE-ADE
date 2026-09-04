// @vitest-environment jsdom
/**
 * The regression test for the source-control row that could not be clicked at
 * the edge of a scrolling list (#48.1, and the reason issue #74 exists).
 *
 * **It does not reproduce the defect, and cannot.** That defect is a
 * `mousedown`/`mouseup` pairing broken by a scroll; a scroll needs layout and
 * hit-testing, and jsdom has neither — nothing here has a size or overflows,
 * so the browser focus-scroll that caused the bug cannot happen. A
 * `fireEvent.click` on an "edge" row passes whether the fix is present or
 * absent, which is exactly the test that passes for the wrong reason.
 * `vitest.config.ts` records what *would* catch the symptom, and why it is not
 * here.
 *
 * It pins the fix's mechanism instead, which is a genuinely failing test
 * before the fix: all three of unwiring the handler, dropping `preventDefault`
 * and dropping `preventScroll` turn these red.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GitControl, GitFileChange, GitStatus, ReviewControl, ReviewSend } from "../contract";
import { focusWithoutScrolling } from "./rowFocus";
import SourceControlView from "./SourceControlView";
import type { GitStatusHandle } from "./useGitStatus";

afterEach(cleanup);

const CLUSTER = "cluster-1";

function change(path: string, staged: boolean): GitFileChange {
  const cut = path.lastIndexOf("/");
  return {
    path,
    file: cut === -1 ? path : path.slice(cut + 1),
    dir: cut === -1 ? "" : path.slice(0, cut),
    kind: "modified",
    staged,
    insertions: 1,
    deletions: 0,
  };
}

const STATUS: GitStatus = {
  branch: "main",
  ahead: 0,
  behind: 0,
  insertions: 2,
  deletions: 0,
  staged: [change("src/alpha.ts", true)],
  unstaged: [change("src/beta.ts", false)],
};

/**
 * `diff` never settles on purpose. A resolved diff renders `AnnotatedDiff`,
 * which is `lazy` precisely because it drags Monaco in; leaving the promise
 * pending keeps the panel on its "Loading diff…" line, so the click is still
 * observable through the call itself without importing an editor into a test
 * about a mouse button.
 */
function fakeGit(): { control: GitControl; diffCalls: unknown[][] } {
  const diffCalls: unknown[][] = [];
  const control: GitControl = {
    status: () => Promise.resolve(STATUS),
    diff: (clusterId, path, staged) => {
      diffCalls.push([clusterId, path, staged]);
      return new Promise(() => {});
    },
    stage: () => Promise.resolve(),
    unstage: () => Promise.resolve(),
    commit: () => Promise.resolve(),
  };
  return { control, diffCalls };
}

const REVIEW: ReviewControl = {
  list: () => Promise.resolve([]),
  add: () => Promise.reject(new Error("not used")),
  update: () => Promise.reject(new Error("not used")),
  resolve: () => Promise.reject(new Error("not used")),
  remove: () => Promise.resolve(),
  markSent: () => Promise.resolve(0),
};

const SEND: ReviewSend = {
  terminalId: null,
  toTerminal: () => {},
  toClipboard: () => Promise.resolve(),
};

function renderPanel(control: GitControl) {
  const git: GitStatusHandle = { status: STATUS, loading: false, error: null, refresh: () => {} };
  render(
    <SourceControlView
      control={control}
      clusterId={CLUSTER}
      git={git}
      review={REVIEW}
      reviewSend={SEND}
    />,
  );
}

/** Both lists, because the defect was position-dependent rather than
 *  list-dependent and the wiring is duplicated per section. */
const ROWS: { name: string; label: RegExp }[] = [
  { name: "a staged row", label: /alpha\.ts/ },
  { name: "an unstaged row", label: /beta\.ts/ },
];

describe("focusWithoutScrolling", () => {
  it("cancels the event's default so the browser does not focus and scroll", () => {
    const element = document.createElement("button");
    document.body.append(element);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    element.addEventListener("mousedown", (native) => {
      // The helper takes React's synthetic event; the two agree on these two
      // members, which are the only ones it touches.
      focusWithoutScrolling(native as unknown as Parameters<typeof focusWithoutScrolling>[0]);
    });

    const focus = vi.spyOn(element, "focus");
    element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    element.remove();
  });
});

describe("a source-control row's mousedown", () => {
  for (const row of ROWS) {
    it(`cancels the default and focuses without scrolling — ${row.name}`, () => {
      const { control } = fakeGit();
      renderPanel(control);

      const button = screen.getByRole("button", { name: row.label });
      const focus = vi.spyOn(button, "focus");
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      fireEvent(button, event);

      // Cancelling the default is what suppresses Chromium's focus-on-mousedown,
      // and the scroll that came with it. Without this the row still moves.
      expect(event.defaultPrevented).toBe(true);
      // …and this is what puts the focus back, minus the scroll. Without the
      // option the row is focused and the list jumps, which is the original bug.
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(button);
    });
  }

  /**
   * The rejected alternative in `docs/design-notes/shell-worktree.md` — activate
   * on `pointerup`/`mousedown` instead of `click` — would have to keep `onClick`
   * beside it for the keyboard, and every mouse activation would then run twice.
   * One call for one full press is what says that did not happen.
   */
  it("still activates the row exactly once through click", () => {
    const { control, diffCalls } = fakeGit();
    renderPanel(control);

    const button = screen.getByRole("button", { name: /alpha\.ts/ });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    expect(diffCalls).toEqual([[CLUSTER, "src/alpha.ts", true]]);
  });
});
