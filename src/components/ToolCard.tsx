import { openUrl } from "@tauri-apps/plugin-opener";
import type { ResolvedTool } from "../bindings";
import { revealTool } from "../bindings";
import StatusBadge from "./StatusBadge";

export default function ToolCard({ tool }: { tool: ResolvedTool }) {
  const present = tool.status.state !== "missing";

  return (
    <article className={`card${present ? "" : " card--absent"}`}>
      <header className="card__head">
        <h3 className="card__title">{tool.name}</h3>
        <StatusBadge status={tool.status} />
      </header>

      <p className="card__desc">{tool.description}</p>

      <dl className="card__meta">
        <dt>pinned</dt>
        <dd className="mono">{tool.version}</dd>

        <dt>path</dt>
        <dd className="mono card__path" title={tool.checkoutPath}>
          {tool.checkoutPath}
        </dd>
      </dl>

      <footer className="card__actions">
        <button
          type="button"
          className="btn"
          disabled={!present}
          onClick={() => {
            // Errors from Rust arrive as a rejected promise carrying the
            // `Display` string of our AppError.
            revealTool(tool.id).catch((err) => console.error(String(err)));
          }}
        >
          Reveal
        </button>

        {/* A plain <a target="_blank"> would navigate the webview itself.
            `openUrl` hands the URL to the OS default browser instead. */}
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            openUrl(tool.repo).catch((err) => console.error(String(err)));
          }}
        >
          Repo ↗
        </button>

        {present && !tool.isGitRepo && <span className="hint">no .git</span>}
      </footer>
    </article>
  );
}
