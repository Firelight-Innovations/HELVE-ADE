/**
 * How something outside `ToolWindow`'s own component tree reaches into a
 * mounted app frame.
 *
 * `ToolWindow` keeps the only trustworthy map from a window to its iframes —
 * see that file's own header — and until now that map was private to the
 * component, reached only through the `ToolWindowHandle` ref `WindowRoot.tsx`
 * holds. That is fine for the title bar's menu commands, which are already
 * inside `WindowRoot`'s tree and can be handed the ref as a prop. It stops
 * being fine the moment something *outside* that tree needs to reach a
 * frame — which is exactly `src/shell/search/openHit.ts`'s situation: opening
 * a search hit has to find the right window's Files instance and push a path
 * into it, and it is deliberately not a component with a ref to receive.
 *
 * A window label is the address both sides already agree on —
 * `state/shellState.ts`'s `windowLabel()` reads it from the URL and is
 * callable from anywhere, so a caller with no props to lean on can still say
 * *which* window it means. This registry is the other half: the one
 * `ToolWindow` a window mounts registers itself here under that same label,
 * and a caller elsewhere looks it up the same way.
 *
 * Directly under `src/shell/` rather than inside `toolwindow/` for that reason:
 * a lookup table two regions share is neither one's to own (STANDARDS.md §1.2).
 *
 * Not exposed on `ToolWindowHandle` itself. That type is the title bar's
 * contract — one frame, whichever is active, a bare command string — and
 * widening it to "any frame, any event, any payload" would let a menu command
 * accidentally reach a background pane. This is a narrower, separate surface
 * for a narrower, separate job.
 */
export interface ToolWindowBridge {
  /**
   * Deliver `event`/`payload` to `instanceId`'s frame once its hello/ready
   * handshake has completed, queuing the request if it has not yet. See
   * `ToolWindow.tsx`'s `sendEventWhenReady` for why the queue exists at all —
   * the short version is that an instance id can be minted, and handed to
   * this call, well before the iframe behind it has mounted.
   */
  sendEventWhenReady(instanceId: string, event: string, payload: unknown): void;
}

const bridges = new Map<string, ToolWindowBridge>();

export function registerToolWindow(label: string, bridge: ToolWindowBridge): void {
  bridges.set(label, bridge);
}

export function unregisterToolWindow(label: string): void {
  bridges.delete(label);
}

/**
 * The bridge for one window, or `undefined` before its `ToolWindow` has
 * mounted — a window whose first paint has not landed has no frame to reach
 * into yet, and there is no overlay to open a search hit from until it has.
 */
export function toolWindowBridge(label: string): ToolWindowBridge | undefined {
  return bridges.get(label);
}
