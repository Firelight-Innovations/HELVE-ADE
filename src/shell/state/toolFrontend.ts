/**
 * Where a tool's iframe points.
 *
 * Mirrors `src-tauri/src/tool_frontend.rs`. In development this resolves to the
 * tool's own Vite server, so its hot reload works inside the real shell; in a
 * release build it resolves to the tool's built bundle on the `helve-tool://`
 * scheme. The frontend never constructs either URL — it asks and mounts what it
 * is given.
 *
 * Resolution is per-tool and on demand rather than part of the stack snapshot,
 * because both answers can change while the shell is running: a dev server can
 * be started or stopped, and a checkout can be built.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isFake, fakeApps, fakeToolPage } from "./fakeBackend";

/** Mirrors `tool_frontend::ToolFrontend`. */
export type ToolFrontend =
  { state: "mountable"; url: string } | { state: "unavailable"; reason: string };

/**
 * Resolve one tool's frontend.
 *
 * `null` while the answer is in flight — the tool window shows its boot state
 * for that, not an error.
 */
export function useToolFrontend(toolId: string | null): ToolFrontend | null {
  const [frontend, setFrontend] = useState<ToolFrontend | null>(null);

  useEffect(() => {
    setFrontend(null);
    if (!toolId) return;

    if (isFake()) {
      setFrontend(fakeFrontend(toolId));
      return;
    }

    let live = true;
    void invoke<ToolFrontend>("tool_frontend", { id: toolId })
      .then((f) => live && setFrontend(f))
      .catch((err) => live && setFrontend({ state: "unavailable", reason: String(err) }));

    return () => {
      live = false;
    };
  }, [toolId]);

  return frontend;
}

/**
 * What `?fake=1` answers with.
 *
 * Two tools resolve to a real, mountable page and the rest report themselves
 * unavailable, because both are states the shell has to render and a fixture
 * that only produced one of them would leave the other unmeasured. The
 * unavailable branch is the more common one in life — it is what every user
 * sees before they have cloned a tool.
 *
 * The mountable branch exists so two things can be verified in a plain
 * browser: that the `hello`/`ready` handshake completes and clears the boot
 * overlay, and that switching tabs does not re-create an iframe. Neither can
 * be measured against a window that never mounts one.
 */
function fakeFrontend(toolId: string): ToolFrontend {
  // An app resolves to its real entry point here, not to a fixture. Vite serves
  // those files in a plain browser, so this is the same URL and the same page
  // the packaged app mounts — the only thing missing is the Rust half behind
  // its `invoke` calls. Checked before the tool branches for the same reason
  // `tool_frontend::resolve` checks apps first: an app cannot be missing.
  const app = fakeApps().find((a) => a.id === toolId);
  if (app) return { state: "mountable", url: app.url };

  if (toolId === "forger" || toolId === "journeyman") {
    return { state: "mountable", url: fakeToolPage(toolId) };
  }
  return { state: "unavailable", reason: "no backend (browser mode)" };
}
