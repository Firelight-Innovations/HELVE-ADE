/**
 * Design Mode: a page you are building, beside what a click on it produced.
 *
 * The layout is two columns and stays two columns, because the pair is the
 * point. Clicking an element and then losing sight of the page in order to read
 * what was captured is how somebody ends up unsure which element they picked.
 *
 * This component owns no sequencing — `useProbeFrame` does, and its header says
 * why the order matters. What is here is the address bar, the pick toggle, and
 * the panel that reads out a capture.
 */
import { useEffect, useRef, useState } from "react";
import { reportPainted } from "@helve/bridge";
import { copyForAgent, type Handoff } from "./handoff";
import { toLabel, toPrompt } from "./prompt";
import { useProbeFrame } from "./useProbeFrame";

/** What the frame is allowed to do. Read the omissions rather than the list:
 *  there is no `allow-top-navigation`, so the page cannot replace the HELVE
 *  window with itself — which a cross-origin frame may otherwise do off a user
 *  gesture, and a click on an element is a user gesture. */
const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

const HANDOFF_WORDING: Record<Handoff, string> = {
  text: "Copied. Paste it into an agent's terminal.",
  "text-and-image": "Copied, with the screenshot beside it.",
  failed: "The clipboard refused the write.",
};

export default function App() {
  const { frameRef, target, phase, notice, captured, onFrameLoad, load, togglePicking, dismiss } =
    useProbeFrame();
  const [address, setAddress] = useState("");
  const [handoff, setHandoff] = useState<string | null>(null);
  const painted = useRef(false);

  // The right moment is the *content*, and this app's first content is the
  // empty state: there is nothing to fetch before it can be drawn, and holding
  // the splash back for a frame that is already right would only make the
  // window slower to appear. See `apps/README.md`.
  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    reportPainted();
  }, []);

  const picking = phase === "picking";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setHandoff(null);
    load(address);
  };

  const copy = async () => {
    if (!captured) return;
    setHandoff(HANDOFF_WORDING[await copyForAgent(captured.element, captured.shot)]);
  };

  return (
    <div className="app design">
      <form className="design__bar" onSubmit={submit}>
        <input
          className="design__address"
          type="text"
          value={address}
          spellCheck={false}
          placeholder="localhost:5173"
          aria-label="Address of the page to inspect"
          onChange={(event) => setAddress(event.target.value)}
        />
        <button className="design__go" type="submit" disabled={address.trim() === ""}>
          {target ? "Reload" : "Open"}
        </button>
        <button
          className="design__pick"
          type="button"
          onClick={togglePicking}
          aria-pressed={picking}
          disabled={phase !== "ready" && !picking}
        >
          {picking ? "Picking — Esc to stop" : "Pick element"}
        </button>
        {target ? <span className="design__origin">{target.origin}</span> : null}
      </form>

      {notice ? <p className="design__notice">{notice}</p> : null}

      <div className="design__split">
        <div className="design__stage">
          {target ? (
            <iframe
              ref={frameRef}
              className="design__frame"
              src={target.url}
              sandbox={FRAME_SANDBOX}
              title="The page under inspection"
              onLoad={onFrameLoad}
            />
          ) : (
            <div className="design__empty">
              <p>Open a page you are working on — your dev server, usually.</p>
              <p className="design__hint">
                Then pick an element in it, and its markup, its computed styles and a picture of it
                go to an agent in one paste.
              </p>
            </div>
          )}
        </div>

        <aside className="design__panel">
          {captured ? (
            <>
              <header className="design__panelhead">
                <h2 className="design__panelname">{toLabel(captured.element)}</h2>
                <button className="design__plain" type="button" onClick={dismiss}>
                  Clear
                </button>
              </header>

              {captured.shot ? (
                <img className="design__shot" src={captured.shot.dataUrl} alt="" />
              ) : (
                <p className="design__shotmiss">{captured.shotProblem ?? "Taking the picture…"}</p>
              )}

              <div className="design__actions">
                <button className="design__copy" type="button" onClick={() => void copy()}>
                  Copy for agent
                </button>
                {handoff ? <span className="design__said">{handoff}</span> : null}
              </div>

              <pre className="design__prompt">
                {toPrompt(captured.element, { withScreenshot: captured.shot !== null })}
              </pre>
            </>
          ) : (
            <p className="design__idle">
              {picking
                ? "Click an element in the page."
                : "Nothing picked yet. Open a page, then use Pick element."}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
