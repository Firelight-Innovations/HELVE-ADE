import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Two dev servers, deliberately.
 *
 * Port 1420 belongs to `pnpm app` — `tauri dev` starts Vite itself and then
 * points the webview at a *fixed* URL, so that port cannot move and cannot be
 * shared. Anything else holding it doesn't degrade, it fails the whole run.
 *
 * Agents verifying work in a plain browser therefore get their own range via
 * `pnpm dev:agent`, and `strictPort` is off for them so a second and third
 * agent step up to 1431, 1432 rather than colliding. `--mode agent` is what
 * selects it: a CLI flag Vite already understands, so this needs no env var
 * and no `cross-env` shim to work the same in PowerShell and bash.
 *
 * 1430 rather than 1421 because 1421 is taken below by HMR when
 * `TAURI_DEV_HOST` is set for mobile.
 */
const AGENT_PORT = 1430;
const TAURI_PORT = 1420;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      // Vite defaults to a single entry at index.html, so `splash.html` is
      // declared here too — otherwise it is simply ignored by the build and
      // never reaches `dist/`, and the splash window would open on a 404.
      //
      // It produces no chunks of its own. `splash.html` imports nothing: its
      // styles, SVGs, wordmark font and boot logic are all inlined into the
      // file itself, so Vite finds no module graph to bundle and copies it
      // through verbatim. That is deliberate — see the comment at the top of
      // `splash.html` for why the splash window is kept free of any
      // dependency on this application's code.
      input: {
        main: resolve(__dirname, "index.html"),
        splash: resolve(__dirname, "splash.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available — but
  //    only Tauri does. An agent's server is free to move, and must be, since
  //    several can be up at once. See the note above.
  server: {
    port: mode === "agent" ? AGENT_PORT : TAURI_PORT,
    strictPort: mode !== "agent",
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore the Rust side
      //
      // `target/**` is not optional on Windows. Cargo holds an exclusive lock
      // on the DLL it is linking, and a watch against a locked file fails
      // outright with EBUSY rather than degrading — which kills the whole dev
      // server mid-compile. This used to be covered by the `src-tauri` entry
      // alone, because build output lived at `src-tauri/target/`; it moved to
      // the workspace root when this repo became a Cargo workspace, and the
      // ignore rule has to follow it.
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
}));
