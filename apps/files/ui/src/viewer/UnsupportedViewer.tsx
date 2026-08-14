/**
 * The end of the line: a file this app has nothing useful to draw.
 *
 * Reached two ways — `reopenWith("unsupported")` from the text viewer when the
 * backend reports the bytes are not UTF-8, and, in future, any viewer that gives
 * up. `pick` never selects it; the text viewer matches everything above it in
 * the registry.
 *
 * **This is not an error page.** Nothing went wrong and the user did nothing
 * wrong: they opened a `.zip`, and a file explorer that cannot preview a `.zip`
 * is a file explorer, not a broken one. So it states the fact in one line and
 * then spends its space on the two things that actually help — showing the file
 * in the OS file manager, and handing it to whatever the OS opens it with. No
 * red, no icon of a sad document, no "unsupported format" in a box with a
 * border.
 *
 * What it deliberately does not do: offer a hex dump, or a "force open as text"
 * button. The first is a different app. The second is `reopenWith("text")` and
 * would loop straight back here, because getting here means the read already
 * failed.
 */
import { useState } from "react";
import { describe, formatSize, openExternal, reveal } from "../rpc";
import type { ViewerProps } from "./registry";
import "./media.css";

export default function UnsupportedViewer({ file }: ViewerProps) {
  const [error, setError] = useState<string | null>(null);

  const handoff = (method: string, call: (path: string) => Promise<null>) => () => {
    setError(null);
    // Fire and forget: both calls are "the OS now owns this", and neither has a
    // result worth waiting on. Only the failure is worth saying out loud.
    call(file.path).catch((err: unknown) => setError(describe(method, err)));
  };

  return (
    <div className="unsupported">
      <div className="unsupported__body">
        <p className="unsupported__lead">There is no preview for this kind of file.</p>

        <p className="app__note unsupported__what">
          {file.name}
          {" · "}
          {file.ext === "" ? "no extension" : `.${file.ext}`}
          {file.size !== null && ` · ${formatSize(file.size)}`}
        </p>

        <div className="unsupported__actions">
          <button
            type="button"
            className="unsupported__action"
            onClick={handoff("files/reveal", reveal)}
          >
            Reveal in File Explorer
          </button>
          <button
            type="button"
            className="unsupported__action"
            onClick={handoff("files/open-external", openExternal)}
          >
            Open with the default app
          </button>
        </div>

        {error !== null && <p className="app__error">{error}</p>}
      </div>
    </div>
  );
}
