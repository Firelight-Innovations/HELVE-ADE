/**
 * Every tutorial's prose, keyed by the id its catalog entry carries.
 *
 * The catalog — which tutorials exist, what they are called, how long they take
 * — is `src-tauri/src/apps/tutorial.rs`, because Home draws the same list. This
 * is the other half: the words, which never cross the wire.
 *
 * A key here with no catalog entry is simply never reached. A catalog entry with
 * no key here renders the "not written yet" panel in `Reader.tsx`. Neither is an
 * error, and that is what lets the two halves be edited in either order.
 */
import type { Body } from "./blocks";
import { theWindow } from "./theWindow";
import { firstProject } from "./firstProject";
import { panesAndClusters } from "./panesAndClusters";
import { terminals } from "./terminals";
import { search } from "./search";
import { settings } from "./settings";
import { filesAndEditing } from "./filesAndEditing";
import { gitAndWorktrees } from "./gitAndWorktrees";
import { mcpServers } from "./mcpServers";
import { theStack } from "./theStack";

export const BODIES: Record<string, Body> = {
  "the-window": theWindow,
  "first-project": firstProject,
  "panes-and-clusters": panesAndClusters,
  terminals,
  search,
  settings,
  "files-and-editing": filesAndEditing,
  "git-and-worktrees": gitAndWorktrees,
  "mcp-servers": mcpServers,
  "the-stack": theStack,
};
