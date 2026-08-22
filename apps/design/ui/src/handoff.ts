/**
 * Getting a capture out of this app and into an agent.
 *
 * **The clipboard, deliberately, and for now.** What this feature wants is to
 * put the text straight into whichever terminal an agent is running in, and the
 * shell has no verb for that yet. A clipboard write needs no Tauri capability,
 * no new command and no protocol change; `docs/design-notes/design-mode.md`
 * records what would replace it and why the plugin was not used.
 */
import type { PickedElement } from "./probe";
import { toPrompt } from "./prompt";
import type { Screenshot } from "./rpc";

/** What actually reached the clipboard. The caller says so, because "copied"
 *  when only half of it went is the kind of small lie that costs someone ten
 *  minutes wondering where their screenshot went. */
export type Handoff = "text" | "text-and-image" | "failed";

/** Decode a `data:` URL's payload into bytes. `atob` gives a binary string —
 *  one character per byte — the only decoder available without a dependency and
 *  fast enough for a cropped element. Mirrors `toBytes` in the Files app's
 *  `rpc.ts`, and is not shared with it because an app may not import another
 *  app's source. */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !dataUrl.slice(0, comma).includes(";base64")) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    // A payload that is not valid base64. Nothing here can repair it, and the
    // text half of the handoff is still worth completing.
    return null;
  }
}

/**
 * Put a capture on the clipboard: the prompt as text, and the screenshot beside
 * it as an image when there is one.
 *
 * One `ClipboardItem` holding both flavours rather than two writes, because a
 * clipboard holds one thing at a time and the second write would erase the
 * first. The image half is best-effort: writing one needs a secure context and
 * permission that a text write does not, so a refusal falls back to text and
 * the return value says which happened.
 */
export async function copyForAgent(
  element: PickedElement,
  shot: Screenshot | null,
): Promise<Handoff> {
  const text = toPrompt(element, { withScreenshot: shot !== null });
  const bytes = shot ? dataUrlToBytes(shot.dataUrl) : null;

  if (bytes && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "image/png": new Blob([bytes], { type: "image/png" }),
        }),
      ]);
      return "text-and-image";
    } catch {
      // Fall through to the text-only path below rather than reporting a
      // failure: the markup and the styles are the half an agent can act on.
    }
  }

  try {
    await navigator.clipboard.writeText(toPrompt(element, { withScreenshot: false }));
    return "text";
  } catch {
    return "failed";
  }
}
