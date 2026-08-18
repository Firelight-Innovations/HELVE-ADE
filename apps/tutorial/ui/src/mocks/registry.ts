/**
 * The closed set of mockups a tutorial may draw, and how to find one.
 *
 * `MockName` is a string-literal union rather than a plain `string` on the
 * `mock` block in `content/blocks.ts`, so a typo'd name is a type error at the
 * tutorial that made it rather than a blank figure discovered by reading. Add
 * a mock by adding it here and to `MOCKS` in the same commit — nothing else
 * in the app knows this list exists.
 */
import type { ReactElement } from "react";

import windowBands from "./windowBands";
import titleBar from "./titleBar";
import statusBar from "./statusBar";
import switcherBar from "./switcherBar";
import paneSplit from "./paneSplit";
import homeStart from "./homeStart";
import projectFiles from "./projectFiles";
import explorerTree from "./explorerTree";
import viewerTabs from "./viewerTabs";
import searchOverlay from "./searchOverlay";
import settingsScreen from "./settingsScreen";
import terminalBand from "./terminalBand";
import sourceControl from "./sourceControl";
import worktreeList from "./worktreeList";
import stackList from "./stackList";
import mcpToggle from "./mcpToggle";

export type MockName =
  | "window-bands"
  | "title-bar"
  | "status-bar"
  | "switcher-bar"
  | "pane-split"
  | "home-start"
  | "project-files"
  | "explorer-tree"
  | "viewer-tabs"
  | "search-overlay"
  | "settings-screen"
  | "terminal-band"
  | "source-control"
  | "worktree-list"
  | "stack-list"
  | "mcp-toggle";

export const MOCKS: Record<MockName, () => ReactElement> = {
  "window-bands": windowBands,
  "title-bar": titleBar,
  "status-bar": statusBar,
  "switcher-bar": switcherBar,
  "pane-split": paneSplit,
  "home-start": homeStart,
  "project-files": projectFiles,
  "explorer-tree": explorerTree,
  "viewer-tabs": viewerTabs,
  "search-overlay": searchOverlay,
  "settings-screen": settingsScreen,
  "terminal-band": terminalBand,
  "source-control": sourceControl,
  "worktree-list": worktreeList,
  "stack-list": stackList,
  "mcp-toggle": mcpToggle,
};
