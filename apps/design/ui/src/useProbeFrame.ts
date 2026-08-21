/**
 * The frame under inspection, and everything that has to happen in order for a
 * click inside it to become a capture.
 *
 * All of the sequencing lives here rather than in `App.tsx`, because it is
 * sequencing: install the probe *before* navigating, arm the overlay only while
 * picking, take the overlay off screen and wait for it to have been *painted*
 * off before photographing, put it back afterwards. Each of those has a wrong
 * order that still appears to work — a screenshot with the highlight box in it,
 * a probe that never arrives because the document was created before the script
 * existed — and keeping them in one file is what makes the order reviewable.
 *
 * The identity rule is the same one `ToolWindow.tsx` uses for the shell's own
 * frames: a message is this frame's only if `event.source` is the frame's own
 * `contentWindow`, compared against the reference React gave us. Nothing in a
 * message body is ever consulted to decide who sent it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { absoluteRect, envelope, readProbeMessage, type PickedElement, type Rect } from "./probe";
import {
  arm,
  capture,
  disarm,
  reasonFor,
  resolveTarget,
  type Screenshot,
  type Target,
} from "./rpc";

/** How long the probe gets to acknowledge that the overlay is off screen.
 *  Generous — it is two animation frames in a page that may be busy — and
 *  bounded, because a page that never answers must not strand the capture. */
const VEIL_TIMEOUT_MS = 1500;

export type Phase = "empty" | "loading" | "ready" | "picking";

/** One captured element, and the picture of it if there is one. */
export interface Capture {
  element: PickedElement;
  shot: Screenshot | null;
  /** Why there is no picture. `null` when there is one. Shown, rather than
   *  swallowed: a missing screenshot with no explanation reads as a bug in the
   *  page, and it is usually a bounded thing about where the window is. */
  shotProblem: string | null;
}

/**
 * Where each frame between here and the top-level document sits inside its
 * parent, innermost first — or `null` if that cannot be established.
 *
 * `window.frameElement` throws for a cross-origin parent, and that is the case
 * this returns `null` for. It does not arise today: an app's frontend is an
 * entry point of the shell's own build and so is same-origin with the shell
 * (`apps::entry_url` says so in as many words). It would arise the day Design
 * Mode were extracted into a tool repository, which is served from its own
 * origin — so the failure is handled rather than assumed away, and the caller
 * skips the screenshot rather than cropping the wrong rectangle.
 */
function frameChain(frame: HTMLIFrameElement): Rect[] | null {
  const box = (element: Element & { clientLeft: number; clientTop: number }): Rect => {
    const rect = element.getBoundingClientRect();
    // The frame's *viewport* starts inside its border, and the rect is of the
    // border box. Zero today, because `design.css` gives the frame no border,
    // and added anyway so a future border is not a silent two-pixel drift.
    return {
      x: rect.left + element.clientLeft,
      y: rect.top + element.clientTop,
      width: rect.width,
      height: rect.height,
    };
  };

  const chain: Rect[] = [box(frame)];
  let level: Window = window;
  while (level.parent !== level) {
    let owner: Element | null;
    try {
      owner = level.frameElement;
    } catch {
      return null;
    }
    if (!(owner instanceof HTMLIFrameElement)) return null;
    chain.push(box(owner));
    level = level.parent;
  }
  return chain;
}

export interface ProbeFrame {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  target: Target | null;
  phase: Phase;
  /** Something the person needs to read: a refused address, a page that would
   *  not describe an element. Cleared by the next action. */
  notice: string | null;
  captured: Capture | null;
  onFrameLoad: () => void;
  load: (address: string) => void;
  togglePicking: () => void;
  dismiss: () => void;
}

export function useProbeFrame(): ProbeFrame {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const scriptId = useRef<string | null>(null);
  /** Resolvers for `veil` acknowledgements, keyed by the id sent with each. */
  const veils = useRef(new Map<string, () => void>());
  const nextVeil = useRef(0);

  const [target, setTarget] = useState<Target | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [notice, setNotice] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Capture | null>(null);

  const tell = useCallback((command: Parameters<typeof envelope>[0]) => {
    frameRef.current?.contentWindow?.postMessage(envelope(command), "*");
  }, []);

  /** Take the overlay off screen and wait until the page has painted without
   *  it, or give up. Resolves either way: a photograph with a highlight box in
   *  it is worse than none, but so is no photograph at all. */
  const veil = useCallback(
    (on: boolean) =>
      new Promise<void>((resolve) => {
        const id = `veil-${(nextVeil.current += 1)}`;
        const settle = () => {
          veils.current.delete(id);
          resolve();
        };
        veils.current.set(id, settle);
        tell({ kind: "veil", on, id });
        window.setTimeout(settle, VEIL_TIMEOUT_MS);
      }),
    [tell],
  );

  const photograph = useCallback(
    async (element: PickedElement): Promise<Pick<Capture, "shot" | "shotProblem">> => {
      const frame = frameRef.current;
      if (!frame) return { shot: null, shotProblem: "the page went away" };

      // `design/capture` photographs the *focused* window, because nothing maps
      // a cluster to an operating system window — `capture` in `design.rs` has
      // the whole account. This is the frontend's half of that: with two HELVE
      // windows open, only the focused one may ask.
      if (!document.hasFocus()) {
        return { shot: null, shotProblem: "this window was not in front when the click landed" };
      }

      const chain = frameChain(frame);
      if (!chain) {
        return { shot: null, shotProblem: "this frame cannot work out where it is on screen" };
      }

      await veil(true);
      try {
        const shot = await capture(absoluteRect(element.target.rect, chain));
        return { shot, shotProblem: null };
      } catch (err) {
        return { shot: null, shotProblem: reasonFor(err) };
      } finally {
        await veil(false);
      }
    },
    [veil],
  );

  const onPicked = useCallback(
    async (element: PickedElement) => {
      // One element per arming. Picking is a deliberate act with a result to
      // read, not a mode to leave running — and leaving the overlay up would
      // put the crosshair over the panel showing what was just captured.
      setPhase("ready");
      tell({ kind: "disarm" });
      setCaptured({ element, shot: null, shotProblem: null });
      const picture = await photograph(element);
      setCaptured({ element, ...picture });
    },
    [photograph, tell],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // The whole of the sender check. A page can post to its parent whenever
      // it likes; what it cannot do is be a frame this app did not mount.
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;

      const message = readProbeMessage(event.data);
      if (!message) return;

      switch (message.kind) {
        case "veiled":
          veils.current.get(message.id)?.();
          break;
        case "picked":
          void onPicked(message.element);
          break;
        case "cancelled":
          setPhase("ready");
          break;
        case "failed":
          setPhase("ready");
          setNotice(message.reason);
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onPicked]);

  // The script outlives this component — it belongs to the window's webview,
  // not to a React tree — so closing the tab has to take it away explicitly.
  useEffect(
    () => () => {
      const installed = scriptId.current;
      if (installed) void disarm(installed).catch(() => {});
    },
    [],
  );

  const load = useCallback((address: string) => {
    setNotice(null);
    setCaptured(null);
    setPhase("loading");

    void (async () => {
      try {
        const resolved = await resolveTarget(address);
        // Installed *before* the frame is pointed anywhere. A document-created
        // script only reaches documents created after it exists, so arming
        // after navigation would leave the first page without a probe and no
        // sign of why.
        const { scriptId: id } = await arm(scriptId.current);
        scriptId.current = id;
        setTarget(resolved);
      } catch (err) {
        setPhase("empty");
        setTarget(null);
        setNotice(reasonFor(err));
      }
    })();
  }, []);

  const onFrameLoad = useCallback(() => {
    setPhase((current) => (current === "loading" ? "ready" : current));
  }, []);

  const togglePicking = useCallback(() => {
    setNotice(null);
    setPhase((current) => {
      if (current === "picking") {
        tell({ kind: "disarm" });
        return "ready";
      }
      if (current !== "ready") return current;
      tell({ kind: "arm" });
      return "picking";
    });
  }, [tell]);

  const dismiss = useCallback(() => {
    setCaptured(null);
    setNotice(null);
  }, []);

  return {
    frameRef,
    target,
    phase,
    notice,
    captured,
    onFrameLoad,
    load,
    togglePicking,
    dismiss,
  };
}
