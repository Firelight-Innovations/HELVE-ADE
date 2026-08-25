/**
 * The GitHub panel's filter box: GitHub's own `is:` / `label:` vocabulary,
 * parsed into something the list can filter with.
 *
 * Adapted from `src/shared/task-query.ts` in `stablyai/orca` (MIT-licensed,
 * © Stably AI) — the qualifier set, the two-scope collapse, and the rule that an
 * unrecognised qualifier falls through to free text rather than being an error.
 * The quote-aware tokenizer is the same idea rewritten; Orca's also serializes a
 * query back to a string for its URL bar, and this has nowhere to put one, so
 * that half is absent.
 *
 * Why GitHub's syntax rather than a row of dropdowns: it is a syntax the people
 * using this panel already type on github.com every day, and a filter that
 * accepts what they are used to typing costs them nothing to learn. The cost is
 * that a qualifier we do not support has to fail quietly — see `freeText`.
 */
import type { GithubItem, GithubScope } from "../contract";

/** Which kinds the list shows. `all` is both, and is the default. */
export type QueryScope = "all" | "issue" | "pull";

/**
 * Which lifecycle states the list shows.
 *
 * `merged` is here and deliberately not in `GithubScope`, which is what gets
 * sent to GitHub: the API has no merged state, so a merged-only view is a
 * *closed* fetch narrowed on this side. [`fetchScopeOf`] is where the two part
 * company.
 */
export type QueryState = "open" | "closed" | "merged" | "all";

export interface ParsedQuery {
  scope: QueryScope;
  state: QueryState;
  /** `is:draft`. Only a pull request can satisfy it. */
  draft: boolean;
  /** `author:someone`, lowercased. `null` when unset. */
  author: string | null;
  /** Every `label:` given. An item must carry all of them, not any — which is
   *  what GitHub does, and the more useful of the two for narrowing. */
  labels: string[];
  /** Whatever was not a qualifier, joined back with single spaces. Matched
   *  against the title and the number. */
  freeText: string;
}

interface Token {
  /** With quotes stripped — what a qualifier's value is read from. */
  value: string;
  /** As typed, quotes included. Free text keeps this so an exact phrase
   *  survives being echoed back into the box. */
  raw: string;
}

/**
 * Split on whitespace, except inside quotes.
 *
 * **A quote only opens at the start of a token or straight after a colon.**
 * Orca's tokenizer opens on a quote character anywhere, which is the obvious
 * reading and is wrong for the commonest thing anyone types: in `it's broken
 * is:pr`, the apostrophe opens a quote that never closes, so the rest of the
 * line becomes one token and `is:pr` stops being a qualifier. Restricting where
 * a quote may open costs nothing real — `"exact phrase"` and `label:"needs
 * design"` are the only two shapes anybody writes — and leaves an apostrophe
 * inside a word alone.
 *
 * An unclosed quote is not an error. The final `flush` keeps what was read, so
 * a half-typed `label:"needs` filters on `needs` rather than on nothing.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let value = "";
  let raw = "";
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (value || raw) tokens.push({ value, raw });
    value = "";
    raw = "";
  };

  for (const char of input) {
    if (quote === null && /\s/.test(char)) {
      flush();
      continue;
    }
    const opensHere = raw === "" || raw.endsWith(":");
    raw += char;
    if (quote === null && opensHere && (char === '"' || char === "'")) {
      quote = char;
      continue;
    }
    if (quote !== null && char === quote) {
      quote = null;
      continue;
    }
    value += char;
  }
  flush();
  return tokens;
}

const EMPTY: ParsedQuery = {
  scope: "all",
  state: "open",
  draft: false,
  author: null,
  labels: [],
  freeText: "",
};

/**
 * Read a filter box into a query.
 *
 * Never throws and never reports a syntax error. A token it does not recognise
 * becomes free text, which is GitHub's own behaviour and the only forgiving
 * option for a box somebody types into a character at a time — a parser that
 * went red halfway through `is:op` would be wrong about every query on its way
 * to being right about the finished one.
 *
 * `is:issue is:pr` collapses to `all` rather than to an empty list. Two scopes
 * that exclude each other is nobody's intent, and Orca resolves it the same way.
 */
export function parseQuery(input: string): ParsedQuery {
  const query: ParsedQuery = { ...EMPTY, labels: [] };
  const free: string[] = [];
  let sawIssue = false;
  let sawPull = false;

  for (const { value, raw } of tokenize(input.trim())) {
    const lowered = value.toLowerCase();

    if (lowered === "is:issue") {
      sawIssue = true;
      query.scope = sawPull ? "all" : "issue";
      continue;
    }
    if (lowered === "is:pr" || lowered === "is:pull" || lowered === "is:pull-request") {
      sawPull = true;
      query.scope = sawIssue ? "all" : "pull";
      continue;
    }
    if (lowered === "is:open" || lowered === "is:closed" || lowered === "is:merged") {
      query.state = lowered.slice(3) as QueryState;
      continue;
    }
    if (lowered === "is:draft") {
      // A draft is an open pull request, so the qualifier implies both. Setting
      // them here rather than only at the filter keeps the box and the list
      // agreeing about what is being shown.
      query.scope = "pull";
      query.state = "open";
      query.draft = true;
      continue;
    }

    const colon = value.indexOf(":");
    const key = colon > 0 ? lowered.slice(0, colon) : "";
    const rest = colon > 0 ? value.slice(colon + 1).trim() : "";
    if (!rest) {
      free.push(raw);
      continue;
    }
    if (key === "author") {
      query.author = rest.replace(/^@/, "").toLowerCase();
      continue;
    }
    if (key === "label") {
      query.labels.push(rest.toLowerCase());
      continue;
    }
    if (key === "state" && ["open", "closed", "merged", "all"].includes(rest.toLowerCase())) {
      query.state = rest.toLowerCase() as QueryState;
      continue;
    }

    free.push(raw);
  }

  // Only a pull request can be merged, so asking for merged is asking for pull
  // requests whether or not `is:pr` was also typed.
  if (query.state === "merged") query.scope = "pull";

  query.freeText = free.join(" ").trim();
  return query;
}

// --- writing a query back, for the buttons above the box ---------------------
//
// The panel's kind and state buttons do not hold state of their own. They read
// their highlight out of the parsed query and, when pressed, rewrite the text
// in the box — so the box stays the single source of truth and there is no way
// for a button and a typed `is:pr` to disagree. The cost is that pressing a
// button visibly edits what somebody typed, which is the behaviour GitHub's own
// filter buttons have and the one that makes the syntax discoverable.

/** Every spelling that sets the kind, so a rewrite can drop them all. */
const KIND_TOKENS = new Set(["is:issue", "is:pr", "is:pull", "is:pull-request"]);

/** Every spelling that sets the state, `is:draft` included — it is a state
 *  qualifier that also happens to imply a kind. */
const STATE_TOKENS = new Set([
  "is:open",
  "is:closed",
  "is:merged",
  "is:draft",
  "state:open",
  "state:closed",
  "state:merged",
  "state:all",
]);

/** States only a pull request can be in. Changing the kind to anything else has
 *  to drop these, or the qualifier left behind would overrule the press. */
const PULL_ONLY_TOKENS = new Set(["is:draft", "is:merged", "state:merged"]);

/** What to write for each kind. `all` writes nothing: it is the default, and a
 *  box that fills up with qualifiers meaning "no filter" is worse than empty. */
const KIND_QUALIFIER: Record<QueryScope, string | null> = {
  all: null,
  issue: "is:issue",
  pull: "is:pr",
};

/** What to write for each state. `open` is the default and so writes nothing. */
const STATE_QUALIFIER: Record<QueryState, string | null> = {
  open: null,
  closed: "is:closed",
  merged: "is:merged",
  all: "state:all",
};

/** Qualifiers first, then whatever was already typed, as typed. */
function rebuild(qualifiers: (string | null)[], kept: Token[]): string {
  return [...qualifiers.filter((q) => q !== null), ...kept.map((token) => token.raw)]
    .join(" ")
    .trim();
}

/**
 * The same filter box, narrowed to one kind.
 *
 * Free text, labels and the author survive untouched — pressing "Issues" while
 * `label:bug crash` is typed should narrow what is already on screen rather
 * than throw it away.
 */
export function withScope(input: string, scope: QueryScope): string {
  const kept = tokenize(input.trim()).filter(({ value }) => {
    const lowered = value.toLowerCase();
    if (KIND_TOKENS.has(lowered)) return false;
    return scope === "pull" || !PULL_ONLY_TOKENS.has(lowered);
  });
  return rebuild([KIND_QUALIFIER[scope]], kept);
}

/**
 * The same filter box, moved to one lifecycle state.
 *
 * A pull-request-only view stays one. `is:draft` is the reason this is not just
 * a token swap: it is the only qualifier that sets both axes, so dropping it to
 * change the state would silently widen the list back to issues as well, and
 * the kind is put back explicitly when that is about to happen.
 */
export function withState(input: string, state: QueryState): string {
  const wasPull = parseQuery(input).scope === "pull";
  const kept = tokenize(input.trim()).filter(({ value }) => !STATE_TOKENS.has(value.toLowerCase()));
  const carriesKind = kept.some(({ value }) => KIND_TOKENS.has(value.toLowerCase()));
  const kind = wasPull && !carriesKind ? KIND_QUALIFIER.pull : null;
  return rebuild([STATE_QUALIFIER[state], kind], kept);
}

/**
 * What the query asks for, as a noun phrase — "open pull requests".
 *
 * For the empty list. "Nothing matches that filter" is the wrong sentence when
 * the only thing narrowing the list is a button somebody pressed: the honest
 * answer is that the repository has no closed pull requests, and saying so is
 * what stops an empty panel reading as a broken one.
 */
export function describeQuery(query: ParsedQuery): string {
  const kind =
    query.scope === "issue"
      ? "issues"
      : query.scope === "pull"
        ? "pull requests"
        : "issues or pull requests";
  if (query.draft) return `draft ${kind}`;
  return query.state === "all" ? kind : `${query.state} ${kind}`;
}

/**
 * Whether anything the buttons cannot express is narrowing the list.
 *
 * The kind and state axes are drawn above the list and can be seen; a label, an
 * author or a word typed into the box cannot, so only those make "nothing
 * matches that filter" the right thing to say.
 */
export function narrowsByText(query: ParsedQuery): boolean {
  return query.freeText !== "" || query.author !== null || query.labels.length > 0;
}

/**
 * What to actually ask GitHub for, given a query.
 *
 * The one place the panel's four states become the API's three. `merged` fetches
 * `closed`, because that is where merged pull requests live; the narrowing to
 * *only* merged then happens in [`matchesQuery`], over items already in hand.
 *
 * This is what makes `is:closed` return something. A client-side filter over an
 * open-only feed would narrow an empty set and draw an empty list, which is
 * exactly the silent emptiness `GithubFeed` exists to rule out.
 */
export function fetchScopeOf(query: ParsedQuery): GithubScope {
  switch (query.state) {
    case "open":
      return "open";
    case "closed":
    case "merged":
      return "closed";
    case "all":
      return "all";
  }
}

/** Whether an item survives the query. Every clause is an AND, GitHub's rule. */
export function matchesQuery(item: GithubItem, query: ParsedQuery): boolean {
  if (query.scope !== "all" && item.kind !== query.scope) return false;

  if (query.state === "merged" && item.state !== "merged") return false;
  if (query.state === "open" && item.state !== "open" && item.state !== "draft") return false;
  // A merged pull request is closed, so a closed view holds it. This mirrors
  // the fetch: `state=closed` returns merged and unmerged alike, and hiding
  // half of them would make the list disagree with the request behind it.
  if (query.state === "closed" && item.state !== "closed" && item.state !== "merged") return false;

  if (query.draft && item.state !== "draft") return false;

  if (query.author && item.author?.toLowerCase() !== query.author) return false;

  if (query.labels.length > 0) {
    const carried = new Set(item.labels.map((label) => label.toLowerCase()));
    if (!query.labels.every((label) => carried.has(label))) return false;
  }

  if (query.freeText) {
    // The number is searched as well as the title, so pasting `142` finds
    // issue 142 rather than every title with 142 in it and not that one.
    const haystack = `${item.title} #${item.number}`.toLowerCase();
    const needle = query.freeText.replace(/^#/, "").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/**
 * A whole feed narrowed and left in its existing order.
 *
 * Order is the backend's — newest activity first, both kinds interleaved — and
 * filtering deliberately does not re-sort. A list that reordered as somebody
 * typed would move the row they were reaching for.
 */
export function applyQuery(items: GithubItem[], query: ParsedQuery): GithubItem[] {
  return items.filter((item) => matchesQuery(item, query));
}
