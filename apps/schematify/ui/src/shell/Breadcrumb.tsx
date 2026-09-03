/**
 * The breadcrumb (PRD §12.1): "The active segment draws its slug on a second
 * line, in the form `auth-service`." 1 to 3 segments, one per open tier.
 *
 * **Wave 5's breadcrumb walk-up.** Every segment but the last is a button:
 * clicking one navigates back to the tier it names. `App.tsx` owns the
 * navigation state this drives (an array of `DrillTarget`s, truncated to the
 * clicked index) — this component only reports which index was clicked.
 */
export interface BreadcrumbProps {
  segments: string[];
  activeSlug: string;
  /** Called with the clicked segment's index. Omitted (or the last segment,
   *  already active) draws plain text instead of a button. */
  onNavigate?: (index: number) => void;
}

export function Breadcrumb({ segments, activeSlug, onNavigate }: BreadcrumbProps) {
  return (
    <div className="kv-breadcrumb">
      <div className="kv-breadcrumb__path">
        {segments.map((segment, index) => {
          const isActive = index === segments.length - 1;
          return (
            <span key={`${segment}-${index}`} className="kv-breadcrumb__segment-group">
              {index > 0 ? <span className="kv-breadcrumb__sep"> › </span> : null}
              {isActive || !onNavigate ? (
                <span
                  className={
                    isActive
                      ? "kv-breadcrumb__segment kv-breadcrumb__segment--active"
                      : "kv-breadcrumb__segment"
                  }
                >
                  {segment}
                </span>
              ) : (
                <button
                  type="button"
                  className="kv-breadcrumb__segment kv-breadcrumb__segment--link"
                  onClick={() => onNavigate(index)}
                >
                  {segment}
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className="kv-breadcrumb__slug">{activeSlug}</div>
    </div>
  );
}
