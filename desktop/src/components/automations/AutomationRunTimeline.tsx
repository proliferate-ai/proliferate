import { memo, type KeyboardEvent } from "react";
import type { AutomationRunResponse } from "@/lib/access/cloud/client";
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

function triggerKindLabel(kind: AutomationRunResponse["triggerKind"]): string {
  return kind === "manual" ? "Manual" : "Scheduled";
}

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
  const canOpenCloudWorkspace = Boolean(run.cloudWorkspaceId && onOpenCloudWorkspace);
  const canOpenWorkspace = canOpenCloudWorkspace || Boolean(canOpenLocalWorkspace && onOpenLocalWorkspace);
  const openWorkspace = () => {
    if (opening) {
      return;
    }
    if (run.cloudWorkspaceId && onOpenCloudWorkspace) {
      onOpenCloudWorkspace(run.cloudWorkspaceId);
      return;
    }
    if (canOpenLocalWorkspace && onOpenLocalWorkspace) {
      onOpenLocalWorkspace(run);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canOpenWorkspace || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    openWorkspace();
  };

  return (
    <div role="listitem">
      <div
        role={canOpenWorkspace ? "button" : undefined}
        tabIndex={canOpenWorkspace ? 0 : undefined}
        aria-label={canOpenWorkspace ? "Open workspace" : undefined}
        aria-disabled={opening || undefined}
        onClick={canOpenWorkspace ? openWorkspace : undefined}
        onKeyDown={handleKeyDown}
        className={`rounded-lg px-3 py-3 transition-colors ${
          canOpenWorkspace
            ? "cursor-pointer hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            : ""
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p
              className="truncate text-base leading-6 text-foreground"
              title={statusTitle}
            >
              {statusLabel}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {automationRunTimestampLabel(run)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {triggerKindLabel(run.triggerKind)}
            </span>
            {canOpenWorkspace ? (
              <span className="text-sm text-muted-foreground">
                {opening ? "Opening..." : "Open workspace"}
              </span>
            ) : null}
          </div>
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
      <div className="-mx-3 rounded-lg px-3 py-6 text-sm text-muted-foreground">
        Loading runs...
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="-mx-3 rounded-lg px-3 py-6 text-sm text-muted-foreground">
        No runs queued yet.
      </div>
    );
  }

  return (
    <div className="-mx-3 flex flex-col gap-1" role="list">
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
