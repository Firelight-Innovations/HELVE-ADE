import { useCallback, useEffect, useRef } from "react";
import type { ToolPresentation } from "../contract";
import { useToolFrontend } from "../state/toolFrontend";
import BootOverlay from "./BootOverlay";
import UnavailableState from "./UnavailableState";

/**
 * One docked tool's slot in the tool window: its iframe (once a URL is
 * known), the boot overlay laid over it until the handshake completes, or
 * the unavailable state in place of an empty iframe.
 *
 * Mounted once per tool id and kept mounted for the component's lifetime —
 * `ToolWindow` renders every docked tool, not just the active one, so this
 * never unmounts on a tab switch. `useToolFrontend`'s effect only re-runs if
 * `tool.id` changes, which it doesn't for a stable instance, so the iframe
 * (once it exists) is never re-keyed or re-parented either.
 */
export default function ToolMount({
  tool,
  active,
  ready,
  registerFrame,
  unregisterFrame,
}: {
  tool: ToolPresentation;
  /** Whether this is the tab currently shown. Inactive slots stay mounted. */
  active: boolean;
  /** Whether this tool's hello/ready handshake has completed. */
  ready: boolean;
  registerFrame: (toolId: string, win: Window) => void;
  unregisterFrame: (win: Window) => void;
}) {
  const frontend = useToolFrontend(tool.id);
  const windowRef = useRef<Window | null>(null);

  // `useCallback` keyed on stable deps so the ref callback's identity never
  // changes across re-renders — an inline arrow here would make React detach
  // and reattach the ref (and so re-register the frame) on every render,
  // which is wasted churn even though it wouldn't lose iframe state.
  const setIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (windowRef.current) unregisterFrame(windowRef.current);
      windowRef.current = el?.contentWindow ?? null;
      if (windowRef.current) registerFrame(tool.id, windowRef.current);
    },
    [tool.id, registerFrame, unregisterFrame],
  );

  useEffect(() => {
    return () => {
      if (windowRef.current) unregisterFrame(windowRef.current);
    };
  }, [unregisterFrame]);

  // `null` — URL still resolving. The tool window shows its boot state for
  // this, not an error; there is no iframe to mount yet.
  if (frontend === null) {
    return (
      <div className="toolwindow__slot" data-active={active || undefined}>
        <BootOverlay toolName={tool.name} />
      </div>
    );
  }

  if (frontend.state === "unavailable") {
    return (
      <div className="toolwindow__slot" data-active={active || undefined}>
        <UnavailableState tool={tool} reason={frontend.reason} />
      </div>
    );
  }

  return (
    <div className="toolwindow__slot" data-active={active || undefined}>
      <iframe ref={setIframe} src={frontend.url} title={tool.name} className="toolwindow__iframe" />
      {/* Laid over the iframe, not in place of it — the frame starts loading
          the moment its URL is known. This only disappears once the tool's
          own `hello` has been answered with `ready`. */}
      {!ready && <BootOverlay toolName={tool.name} />}
    </div>
  );
}
