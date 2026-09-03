/**
 * The breadcrumb (PRD §12.1): "The active segment draws its slug on a second
 * line, in the form `auth-service`." 1 to 3 segments, one per open tier —
 * this wave only ever opens the Service Schematic, so `segments` always
 * holds exactly `["Stack", serviceTitle]` in practice, but the component
 * takes a list so Wave 5's tier-drilling has somewhere to grow it.
 */
export interface BreadcrumbProps {
  segments: string[];
  activeSlug: string;
}

export function Breadcrumb({ segments, activeSlug }: BreadcrumbProps) {
  return (
    <div className="kv-breadcrumb">
      <div className="kv-breadcrumb__path">{segments.join(" › ")}</div>
      <div className="kv-breadcrumb__slug">{activeSlug}</div>
    </div>
  );
}
