/**
 * The frontend half of the GitHub panel. Mirrors `src-tauri/src/github.rs`.
 *
 * One-shot calls and no subscription, for `git.ts`'s reason: nothing pushes, so
 * the region re-asks on a cluster switch and on refresh.
 *
 * Note what is absent. There is no `open(item)` verb, even though opening an
 * item is the one thing this feature does — that is `worktreeControl.create`
 * from `git.ts`, called with a name Rust put on the item. A wrapper here would
 * read like a second worktree-creation path without being one.
 */
import { githubFeed, githubOpenInBrowser, setGithubToken } from "../../bindings";
import type { GithubAuthControl, GithubControl } from "../contract";

export const githubControl: GithubControl = {
  feed(clusterId, scope) {
    return githubFeed(clusterId, scope);
  },

  openInBrowser(url) {
    return githubOpenInBrowser(url);
  },
};

/**
 * Sign-in, sharing one credential with the app library's own sign-in field:
 * `plugins::install` reads the same entry to install from a private repository,
 * and two tokens for one host would be two things to keep signed in.
 *
 * Write-only, and `hasGithubToken` is deliberately not wrapped: the feed's
 * `authenticated` already says whether the list on screen was fetched with a
 * token, and a second source for that could disagree with the list beside it.
 * Nothing reads the token itself — a secret in the renderer is a secret in a
 * devtools console, the rule `mcp/commands.rs` states for its own.
 */
export const githubAuthControl: GithubAuthControl = {
  signIn(token) {
    return setGithubToken(token);
  },
};
