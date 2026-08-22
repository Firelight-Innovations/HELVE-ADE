/**
 * The filter box's parser and predicate.
 *
 * Beside the module it tests and so under the same region import rules
 * (STANDARDS.md §8.3). Everything here is pure — no fetch, no component — which
 * is the whole reason this logic sits in its own module rather than inside
 * `GithubPanel`.
 */
import { describe, expect, it } from "vitest";
import type { GithubItem } from "../contract";
import { applyQuery, fetchScopeOf, matchesQuery, parseQuery } from "./query";

function item(over: Partial<GithubItem> = {}): GithubItem {
  return {
    id: "issue-1",
    kind: "issue",
    number: 1,
    title: "Something broke",
    state: "open",
    url: "https://github.com/o/n/issues/1",
    labels: [],
    updatedAt: "2026-08-01T00:00:00Z",
    author: "someone",
    headBranch: null,
    suggestedBranch: "issue-1-something-broke",
    ...over,
  };
}

describe("parseQuery", () => {
  it("defaults to every kind and only open items", () => {
    const query = parseQuery("");
    expect(query.scope).toBe("all");
    expect(query.state).toBe("open");
    expect(query.freeText).toBe("");
  });

  it("reads the kind and state qualifiers", () => {
    expect(parseQuery("is:pr").scope).toBe("pull");
    expect(parseQuery("is:issue").scope).toBe("issue");
    expect(parseQuery("is:closed").state).toBe("closed");
    expect(parseQuery("state:all").state).toBe("all");
  });

  it("is case-insensitive about qualifiers", () => {
    expect(parseQuery("IS:PR").scope).toBe("pull");
    expect(parseQuery("Label:Bug").labels).toEqual(["bug"]);
  });

  it("collapses two opposed scopes to both rather than to neither", () => {
    expect(parseQuery("is:issue is:pr").scope).toBe("all");
    expect(parseQuery("is:pr is:issue").scope).toBe("all");
  });

  it("treats is:draft as an open pull request", () => {
    const query = parseQuery("is:draft");
    expect(query.scope).toBe("pull");
    expect(query.state).toBe("open");
    expect(query.draft).toBe(true);
  });

  it("narrows merged to pull requests, since only they can be", () => {
    expect(parseQuery("is:merged").scope).toBe("pull");
  });

  it("strips a leading @ from an author", () => {
    expect(parseQuery("author:@someone").author).toBe("someone");
    expect(parseQuery("author:Someone").author).toBe("someone");
  });

  it("collects every label rather than keeping the last", () => {
    expect(parseQuery("label:bug label:ui").labels).toEqual(["bug", "ui"]);
  });

  it("keeps a quoted value whole", () => {
    expect(parseQuery('label:"needs design"').labels).toEqual(["needs design"]);
  });

  it("does not let an apostrophe swallow the rest of the line", () => {
    const query = parseQuery("it's broken is:pr");
    expect(query.scope).toBe("pull");
    expect(query.freeText).toContain("broken");
  });

  /** The forgiving rule: a box being typed into is wrong most of the time. */
  it("passes an unrecognised qualifier through as free text", () => {
    expect(parseQuery("assignee:someone").freeText).toBe("assignee:someone");
    expect(parseQuery("is:op").freeText).toBe("is:op");
  });

  it("passes a bare colon-suffixed word through rather than dropping it", () => {
    expect(parseQuery("label:").freeText).toBe("label:");
  });

  it("keeps free text in the order it was typed", () => {
    expect(parseQuery("window is:pr crash").freeText).toBe("window crash");
  });
});

describe("fetchScopeOf", () => {
  /** The load-bearing one: `is:closed` has to change the request, not just the
   *  filter, or it narrows an open-only reply down to nothing every time. */
  it("sends merged and closed queries to a closed fetch", () => {
    expect(fetchScopeOf(parseQuery("is:merged"))).toBe("closed");
    expect(fetchScopeOf(parseQuery("is:closed"))).toBe("closed");
  });

  it("leaves the default fetch open", () => {
    expect(fetchScopeOf(parseQuery(""))).toBe("open");
    expect(fetchScopeOf(parseQuery("is:draft"))).toBe("open");
  });

  it("sends state:all to an all fetch", () => {
    expect(fetchScopeOf(parseQuery("state:all"))).toBe("all");
  });
});

describe("matchesQuery", () => {
  it("narrows by kind", () => {
    const query = parseQuery("is:pr");
    expect(matchesQuery(item({ kind: "pull" }), query)).toBe(true);
    expect(matchesQuery(item({ kind: "issue" }), query)).toBe(false);
  });

  it("counts a draft as open", () => {
    expect(matchesQuery(item({ kind: "pull", state: "draft" }), parseQuery(""))).toBe(true);
  });

  /** The list has to agree with the request behind it: a closed fetch returns
   *  merged pull requests, so a closed view has to show them. */
  it("counts a merged pull request as closed", () => {
    const query = parseQuery("is:closed");
    expect(matchesQuery(item({ kind: "pull", state: "merged" }), query)).toBe(true);
    expect(matchesQuery(item({ kind: "pull", state: "closed" }), query)).toBe(true);
    expect(matchesQuery(item({ state: "open" }), query)).toBe(false);
  });

  it("narrows merged to merged alone", () => {
    const query = parseQuery("is:merged");
    expect(matchesQuery(item({ kind: "pull", state: "merged" }), query)).toBe(true);
    expect(matchesQuery(item({ kind: "pull", state: "closed" }), query)).toBe(false);
  });

  it("narrows drafts to drafts", () => {
    const query = parseQuery("is:draft");
    expect(matchesQuery(item({ kind: "pull", state: "draft" }), query)).toBe(true);
    expect(matchesQuery(item({ kind: "pull", state: "open" }), query)).toBe(false);
  });

  it("matches an author regardless of case", () => {
    const query = parseQuery("author:Someone");
    expect(matchesQuery(item({ author: "someone" }), query)).toBe(true);
    expect(matchesQuery(item({ author: "another" }), query)).toBe(false);
  });

  it("does not match an author against an item that has none", () => {
    expect(matchesQuery(item({ author: null }), parseQuery("author:someone"))).toBe(false);
  });

  /** GitHub's rule, and the more useful one: two labels narrows, not widens. */
  it("requires every label, not any of them", () => {
    const query = parseQuery("label:bug label:ui");
    expect(matchesQuery(item({ labels: ["bug", "ui", "p1"] }), query)).toBe(true);
    expect(matchesQuery(item({ labels: ["bug"] }), query)).toBe(false);
  });

  it("matches free text against the title", () => {
    expect(matchesQuery(item({ title: "Window crash" }), parseQuery("crash"))).toBe(true);
    expect(matchesQuery(item({ title: "Window crash" }), parseQuery("terminal"))).toBe(false);
  });

  it("matches free text against the number, with or without a hash", () => {
    expect(matchesQuery(item({ number: 142 }), parseQuery("142"))).toBe(true);
    expect(matchesQuery(item({ number: 142 }), parseQuery("#142"))).toBe(true);
    expect(matchesQuery(item({ number: 7 }), parseQuery("#142"))).toBe(false);
  });
});

describe("applyQuery", () => {
  it("keeps the order it was given rather than re-sorting", () => {
    const items = [
      item({ id: "issue-3", number: 3, title: "Ccc" }),
      item({ id: "issue-1", number: 1, title: "Aaa" }),
      item({ id: "issue-2", number: 2, title: "Bbb" }),
    ];
    expect(applyQuery(items, parseQuery("")).map((i) => i.number)).toEqual([3, 1, 2]);
  });

  it("returns everything for an empty query", () => {
    const items = [item({ id: "a", number: 1 }), item({ id: "b", number: 2 })];
    expect(applyQuery(items, parseQuery("")).length).toBe(2);
  });
});
