/**
 * An SVG drawn as a picture, with a way out to its source.
 *
 * An SVG is genuinely two things — a rendered image and a text document — and
 * this viewer only owns the first. "View source" calls `reopenWith("text")` and
 * the registry hands the same file to Monaco; see the note on `reopenWith` in
 * `registry.ts`, which names this as one of its two reasons for existing.
 *
 * **The markup is never injected into this document.** The file is rendered
 * through a `Blob` object URL in an `<img>`, exactly as `ImageViewer` does it,
 * and that is a security boundary rather than a convenience. An `<img>` renders
 * SVG in a restricted mode: scripts do not run, external references are not
 * fetched, and nothing inside the file can see this frame. Inlining the same
 * bytes — `dangerouslySetInnerHTML`, or a `<use>` of the file — would hand an
 * arbitrary file on disk script access to a pane sitting inside the shell, and
 * "the user opened it in a file explorer" is not consent to execute it. The
 * cost of the safe version is that animations driven by script do not play. That
 * is the right trade for a viewer.
 *
 * What it deliberately does not do: a 1:1 toggle. An SVG has no pixels to be
 * honest about, so "actual size" would be reporting a number the format does not
 * really have. It scales to the pane and keeps its aspect ratio, which is the
 * whole of what resolution independence buys.
 */
import { formatSize } from "../rpc";
import { mimeFor, useBlobUrl } from "./blobUrl";
import type { ViewerProps } from "./registry";
import "./media.css";

export default function SvgViewer({ file, reopenWith }: ViewerProps) {
  const state = useBlobUrl(file.path, mimeFor(file.ext));

  if (state.status === "loading") {
    return <p className="app__note media__note">Reading {file.name}…</p>;
  }
  if (state.status === "failed") {
    return <p className="app__error media__note">{state.message}</p>;
  }

  return (
    <div className="svg">
      <div className="svg__bar">
        <span className="svg__mode app__meta">Preview</span>
        {/*
          One-way from here. Getting back to the picture is the text viewer
          calling `reopenWith("svg")` — the override lives in `Viewer.tsx`, so
          either side can set it, and neither can read the other's button.
        */}
        <button type="button" className="svg__toggle" onClick={() => reopenWith("text")}>
          View source
        </button>
      </div>

      <div className="svg__scroll">
        <img className="svg__img" src={state.url} alt={file.name} draggable={false} />
      </div>

      <p className="svg__meta app__meta">
        <span>Vector</span>
        <span>{formatSize(state.size)}</span>
        <span className="svg__hint">Scripts and external references are not run</span>
      </p>
    </div>
  );
}
