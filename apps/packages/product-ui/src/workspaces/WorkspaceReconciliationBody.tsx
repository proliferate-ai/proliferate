import { GitBranch } from "lucide-react";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";

/** One target column's presentation, derived entirely by the caller
 * (product-client) from the pure relation model. Props-only: this component
 * computes nothing and reaches for no store. */
export interface WorkspaceReconciliationColumnView {
  /** "This Mac" | "Cloud" | "GitHub branch". */
  title: string;
  /** Short branch label, or null when unknown. */
  branch: string | null;
  /** Abbreviated head sha, or null when unknown/not client-verifiable. */
  headShort: string | null;
  /** A truthful state chip label (e.g. "clean", "2 ahead", "dirty", "missing",
   * "last-known"). */
  stateLabel: string;
  stateTone: BadgeTone;
  /** A truthfulness caveat rendered under the column (e.g. remote staleness). */
  caveat?: string | null;
}

export interface WorkspaceReconciliationBodyView {
  title: string;
  /** This Mac / Cloud / GitHub branch HEAD columns. GitHub may be null when the
   * remote head is not client-visible. */
  columns: WorkspaceReconciliationColumnView[];
  /** The single safe next action's explanation. */
  actionDetail: string;
  /** What stays unchanged if the user cancels. */
  cancelPreserves: string;
}

/**
 * PR 6 — the props-only reconciliation comparison body shared by the
 * WorkspaceAvailabilityActionHost's dialog. It renders the This Mac / Cloud /
 * GitHub branch-HEAD comparison, the one safe next action's explanation, and the
 * what-cancel-preserves line. It uses the app's quiet atoms (Badge chips, a mono
 * glyph) and NEVER a colored left-border / edge-ownership treatment.
 */
export function WorkspaceReconciliationBody({ view }: { view: WorkspaceReconciliationBodyView }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {view.columns.map((column) => (
          <div
            key={column.title}
            className="rounded-lg bg-surface-control px-3 py-2.5"
          >
            <dt className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
              <GitBranch className="icon-paired text-muted-foreground" aria-hidden />
              {column.title}
            </dt>
            <dd className="mt-1.5 space-y-1">
              <Badge tone={column.stateTone} className="text-ui-sm">
                {column.stateLabel}
              </Badge>
              <p className="truncate font-mono text-ui-sm leading-[1.5] text-muted-foreground">
                {column.branch ?? "—"}
                {column.headShort ? ` @ ${column.headShort}` : ""}
              </p>
              {column.caveat ? (
                <p className="text-ui-sm leading-[1.4] text-muted-foreground">{column.caveat}</p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-ui-sm leading-[1.5] text-foreground">{view.actionDetail}</p>
      <p className="text-ui-sm leading-[1.45] text-muted-foreground">
        If you cancel: {view.cancelPreserves}
      </p>
    </div>
  );
}
