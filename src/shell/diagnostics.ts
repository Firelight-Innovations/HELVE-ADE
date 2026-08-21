/**
 * Send what the webview catches to the backend, where it can be read later.
 *
 * Console errors, uncaught exceptions and unhandled rejections all land in a
 * devtools console that is only open if somebody opened it. This forwards all
 * three into `diagnostics`'s ring buffer in Rust, which outlives the console.
 *
 * **Apps mount as iframes and none of their errors reach these handlers** — an
 * exception inside Files is invisible here. Every `recent_errors` answer repeats
 * that caveat, because that is where it matters.
 *
 * Rationale, and what closing the iframe gap would take:
 * `docs/design-notes/agent-debugging.md`.
 */
import { reportFrontendError } from "../bindings";
import { isTauri } from "./hostWindow";

/**
 * Stops a report that fails from reporting its own failure. The rejection path
 * is already closed inside the binding; this covers the synchronous half, where
 * a throw or a log during a send would otherwise re-enter and spiral.
 */
let sending = false;

/**
 * Installed once. A second call would double every message, and `main.tsx`
 * running twice under StrictMode is a real way that happens.
 */
let installed = false;

/** Failure here is unreportable: the only channel to report it on just failed. */
function report(message: string): void {
  if (sending || !isTauri()) return;

  sending = true;
  try {
    void reportFrontendError(message);
  } catch {
    // A synchronous throw means the IPC bridge is not there at all. The
    // asynchronous half is already swallowed inside the binding.
  } finally {
    sending = false;
  }
}

/** An `Error` keeps its stack; anything else is described as best it can be. */
function describe(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A circular object, or one whose `toJSON` throws.
    return String(value);
  }
}

/** Join a `console.error` call's arguments the way the console displays them. */
function joinArguments(args: unknown[]): string {
  return args.map(describe).join(" ");
}

/**
 * Start forwarding. Called before anything renders, so that an error thrown
 * while React is mounting is caught rather than missed.
 */
export function installDiagnostics(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // `event.error` is absent for cross-origin script errors, where the browser
    // withholds everything but the fact that something failed. The message is
    // then "Script error." and is still worth recording — it is evidence, even
    // though it names nothing.
    const detail = event.error ? describe(event.error) : event.message;
    report(`uncaught: ${detail}`);
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    report(`unhandled rejection: ${describe(event.reason)}`);
  });

  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    report(joinArguments(args));
  };
}
