import { GitBranch } from "#product/primitives/icons/workspace-git";
import { Badge } from "#product/primitives/Badge";
import type { WorkspaceReconciliationBodyView } from "#product/lib/domain/workspaces/cloud/reconciliation-body-view";

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
              <p className="truncate font-mono text-ui-sm text-muted-foreground">
                {column.branch ?? "—"}
                {column.headShort ? ` @ ${column.headShort}` : ""}
              </p>
              {column.caveat ? (
                <p className="text-ui-sm text-muted-foreground">{column.caveat}</p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-ui-sm text-foreground">{view.actionDetail}</p>
      <p className="text-ui-sm text-muted-foreground">
        If you cancel: {view.cancelPreserves}
      </p>
    </div>
  );
}
