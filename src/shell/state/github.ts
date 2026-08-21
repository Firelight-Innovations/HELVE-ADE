/**
 * The frontend half of the GitHub panel.
 *
 * Mirrors `src-tauri/src/github.rs`. One-shot calls and no subscription, for
 * `git.ts`'s reason: nothing pushes, so the region re-asks on a cluster switch
 * and when somebody presses refresh.
 *
 * Thin, and deliberately thinner than it looks like it should be. There is no
 * `open(item)` verb here even though opening an item is the one thing this
 * feature *does* — that is `worktreeControl.create(clusterId, suggestedBranch)`
 * from `git.ts`, called with a name Rust put on the item. A wrapper here would
 * be a second name for the existing call and would read like a second
 * worktree-creation path even though it could not be one.
 */
import { githubFeed, hasGithubToken, setGithubToken } from "../../bindings";
import type { GithubAuthControl, GithubControl } from "../contract";

export const githubControl: GithubControl = {
  feed(clusterId, scope) {
    return githubFeed(clusterId, scope);
  },
};

/**
 * Sign-in, sharing one token with the app library's own sign-in field.
 *
 * One credential per machine rather than per surface: `plugins::install` reads
 * the same entry in the OS credential store to install from a private
 * repository, and two tokens for one host would be two things to keep signed
 * in. A person who signs in here can install a private plugin, and the reverse.
 *
 * `isSignedIn` asks whether, never what. There is no binding that returns the
 * token and there should not be — a secret in the renderer is a secret in a
 * devtools console, which is the rule `mcp/commands.rs` states for its own.
 */
export const githubAuthControl: GithubAuthControl = {
  isSignedIn() {
    return hasGithubToken();
  },

  signIn(token) {
    return setGithubToken(token);
  },
};
