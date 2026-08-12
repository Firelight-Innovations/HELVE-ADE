import type { ToolStatus } from "../bindings";

/**
 * Renders a tool's discovery status. Narrowing on `status.state` is what makes
 * the extra fields available in each branch.
 */
export default function StatusBadge({ status }: { status: ToolStatus }) {
  switch (status.state) {
    case "ready":
      return <span className="badge badge--ready">v{status.version}</span>;
    case "mismatch":
      return (
        <span
          className="badge badge--mismatch"
          title={`Pinned ${status.expected}, checkout reports ${status.found}`}
        >
          {status.found} ≠ {status.expected}
        </span>
      );
    case "unversioned":
      return (
        <span className="badge badge--unversioned" title="Checkout exists but has no Cargo.toml or package.json to read a version from">
          unversioned
        </span>
      );
    case "missing":
      return (
        <span className="badge badge--missing" title="No checkout at the expected path">
          not cloned
        </span>
      );
  }
}
