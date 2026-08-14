import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  DragHandleProps,
  DropTarget,
  PaneNode,
  SurfaceInstance,
  ToolPresentation,
} from "../contract";
import { paneLeaves, paneOfTab, paneTabs } from "../contract";
import PaneTree from "../panes/PaneTree";
import XTermView from "../terminal/XTermView";
import { setInstanceTitle } from "../state/shellState";
import { terminalControl, terminalTransport } from "../state/terminals";
// The wire types come from the bridge package's source by relative path rather
// than from `@helve/bridge` itself. The root package does depend on that
// package now — the first-party apps under `apps/` import it, and they are
// built by this same Vite config — but the shell must not import its *client*,
// which is the tool half of transport B and reaches for `window.parent` at
// module load. Types and the error-code table have no such side effect.
import type {
  CommandMessage,
  EventMessage,
  HelloMessage,
  ReadyMessage,
  RequestMessage,
  ResponseMessage,
} from "../../../packages/bridge/src/protocol";
import { HelveErrorCode } from "../../../packages/bridge/src/errors";
import { appPainted } from "../../bindings";
import { callApp } from "../state/apps";
import { isFake } from "../state/fakeBackend";
import ToolMount from "./ToolMount";
import EmptyState from "./EmptyState";
import "./toolwindow.css";

/**
 * The tool window — the container every docked tool mounts into, plus its
 * boot and empty states.
 *
 * Owns the shell half of transport B (docs/tool-protocol.md §3): every tool
 * iframe's `hello` lands here, and this is the only place that answers
 * `ready`. Centralising the listener (rather than one per `ToolMount`) is
 * what makes the security property possible — there is exactly one place
 * that resolves a tool id from `event.source`, and exactly one map of
 * trusted sources to check it against.
 *
 * It is also where a frame's `request` messages are routed, and the two kinds
 * of surface part company at exactly that point. A first-party app's call goes
 * to `app_call`, which answers in the orchestrator's own process. A tool's
 * would have to reach its core over the broker, which is not built — so a tool
 * gets an error naming that, rather than the silence that used to be here.
 * Silence is the worse answer: the bridge times a pending call out after thirty
 * seconds, so a tool asking a question this build cannot answer would hang for
 * half a minute before finding out.
 *
 * The one other message the shell answers itself is `helve/painted`, which is a
 * frame reporting that it has drawn its first meaningful content. That is not
 * an app's question to answer — the frame is claiming something about itself,
 * and only the shell can say *which* frame is claiming it — and what waits on
 * the answer is the splash window, which stays up until every app has reported.
 *
 * Traffic runs the other way too, and there are now two kinds of it. A Tauri
 * event the backend broadcasts is forwarded into app frames as a transport-B
 * `event` message. And a **menu command** — the title bar's File/Edit/View
 * items — is posted to the *active* frame alone as a transport-B `command`
 * message, through the handle below. Those two are the only ways anything
 * reaches a frame unprompted; every other message here answers one the frame
 * sent first.
 *
 * A command never travels through Rust. Both ends are already in this browser,
 * and a round trip through the backend would buy nothing but a chance for the
 * two to disagree about which frame is active.
 *
 * The shell does not know what any command *means*, and must not: it holds a
 * set of strings per frame, sends one when a menu item is chosen, and greys out
 * everything the active frame has not declared. `helve/commands` is how a frame
 * declares — which is what keeps a list of one app's capabilities out of the
 * shell, so the next app to arrive does not break the menu.
 */
export interface ToolWindowHandle {
  /**
   * Post a menu command to the frame showing `instanceId`.
   *
   * An *instance* id, not an app id, and that is the whole point of this
   * refactor arriving here. The old version scanned for the first frame whose
   * id matched and posted to that — which was correct only for as long as one
   * app could have one frame. With two Files open it would deliver Save to
   * whichever happened to be earlier in a `Map`, silently and about half the
   * time.
   *
   * Silent when that frame is not mounted, has not said hello, or never
   * declared the command. The menu is what stops the last of those from
   * happening — an item the active app has not declared is disabled — so
   * reaching here with an undeclared command means the two disagreed, and
   * dropping it is better than a frame acting on something it said it could not
   * do.
   */
  send(instanceId: string, command: string): void;
}

const ToolWindow = forwardRef<
  ToolWindowHandle,
  {
    /** The active cluster's layout. Every surface's position comes from this. */
    tree: PaneNode;
    /** Every live instance in this cluster, resolvable by id. */
    instances: Map<string, SurfaceInstance>;
    /** How to present the app an instance is an instance of. */
    presentationOf: (appId: string) => ToolPresentation | undefined;
    /** The pane whose strip has focus, for the active-pane treatment. */
    focusedPaneId: string | null;
    onFocusPane: (paneId: string) => void;
    onSelectTab: (instanceId: string) => void;
    onCloseTab: (instanceId: string) => void;
    onResize: (splitId: string, sizes: number[]) => void;
    onOpenApp: (appId: string) => void;
    onRescan: () => void;
    dragHandleFor?: (instanceId: string) => DragHandleProps | undefined;
    dropTarget?: DropTarget | null;
    /**
     * A frame's declared command set changed — it said `helve/commands`, or it
     * went away and its declaration went with it. Keyed by *instance*, because
     * two instances of one app can have different things to offer: one Files
     * with a dirty editor can Save and one without cannot.
     */
    onCommandsChange?: (instanceId: string, commands: readonly string[]) => void;
  }
>(function ToolWindow(
  {
    tree,
    instances,
    presentationOf,
    focusedPaneId,
    onFocusPane,
    onSelectTab,
    onCloseTab,
    onResize,
    onOpenApp,
    onRescan,
    dragHandleFor,
    dropTarget,
    onCommandsChange,
  },
  ref,
) {
  // The only trusted map from a window to a mounted surface. Each `ToolMount`
  // registers its iframe's `contentWindow` here the moment it exists; the
  // listener below never trusts anything in a message's body for identity —
  // a tool cannot claim to be a different tool by lying in its payload.
  //
  // `isApp` is carried here rather than looked up in `tools` when a message
  // arrives, so routing is decided by the same registration that established
  // identity. A second lookup would be a second chance to disagree.
  //
  // `origin` is filled in when the frame says `hello`, and is `null` until it
  // does. A reply always has the message it is replying to on hand and can read
  // the origin off that; an event has no such message, so the one the frame
  // announced itself from is remembered instead. Nothing is posted to a frame
  // still holding `null` — a frame that has not said hello has no listener yet,
  // and there is no origin to aim at that wouldn't be a guess.
  //
  // `commands` is the set the frame last declared. Empty until it says
  // `helve/commands`, which is the honest starting point: a frame that has
  // never declared anything can do nothing the menu bar knows how to ask for.
  //
  // `id` is the *instance* id and `appId` the type. Both, because they answer
  // different questions and conflating them is exactly the bug this refactor
  // removes: a message is addressed by instance, but `callApp` and
  // `appPainted` name an app — `apps::REGISTRY` has one entry for Files however
  // many of them are open, and boot's roster waits on Files the app, not on
  // each Files there happens to be.
  const frames = useRef<
    Map<
      Window,
      { id: string; appId: string; isApp: boolean; origin: string | null; commands: Set<string> }
    >
  >(new Map());
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());

  // Where each pane's content sits, in this container's coordinates.
  //
  // Measured rather than used as a portal target, and that is a correctness
  // requirement rather than a style choice. `createPortal` remounts its
  // children when the container changes, so portalling a surface into whichever
  // pane currently owns it would reload the iframe on every split and every
  // drag — the Files app would lose its open file each time you rearranged
  // anything. So every surface stays a permanent sibling in one container that
  // never moves, and is *positioned* over its pane instead.
  //
  // This is `TerminalDeck`'s technique (see its doc comment on why a split must
  // not reparent a mounted `XTermView`), generalized from one row of equal
  // shares to arbitrary rectangles.
  const hosts = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<Map<string, PaneRect>>(() => new Map());

  // Re-measure every pane host against the container. Called on mount, on any
  // host arriving or leaving, and from a `ResizeObserver` — a divider drag and
  // an OS window resize both change these and neither goes through React.
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();

    // A container measuring zero means the window is hidden or occluded, and
    // every rect read in that state is stale. Keeping the last good geometry is
    // better than collapsing every surface to the top-left corner and then
    // having to put them back.
    if (base.width === 0 || base.height === 0) return;

    const next = new Map<string, PaneRect>();
    for (const [paneId, el] of hosts.current) {
      const r = el.getBoundingClientRect();
      next.set(paneId, {
        left: r.left - base.left,
        top: r.top - base.top,
        width: r.width,
        height: r.height,
      });
    }
    setRects((prev) => (sameRects(prev, next) ? prev : next));
  }, []);

  const onHostChange = useCallback(
    (paneId: string, el: HTMLDivElement | null) => {
      if (el) hosts.current.set(paneId, el);
      else hosts.current.delete(paneId);
      measure();
    },
    [measure],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const el of hosts.current.values()) observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [measure, tree]);

  // Held in a ref for the same reason `useKeyboard` holds its actions in one:
  // the message listener below is installed once, and a prop that changes
  // identity every render would otherwise tear it down and re-add it — with a
  // window in between where a frame's `hello` would land on nothing.
  const report = useRef(onCommandsChange);
  report.current = onCommandsChange;

  const registerFrame = useCallback(
    (instanceId: string, appId: string, isApp: boolean, win: Window) => {
      frames.current.set(win, {
        id: instanceId,
        appId,
        isApp,
        origin: null,
        commands: new Set(),
      });
    },
    [],
  );

  const unregisterFrame = useCallback((win: Window) => {
    const frame = frames.current.get(win);
    frames.current.delete(win);
    // A frame that has gone declares nothing. Said out loud rather than left
    // implicit, because the owner's copy of the set outlives this map — a menu
    // still offering Save for a surface that has unmounted would be offering to
    // post into a window that no longer exists.
    if (frame) report.current?.(frame.id, []);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      send(instanceId, command) {
        for (const [win, frame] of frames.current) {
          if (frame.id !== instanceId) continue;
          if (frame.origin === null || !frame.commands.has(command)) return;
          win.postMessage(
            { helve: 1, kind: "command", command } satisfies CommandMessage,
            frame.origin,
          );
          return;
        }
      },
    }),
    [],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Drop anything whose source isn't one of our mounted iframes — this
      // is also how the tool id is resolved, never from `event.data`.
      const source = event.source as Window | null;
      if (!source) return;
      const frame = frames.current.get(source);
      if (!frame) return;
      if (!isInboundMessage(event.data)) return;

      // `targetOrigin` is the incoming message's own origin, never "*" — for
      // every reply below, and for the same reason each time.
      const origin = event.origin;

      if (event.data.kind === "hello") {
        // The shell answers; it never announces first (docs/tool-protocol.md
        // §3 — a message posted before the frame's listener exists is simply
        // gone, with no replay).
        // The *app* id, deliberately, not the instance id — so the protocol is
        // unchanged and an app that reads this still learns what it needs to.
        // A frame needs to know what kind of thing it is; it does not need to
        // know which of several copies it is, because nothing it can send
        // requires saying so. Identity here is resolved from `event.source`
        // against the map above, which is the security property, and an
        // instance id in a payload would be one more claim to have to distrust.
        const reply: ReadyMessage = {
          helve: 1,
          kind: "ready",
          toolId: frame.appId,
          protocol: 1,
          session: { engineEndpoint: null, projectPath: null },
        };
        source.postMessage(reply, origin);
        frame.origin = origin;
        setReadyIds((prev) => (prev.has(frame.id) ? prev : new Set(prev).add(frame.id)));
        return;
      }

      const { id, method, params } = event.data;
      const respond = (body: Omit<ResponseMessage, "helve" | "kind">) =>
        source.postMessage({ helve: 1, kind: "response", ...body } satisfies ResponseMessage, origin);

      // `helve/*` belongs to the host, exactly as `hello` above does — this one
      // is a frame saying it has drawn its first meaningful content, and it is
      // answered here rather than forwarded on to an app's Rust half.
      //
      // What the report is *for* is the splash window: boot holds it open until
      // every first-party app has said this, so that the window it hands off to
      // is finished rather than still filling in (see `src-tauri/src/boot.rs`).
      // Only an app's report travels on. A tool is a different repository's code
      // that boot is not waiting for, and under `?fake=1` there is no backend to
      // tell and no splash that would care — both still get their answer, since
      // a frontend that asked and heard nothing back would sit through the
      // bridge's thirty-second timeout for it.
      // Reported by *app* id, not instance id, because boot's roster is one
      // entry per app — `apps::roster()` waits on Files, however many Files
      // there are. A second instance reporting is a duplicate that
      // `boot::await_apps` already ignores, which is the behaviour we want:
      // the splash lifts when each kind of app has drawn once.
      if (method === "helve/painted") {
        respond({ id, result: null });
        if (frame.isApp && !isFake()) {
          void appPainted(frame.appId).catch((err: unknown) =>
            console.error(`helve: could not report ${frame.appId} painted:`, err),
          );
        }
        return;
      }

      // A frame naming its own tab — "Files" becoming `client.ts`. Host
      // business, like the two above: which tab this is, is something only the
      // shell knows, and it knows it from `event.source` rather than from
      // anything the frame could assert about itself.
      if (method === "helve/title") {
        respond({ id, result: null });
        const title = declaredTitle(params);
        if (title) void setInstanceTitle(frame.id, title);
        return;
      }

      // The other `helve/*` the shell answers itself: a frame saying which menu
      // commands it can carry out right now. Host business, not an app's Rust
      // half's — the menu being greyed out is a fact about this window's title
      // bar, and the backend has no part in it.
      //
      // A tool may declare too. Its *requests* cannot be served (the broker is
      // not built), but a declaration asks nothing of a core: it is the frame
      // making a claim about itself, exactly as `helve/painted` is, so it is
      // answered above the `isApp` refusal rather than below it.
      if (method === "helve/commands") {
        frame.commands = new Set(declaredCommands(params));
        respond({ id, result: null });
        report.current?.(frame.id, [...frame.commands]);
        return;
      }

      if (!frame.isApp) {
        respond({
          id,
          error: {
            code: HelveErrorCode.InternalError,
            message: `${method}: this build cannot reach a tool's core — the broker is not implemented`,
          },
        });
        return;
      }

      // `callApp` names the app, not the instance: `apps::call` dispatches into
      // a registry keyed by app id, and `apps/files.rs` holds no per-instance
      // state at all — every method that names a file takes an absolute path.
      // That is why two Files needed no backend change; all the per-instance
      // state is the frontend's, and it stays there.
      void callApp(frame.appId, method, params)
        .then((result) => respond({ id, result }))
        // Both hosts of `callApp` reject with a `{code, message}` envelope, so
        // the common path is to pass it straight through. Anything else that
        // reaches here is a failure of the relay rather than of the app —
        // reported as an internal error with whatever it said for itself,
        // since a call that resolved to neither a result nor an error object
        // is exactly the case a caller cannot otherwise distinguish from a
        // hang.
        .catch((err: unknown) =>
          respond({
            id,
            error: isErrorPayload(err)
              ? err
              : { code: HelveErrorCode.InternalError, message: String(err) },
          }),
        );
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The third direction: Rust -> shell -> app frame. `project:changed` is the
  // first thing to travel it, and everything below is deliberately generic
  // about the payload — the shell relays, it does not interpret.
  //
  // Apps only. A tool frame is a separate repository's code whose core this
  // build cannot reach at all (see the `isApp` branch above, which answers its
  // requests with an error saying so). Telling it the project changed would be
  // handing it news it has no way to act on, on a channel whose whole value is
  // that everything arriving on it means something.
  useEffect(() => {
    // No Tauri event system in a plain browser: an unguarded `listen` rejects
    // on mount under `?fake=1` and takes the fake-backend run with it. Same
    // guard, same reason, as `state/terminals.ts`. Nothing emits `project:
    // changed` in fake mode, so there is nothing to stand in for here either.
    if (isFake()) return;

    // `listen` is async and an effect's cleanup must be returned synchronously,
    // so the subscription is set up in the background and `live` covers the gap
    // — an unmount before Tauri registers the listener must still end up with
    // nothing listening.
    let live = true;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const stop = await listen<unknown>("project:changed", (e) => {
        if (!live) return;
        for (const [win, frame] of frames.current) {
          if (!frame.isApp || frame.origin === null) continue;
          win.postMessage(
            {
              helve: 1,
              kind: "event",
              event: "project:changed",
              payload: e.payload,
            } satisfies EventMessage,
            frame.origin,
          );
        }
      });
      if (!live) return stop();
      unlisten = stop;
    })();

    return () => {
      live = false;
      unlisten?.();
    };
  }, []);

  // Which tab each pane is showing, so a surface can be hidden without being
  // unmounted. Derived from the tree every render rather than tracked, so there
  // is no second place it could disagree with what Rust says.
  const activeByPane = new Map(paneLeaves(tree).map((leaf) => [leaf.id, leaf.activeTab]));
  const tabs = paneTabs(tree);
  const empty = tabs.length === 0;

  return (
    <div className="toolwindow" ref={containerRef}>
      {/* The layout. Draws the panes, the dividers and the tab strips, and
          reports where each pane's content area ended up — but holds no
          surfaces itself. See the `rects` comment above for why the two are
          deliberately separate trees. */}
      <PaneTree
        tree={tree}
        instances={instances}
        focusedPaneId={focusedPaneId}
        onFocusPane={onFocusPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onResize={onResize}
        onHostChange={onHostChange}
        dragHandleFor={dragHandleFor}
        dropTarget={dropTarget}
      />

      {/* Every surface in the cluster, always mounted, positioned over the pane
          that owns it. Flat siblings of a container that never moves: this list
          is keyed by instance id and its order never changes with the layout,
          so no amount of splitting, resizing or dragging can make React think
          one of these unmounted. An iframe that remounts reloads the app inside
          it, and the whole point of a layout you can rearrange is that
          rearranging it costs you nothing. */}
      {tabs.map((instanceId) => {
        const instance = instances.get(instanceId);
        if (!instance) return null;

        // A terminal has no iframe and no frontend URL — it is an emulator bound
        // to a pty by id. It still belongs in this list rather than in the
        // panel's deck: once dragged into the layout it is a pane's content like
        // anything else, and mounting it here means it survives a split or a
        // move for exactly the same reason an app surface does.
        const isTerminal = instance.kind === "terminal";
        const presentation = isTerminal ? undefined : presentationOf(instance.appId);
        if (!isTerminal && !presentation) return null;

        const paneId = paneOfTab(tree, instanceId);
        const rect = paneId ? rects.get(paneId) : undefined;

        return (
          <div
            key={instanceId}
            className="toolwindow__surface"
            // Hidden rather than unmounted or `display: none`. `visibility`
            // keeps the element laid out, which matters for anything inside
            // measuring itself — the same reason `ToolMount` has always used
            // it. A pane with no rect yet is hidden too: it has nowhere to be
            // until the first measure lands, and drawing it at 0,0 first would
            // be a visible jump.
            style={
              rect
                ? {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    visibility:
                      activeByPane.get(paneId ?? "") === instanceId ? "visible" : "hidden",
                  }
                : { visibility: "hidden" }
            }
          >
            {isTerminal ? (
              <div className="toolwindow__slot">
                <XTermView
                  id={instanceId}
                  transport={terminalTransport}
                  onTitle={(title) => terminalControl.setTitle(instanceId, title)}
                />
              </div>
            ) : (
              presentation && (
                <ToolMount
                  instanceId={instanceId}
                  tool={presentation}
                  title={instance.title}
                  ready={readyIds.has(instanceId)}
                  registerFrame={registerFrame}
                  unregisterFrame={unregisterFrame}
                />
              )
            )}
          </div>
        );
      })}

      {empty && <EmptyState onOpenApp={onOpenApp} onRescan={onRescan} />}
    </div>
  );
});

/** A pane's content area, in the tool window's own coordinates. */
interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Whether two measurements are the same, so an unchanged one does not re-render
 * every surface in the window.
 *
 * A `ResizeObserver` fires for reasons that change nothing here — a scrollbar
 * appearing inside a pane, a font loading — and every one of those would
 * otherwise produce a new `Map`, a new state value, and a full re-render of the
 * whole cluster.
 */
function sameRects(a: Map<string, PaneRect>, b: Map<string, PaneRect>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, rect] of a) {
    const other = b.get(id);
    if (!other) return false;
    if (
      rect.left !== other.left ||
      rect.top !== other.top ||
      rect.width !== other.width ||
      rect.height !== other.height
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The `title` off a `helve/title` request, or `null` for anything that is not a
 * non-empty string.
 *
 * Validated for the same reason `declaredCommands` below is: this decides what
 * a tab says, and a frame that sent a number or an object should narrow to "no
 * title reported" rather than put a non-string where one is expected.
 */
function declaredTitle(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;
  const { title } = params as { title?: unknown };
  return typeof title === "string" && title.trim() !== "" ? title : null;
}

export default ToolWindow;

/**
 * The `commands` array off a `helve/commands` request, with anything that is
 * not a string dropped.
 *
 * Validated rather than trusted even though every app in this build is
 * first-party: a declaration decides which menu items become clickable, and a
 * malformed one must narrow the menu rather than put a non-string into a `Set`
 * that is later compared against command ids. Absent or wrong-shaped params
 * declare nothing, which disables everything — the safe direction.
 */
function declaredCommands(params: unknown): string[] {
  if (typeof params !== "object" || params === null) return [];
  const list = (params as { commands?: unknown }).commands;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === "string");
}

/**
 * `isHelveMessage` in the bridge package is typed for the frontend's inbound
 * direction (`ReadyMessage | ResponseMessage | EventMessage`) — we are the
 * shell, receiving the other direction, so reusing it would narrow to the
 * wrong union. The runtime check is the same two fields either way; this just
 * types it correctly for what we actually receive, and rejects any third
 * `kind` a frame might invent.
 */
function isInboundMessage(data: unknown): data is HelloMessage | RequestMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { helve?: unknown; kind?: unknown; id?: unknown; method?: unknown };
  if (message.helve !== 1) return false;
  if (message.kind === "hello") return true;
  // A request without a numeric id could never be answered — there would be
  // nothing to echo back — and one without a method names nothing to call.
  return (
    message.kind === "request" &&
    typeof message.id === "number" &&
    typeof message.method === "string"
  );
}

/** A rejection that already carries a JSON-RPC error object. */
function isErrorPayload(err: unknown): err is NonNullable<ResponseMessage["error"]> {
  if (typeof err !== "object" || err === null) return false;
  const payload = err as { code?: unknown; message?: unknown };
  return typeof payload.code === "number" && typeof payload.message === "string";
}
