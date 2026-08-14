/**
 * One PDF page at a time, rendered to a canvas at the pane's width.
 *
 * What it deliberately does not do: a text layer, selection, search, links,
 * annotations, forms, or continuous scroll. This is the file explorer's preview,
 * not a PDF reader — "is this the right document" is the question, and the
 * answer is a picture of a page. `UnsupportedViewer`'s "Open with the default
 * app" is one click away for everything else, and the OS reader will always be
 * better at it than a pane in a side panel.
 *
 * Two things about pdf.js that are not obvious and cost an afternoon each:
 *
 * 1. **`getDocument` takes ownership of the buffer you give it.** The
 *    `ArrayBuffer` goes into the `postMessage` transfer list to the worker, so
 *    the `Uint8Array` handed over is detached — zero-length — the moment the
 *    document starts loading. That is why the bytes are decoded inside the load
 *    effect and used exactly once. Anything that wants to keep the bytes (a
 *    retry, a cache, a second document over the same file) must pass
 *    `new Uint8Array(bytes)` and keep the original for itself; reusing the array
 *    that went in produces an "empty file" error that names nothing useful.
 *
 * 2. **The worker is wired with `?url`, not `?worker`.** `vite.config.ts` has no
 *    `worker` block, so `worker.format` is Vite's `iife` default, which is what
 *    Monaco's workers need — and a `?worker` import here would route pdf.js
 *    through that same pipeline and produce a classic script that pdf.js then
 *    loads with `{ type: "module" }`. `?url` sidesteps the pipeline entirely:
 *    the file is copied to the output as an asset, we hand pdf.js the URL, and
 *    pdf.js constructs the `Worker` itself. `new URL("pdfjs-dist/...",
 *    import.meta.url)` is the other thing that looks right and is not — a bare
 *    specifier in `new URL` is not resolved by Vite, and it ships a relative
 *    path that 404s.
 */
import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, RenderingCancelledException, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { describe, readBytes, toBytes } from "../rpc";
import type { ViewerProps } from "./registry";
import "./media.css";

GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * A known gap, stated precisely so the next person does not rediscover it.
 *
 * pdfjs-dist v6 ships `cmaps/`, `standard_fonts/`, `wasm/` and `iccs/`, and the
 * matching `getDocument` options — `cMapUrl`, `standardFontDataUrl`, `wasmUrl`,
 * `iccUrl` — all default to `null`. Without them: a CJK document renders its
 * glyphs blank, a document relying on the base-14 fonts substitutes, and JBIG2
 * or JPX images fail to decode. Every Latin PDF with embedded fonts, which is
 * almost all of them, is unaffected.
 *
 * Closing it means copying four directories out of `node_modules` into
 * `public/` as a build step — they are ~4 MB of generated data and must not be
 * committed — and that is a `package.json` change, which this file's author does
 * not own. Left as a follow-up rather than half-done: pointing these at a
 * `node_modules` path would work in `vite dev` and 404 in a packaged build,
 * which is the worst of the three options.
 */

/** Never render more than this many device pixels per CSS pixel. A 4x display
 *  times a poster-sized page exceeds the browser's canvas limit and the whole
 *  page silently comes back blank. Two is past the point of visible gain. */
const MAX_PIXEL_RATIO = 2;

export default function PdfViewer({ file }: ViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** Content-box width of the scroll area, in CSS pixels. 0 until measured. */
  const [width, setWidth] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * The last render's promise, settled or not.
   *
   * pdf.js refuses two concurrent `render()` calls into one canvas, and
   * `cancel()` is not synchronous — it rejects the promise on a later turn. So
   * the next render waits on this before touching the canvas. Without it, a
   * fast page-flick throws "Cannot use the same canvas during multiple render()
   * operations" and leaves the pane on the old page.
   */
  const pending = useRef<Promise<void> | null>(null);

  // --- measure the pane -------------------------------------------------------

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      // `contentRect` excludes the padding, which is exactly the width a page
      // may occupy — no constant here has to agree with one in media.css.
      const next = Math.floor(entries[0].contentRect.width);
      // A one-pixel wobble is a scrollbar arriving and leaving. Acting on it
      // re-renders the page, which changes the height, which moves the
      // scrollbar: the loop is real and it pegs a core.
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // --- load the document ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;

    setDoc(null);
    setError(null);
    setPage(1);

    void (async () => {
      let base64: string;
      try {
        base64 = (await readBytes(file.path)).base64;
      } catch (err) {
        if (!cancelled) setError(describe("files/read-bytes", err));
        return;
      }
      if (cancelled) return;

      try {
        // Decoded here, one document, one buffer — see (1) in the header. The
        // worker detaches this array; nothing else may hold a reference to it.
        opened = await getDocument({ data: toBytes(base64) }).promise;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        return;
      }

      if (cancelled) {
        // Unmounted while the worker was parsing. Destroying is not optional:
        // pdf.js holds a worker per document, and an abandoned one stays.
        void opened.loadingTask.destroy();
        opened = null;
        return;
      }
      setDoc(opened);
    })();

    return () => {
      cancelled = true;
      // `PDFDocumentProxy.destroy()` is gone in v6; teardown moved to the
      // loading task, which the proxy still points at. Every guide written
      // against v3 or v4 says `doc.destroy()`, and in plain JS that reads as a
      // call on `undefined` only if you get that far — the worker leaks either
      // way, one per document opened, and nothing says so.
      void opened?.loadingTask.destroy();
    };
  }, [file.path]);

  // --- draw the current page --------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (doc === null || canvas === null || width === 0) return;

    let cancelled = false;
    let task: RenderTask | null = null;

    void (async () => {
      await pending.current?.catch(() => undefined);
      if (cancelled) return;

      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;

        const unscaled = pdfPage.getViewport({ scale: 1 });
        const fitWidth = width / unscaled.width;
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const viewport = pdfPage.getViewport({ scale: fitWidth * ratio });

        // The backing store is in device pixels; the CSS box is in CSS pixels.
        // Setting only the former would draw the page at `ratio` times the
        // intended size.
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(unscaled.width * fitWidth)}px`;
        canvas.style.height = `${Math.floor(unscaled.height * fitWidth)}px`;

        task = pdfPage.render({ canvas, viewport });
        pending.current = task.promise;
        await task.promise;
        // Frees the page's operator list. Skipped when cancelled — pdf.js is
        // still unwinding the render and cleaning up under it throws.
        if (!cancelled) pdfPage.cleanup();
      } catch (err) {
        // The expected failure, once per page change and once per resize.
        if (err instanceof RenderingCancelledException) return;
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width]);

  const count = doc?.numPages ?? 0;

  return (
    <div className="pdf">
      <div className="pdf__bar">
        <button
          type="button"
          className="pdf__step"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Previous
        </button>
        <span className="pdf__count app__meta">
          {count === 0 ? "—" : `Page ${page} of ${count}`}
        </span>
        <button
          type="button"
          className="pdf__step"
          disabled={count === 0 || page >= count}
          onClick={() => setPage((current) => Math.min(count, current + 1))}
        >
          Next
        </button>
      </div>

      <div className="pdf__scroll" ref={scrollRef}>
        {error !== null && <p className="app__error media__note">{error}</p>}
        {error === null && doc === null && (
          <p className="app__note media__note">Reading {file.name}…</p>
        )}
        {/* Always mounted, so the ref exists by the time the document lands. */}
        <canvas className="pdf__canvas" ref={canvasRef} hidden={doc === null} />
      </div>
    </div>
  );
}
