/**
 * Mounts whichever viewer claims the open file.
 *
 * The whole of the format dispatch is `pick(file)` on the next line but one.
 * Everything else here is the machinery around a dynamic import: caching the
 * `lazy()` wrapper so switching tabs back and forth doesn't rebuild it, a
 * fallback while the chunk is in flight, and an error boundary so a viewer that
 * throws takes out the pane rather than the app.
 *
 * The error boundary is a class because React has no hook equivalent —
 * `componentDidCatch` is the only way to catch a render-phase throw, and a
 * viewer built on Monaco, pdf.js or mermaid has three separate third-party
 * render paths that can throw for reasons this app will never enumerate.
 */
import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { byId, pick, type OpenFile, type ViewerDescriptor, type ViewerProps } from "./registry";

/**
 * One `lazy()` per descriptor, for the lifetime of the frame.
 *
 * `lazy()` must not be called during render with a fresh thunk each time — a
 * new component identity every render remounts the subtree on every keystroke.
 * Keyed by descriptor id rather than by file, because the chunk is per format,
 * not per document: the second `.png` opened costs nothing.
 */
const loaded = new Map<string, ComponentType<ViewerProps>>();

function componentFor(descriptor: ViewerDescriptor): ComponentType<ViewerProps> {
  const cached = loaded.get(descriptor.id);
  if (cached) return cached;
  const component = lazy(descriptor.load);
  loaded.set(descriptor.id, component);
  return component;
}

export interface ViewerHostProps {
  file: OpenFile;
  onDirty(dirty: boolean): void;
  registerSave(save: (() => Promise<void>) | null): void;
}

export default function Viewer({ file, onDirty, registerSave }: ViewerHostProps) {
  /**
   * A viewer id chosen at runtime, overriding what the extension implies.
   *
   * Set by `reopenWith`: the text viewer uses it to hand off to `unsupported`
   * when the backend says the file is not UTF-8, and the SVG viewer uses it to
   * toggle between the picture and its source. It is state here rather than in
   * `App.tsx` because it is a fact about *this pane right now*, not about the
   * tab — reopening the file should start from the extension's answer again.
   *
   * `App.tsx` keys this component on the path, so a tab switch discards it
   * without any reset logic here.
   */
  const [override, setOverride] = useState<string | null>(null);

  const descriptor = useMemo(() => {
    const forced = override ? byId(override) : undefined;
    return forced ?? pick(file);
  }, [file, override]);

  const Mounted = componentFor(descriptor);

  return (
    <div className="viewer">
      <ViewerBoundary
        // Remount the boundary when the viewer changes, or a viewer that
        // errored would keep its "failed" state after a `reopenWith` that was
        // the user's way of getting out of it.
        key={`${file.path}:${descriptor.id}`}
        file={file}
      >
        <Suspense fallback={<p className="app__note viewer__pending">Loading {descriptor.label.toLowerCase()} viewer…</p>}>
          <Mounted
            file={file}
            onDirty={onDirty}
            registerSave={registerSave}
            reopenWith={setOverride}
          />
        </Suspense>
      </ViewerBoundary>
    </div>
  );
}

interface BoundaryProps {
  file: OpenFile;
  children: ReactNode;
}

interface BoundaryState {
  message: string | null;
}

/**
 * A failed viewer, drawn as a failed viewer.
 *
 * The message is shown verbatim rather than replaced with a generic line. A
 * chunk that failed to load, a PDF that pdf.js rejected and a mermaid document
 * with a syntax error all land here, and the only thing that tells them apart
 * is what the library said.
 */
class ViewerBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="viewer__failed">
        <p className="app__note">Could not show {this.props.file.name}.</p>
        <p className="app__error">{this.state.message}</p>
      </div>
    );
  }
}
