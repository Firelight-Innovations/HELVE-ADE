import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { TerminalTransport } from "../contract";
// Imported here, not from a global entry, so nothing pays for xterm's CSS
// until a terminal actually mounts — the tool window and every other region
// stay ignorant of this parcel's existence.
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

/**
 * One session, one emulator.
 *
 * The `Terminal` instance is created exactly once per mounted instance and
 * disposed on unmount — never recreated on a prop change. `TerminalDeck`
 * guarantees that by keying each instance on the session id, so `id` and
 * `transport` are effectively constant for this component's lifetime; they
 * are still listed as effect deps (rather than read from a ref) because the
 * correct behaviour if either ever did change is to re-wire the transport,
 * not to silently keep talking to the old one.
 */
export default function XTermView({ id, transport }: { id: string; transport: TerminalTransport }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      // A coding harness's own scrollback is not this: this is the emulator's
      // buffer of everything that has scrolled off, for the user's own
      // scrollback (mouse wheel / search-to-come). Sized generously since a
      // long-running agent can produce a lot of output between glances.
      scrollback: 10000,
      fontFamily: readToken("--mono"),
      // The panel's terminal output has always rendered at 11.5px
      // (src/shell/panel/panel.css `.panel__terminal`) — matched here so a
      // real PTY's output sits at the same size the fake transcript did.
      fontSize: 11.5,
      theme: buildTheme(),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // A webview without a GPU context must degrade, not crash: `WebglAddon`
    // throws synchronously out of `activate()` (called by `loadAddon`) when
    // it can't get a WebGL2 context, so the fallback is a plain try/catch
    // rather than a feature check — xterm's canvas renderer is already
    // loaded and keeps working untouched.
    try {
      const webgl = new WebglAddon();
      // The context can also be lost after the fact (GPU reset, driver
      // update); disposing on loss drops back to the canvas renderer instead
      // of leaving the terminal blank.
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL2 context available in this webview — the canvas renderer
      // xterm already loaded stays in place.
    }

    term.open(container);

    const detach = transport.attach(id, (chunk) => term.write(chunk));
    const onData = term.onData((data) => transport.write(id, data));

    // Fits are driven by a `ResizeObserver` on the container, not `window`'s
    // resize event — the panel is resized by a drag handle and by collapse,
    // neither of which touches the window. Coalesced to one fit per repaint
    // so a drag doesn't emit hundreds of pty resizes a second.
    let rafHandle: number | null = null;
    const runFit = () => {
      rafHandle = null;
      // A hidden terminal (the deck sets `display: none` on the inactive
      // ones) or one that hasn't been laid out yet measures 0×0 — checked
      // against this element's own rect, not `FitAddon.proposeDimensions()`.
      // `proposeDimensions` reads its *parent's* `getComputedStyle(...).width`
      // and runs it through `parseInt`; with a `display: none` ancestor that
      // percentage can't resolve to a pixel value, so the browser hands back
      // the literal string `"100%"` and `parseInt` truncates that to `100` —
      // a small but finite, non-zero number that sails straight past a
      // `cols <= 0` guard. Measured this way instead, a hidden container
      // reliably reports zero. Fitting to a degenerate size would hand the
      // pty a corrupt viewport, and a pty that disagrees with the emulator
      // about its size renders a corrupt frame — so skip and wait for the
      // next real measurement. The observer fires again on the 0→real
      // transition when the deck makes this one visible, which is what
      // re-establishes the correct size without any extra wiring here.
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dims = fitAddon.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols <= 0 || dims.rows <= 0) {
        return;
      }
      fitAddon.fit();
      transport.resize(id, dims.cols, dims.rows);
    };
    const scheduleFit = () => {
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(runFit);
    };

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    scheduleFit(); // the container already has its first-paint size by now.

    return () => {
      observer.disconnect();
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      onData.dispose();
      detach();
      term.dispose();
    };
  }, [id, transport]);

  return <div ref={containerRef} className="terminal__view" />;
}

/** Reads a design token's literal value. Canvas-backed renderers (xterm's
 *  default, and WebGL's) need a real colour or font string — `var(--x)`
 *  isn't something either can consume — so every token this component needs
 *  is resolved once, here, rather than passed through as CSS. */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * xterm theme, built entirely from `src/tokens.css` — no hex value here that
 * isn't already named there.
 *
 * The token table has no discrete blue, magenta, or cyan (the handoff never
 * draws them), so those three ANSI slots and their bright variants are left
 * unset rather than invented: xterm's own built-in defaults fill them. Red,
 * green, and yellow have no separate "bright" shade in the token set either,
 * so the bright variant reuses the base token — a narrower palette than a
 * full 16-colour scheme, but not a fabricated one.
 */
function buildTheme(): ITheme {
  const bg = readToken("--surface"); // the panel's own background — the deck
  // renders inside the panel body, which sets no background of its own.
  const text = readToken("--text");
  const textDim = readToken("--text-dim");
  const ok = readToken("--ok");
  const warn = readToken("--warn");
  const err = readToken("--err");

  return {
    background: bg,
    foreground: text,
    cursor: textDim,
    cursorAccent: bg,
    selectionBackground: readToken("--accent-wash"),

    black: readToken("--line-2"),
    red: err,
    green: ok,
    yellow: warn,
    white: textDim,

    brightBlack: readToken("--text-dim-3"),
    brightRed: err,
    brightGreen: ok,
    brightYellow: warn,
    brightWhite: text,
  };
}
