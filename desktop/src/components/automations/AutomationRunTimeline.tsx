import { memo } from "react";
import type { AutomationRunResponse } from "@/lib/integrations/cloud/client";
import { Button } from "@/components/ui/Button";
import {
  automationRunStatusLabel,
  automationRunTimestampLabel,
} from "@/lib/domain/automations/view-model";

interface AutomationRunTimelineProps {
  runs: AutomationRunResponse[];
  loading: boolean;
  pendingCloudWorkspaceId?: string | null;
  openableLocalWorkspaceIds?: ReadonlySet<string>;
  onOpenCloudWorkspace?: (cloudWorkspaceId: string) => void;
  onOpenLocalWorkspace?: (run: AutomationRunResponse) => void;
}

interface AutomationRunTimelineRowProps {
  run: AutomationRunResponse;
  pendingCloudWorkspaceId?: string | null;
  openableLocalWorkspaceIds: ReadonlySet<string>;
  onOpenCloudWorkspace?: (cloudWorkspaceId: string) => void;
  onOpenLocalWorkspace?: (run: AutomationRunResponse) => void;
}

const EMPTY_LOCAL_WORKSPACE_IDS = new Set<string>();

const AutomationRunTimelineRow = memo(function AutomationRunTimelineRow({
  run,
  pendingCloudWorkspaceId,
  openableLocalWorkspaceIds,
  onOpenCloudWorkspace,
  onOpenLocalWorkspace,
}: AutomationRunTimelineRowProps) {
  const statusLabel = automationRunStatusLabel(run);
  const opening = run.cloudWorkspaceId === pendingCloudWorkspaceId;
  const statusTitle = run.status === "failed"
    ? run.lastErrorMessage ?? statusLabel
    : statusLabel;
  const canOpenLocalWorkspace = run.anyharnessWorkspaceId
    ? openableLocalWorkspaceIds.has(run.anyharnessWorkspaceId)
    : false;

  return (
    <div className="rounded-lg border border-border bg-foreground/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            className="truncate text-sm font-medium text-foreground"
            title={statusTitle}
          >
            {statusLabel}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {automationRunTimestampLabel(run)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {run.cloudWorkspaceId && onOpenCloudWorkspace ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenCloudWorkspace(run.cloudWorkspaceId!)}
              disabled={opening}
            >
              {opening ? "Opening..." : "Open workspace"}
            </Button>
          ) : canOpenLocalWorkspace && onOpenLocalWorkspace ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenLocalWorkspace(run)}
            >
              Open workspace
            </Button>
          ) : null}
          <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
            {run.triggerKind}
          </span>
        </div>
      </div>
    </div>
  );
});

export function AutomationRunTimeline({
  runs,
  loading,
  pendingCloudWorkspaceId = null,
  openableLocalWorkspaceIds = EMPTY_LOCAL_WORKSPACE_IDS,
  onOpenCloudWorkspace,
  onOpenLocalWorkspace,
}: AutomationRunTimelineProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-4 text-sm text-muted-foreground">
        Loading runs...
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-foreground/5 p-4 text-sm text-muted-foreground">
        No runs queued yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {runs.map((run) => (
        <AutomationRunTimelineRow
          key={run.id}
          run={run}
          pendingCloudWorkspaceId={pendingCloudWorkspaceId}
          openableLocalWorkspaceIds={openableLocalWorkspaceIds}
          onOpenCloudWorkspace={onOpenCloudWorkspace}
          onOpenLocalWorkspace={onOpenLocalWorkspace}
        />
      ))}
    </div>
  );
}
