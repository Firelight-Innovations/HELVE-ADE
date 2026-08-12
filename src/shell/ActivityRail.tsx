import type { ResolvedTool } from "../bindings";

/**
 * The vertical strip of tools down the left edge.
 *
 * Its contents are not hardcoded — they come from whatever `helve.toml`
 * declares, by way of the `StackSnapshot` the backend resolved at boot. Adding
 * a tool to the manifest puts it in this rail with no change to shell code,
 * which is the property that makes the manifest the actual source of truth
 * rather than a thing that has to be kept in sync with a list over here.
 *
 * A tool with no checkout on disk is rendered disabled. That is not cosmetic:
 * there is no code to load, so selecting it could not show anything. Surfacing
 * that here — rather than letting it be selected and failing later — is why
 * the rail takes resolved tools and not just the manifest's declarations.
 */
export default function ActivityRail({
  tools,
  activeId,
  onSelect,
}: {
  tools: ResolvedTool[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="rail" aria-label="Tools">
      {tools.map((tool) => {
        const missing = tool.status.state === "missing";

        return (
          <button
            key={tool.id}
            type="button"
            className="rail__item"
            aria-current={tool.id === activeId ? "page" : undefined}
            aria-disabled={missing || undefined}
            disabled={missing}
            // The name carries the detail the glyph can't. Until there are
            // real icons, the glyph is just the first letter, so the tooltip
            // is doing most of the work of telling these apart.
            title={missing ? `${tool.name} — not cloned` : tool.name}
            onClick={() => onSelect(tool.id)}
          >
            <span className="rail__glyph" aria-hidden="true">
              {tool.name.charAt(0)}
            </span>
            <span className="sr-only">{tool.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
