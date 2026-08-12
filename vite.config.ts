import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      // Vite defaults to a single entry at index.html. Declaring both entries
      // here is what makes `splash.html` its own separate bundle rather than
      // being folded into (or simply ignored by) the main build — each entry
      // gets its own JS chunk, pulling in only what it imports. That's the
      // whole point of a splash screen: `splash.html` imports `Splash.tsx`,
      // not `App.tsx`, so it never has to download or parse the rest of the
      // app's UI before it can show something on screen.
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
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
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
