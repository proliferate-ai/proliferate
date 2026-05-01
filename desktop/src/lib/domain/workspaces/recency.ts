import {
  latestLogicalWorkspaceTimestamp,
  type LogicalWorkspace,
} from "@/lib/domain/workspaces/logical-workspaces";

export interface LogicalWorkspaceRecency {
  activityAt: string | null;
  recordUpdatedAt: string;
  sortAt: string;
  displayAt: string | null;
}

export function timestampMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveLogicalWorkspaceRecency(
  workspace: Pick<
    LogicalWorkspace,
    "id" | "updatedAt" | "localWorkspace" | "cloudWorkspace" | "mobilityWorkspace" | "preferredMaterializationId"
  >,
  workspaceActivityAt: Record<string, string>,
): LogicalWorkspaceRecency {
  const persistedActivityAt = latestLogicalWorkspaceTimestamp(workspaceActivityAt, workspace);
  const runtimeActivityAt = workspace.localWorkspace?.executionSummary?.updatedAt ?? null;
  const activityAt = latestTimestamp(persistedActivityAt, runtimeActivityAt);

  return {
    activityAt,
    recordUpdatedAt: workspace.updatedAt,
    sortAt: activityAt ?? workspace.updatedAt,
    displayAt: activityAt,
  };
}

function latestTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }

  return timestampMs(right) > timestampMs(left) ? right : left;
}

export function compareLogicalWorkspaceRecency(
  left: LogicalWorkspace,
  right: LogicalWorkspace,
  workspaceActivityAt: Record<string, string>,
): number {
  const leftRecency = resolveLogicalWorkspaceRecency(left, workspaceActivityAt);
  const rightRecency = resolveLogicalWorkspaceRecency(right, workspaceActivityAt);
  const bySortAt = timestampMs(rightRecency.sortAt) - timestampMs(leftRecency.sortAt);
  if (bySortAt !== 0) {
    return bySortAt;
  }

  const byRecordUpdatedAt =
    timestampMs(rightRecency.recordUpdatedAt) - timestampMs(leftRecency.recordUpdatedAt);
  if (byRecordUpdatedAt !== 0) {
    return byRecordUpdatedAt;
  }

  return 0;
}
