import type { Workspace } from "@anyharness/sdk";
import { buildLocalSlotLogicalWorkspaceId } from "#product/lib/domain/workspaces/cloud/logical-workspace-id";
import { compareLocalWorkspaceCanonicalOrder, workspaceBranchKey } from "#product/lib/domain/workspaces/cloud/logical-workspace-source";

// Collapsing of exact path+branch local duplicates for the logical-workspace
// projection. Extracted from logical-workspaces.ts so the projection file stays
// focused on materialization-first attachment (PR 5). Behavior is unchanged:
// two workspaces with the same exact path and case-sensitive branch fold onto
// one representative unless a duplicate has its own sessions or is selected.

function timestampValue(timestamp: string | null | undefined): number {
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function localWorkspaceExactMaterializationKey(workspace: Workspace): string {
  return `${workspace.path.trim()}\0${workspaceBranchKey(workspace)}`;
}

function workspaceExecutionPriority(workspace: Workspace): number {
  const summary = workspace.executionSummary;
  if (!summary) {
    return 0;
  }

  if (summary.totalSessionCount > summary.liveSessionCount) {
    return 3;
  }

  if (summary.phase === "running" || summary.phase === "awaiting_interaction") {
    return 2;
  }

  if (summary.totalSessionCount > 0) {
    return 1;
  }

  return 0;
}

function compareExactLocalWorkspaceDuplicateOrder(left: Workspace, right: Workspace): number {
  const byExecutionPriority = workspaceExecutionPriority(right) - workspaceExecutionPriority(left);
  if (byExecutionPriority !== 0) {
    return byExecutionPriority;
  }

  const byExecutionUpdatedAt = (
    timestampValue(right.executionSummary?.updatedAt)
    - timestampValue(left.executionSummary?.updatedAt)
  );
  if (byExecutionUpdatedAt !== 0) {
    return byExecutionUpdatedAt;
  }

  const byWorkspaceUpdatedAt = timestampValue(right.updatedAt) - timestampValue(left.updatedAt);
  if (byWorkspaceUpdatedAt !== 0) {
    return byWorkspaceUpdatedAt;
  }

  return compareLocalWorkspaceCanonicalOrder(left, right);
}

export interface CollapsedLocalWorkspace {
  workspace: Workspace;
  aliasIds: string[];
}

function localWorkspaceIdentityIds(workspace: Workspace): string[] {
  return [workspace.id, buildLocalSlotLogicalWorkspaceId(workspace.id)];
}

export function localWorkspaceMatchesSelection(
  workspace: Workspace,
  currentSelectionId: string | null,
): boolean {
  return currentSelectionId !== null
    && localWorkspaceIdentityIds(workspace).includes(currentSelectionId);
}

function compareExactLocalWorkspaceDuplicateOrderForSelection(
  currentSelectionId: string | null,
): (left: Workspace, right: Workspace) => number {
  return (left, right) => {
    const leftSelected = localWorkspaceMatchesSelection(left, currentSelectionId);
    const rightSelected = localWorkspaceMatchesSelection(right, currentSelectionId);
    if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1;
    }
    return compareExactLocalWorkspaceDuplicateOrder(left, right);
  };
}

function workspaceHasOwnSessions(workspace: Workspace): boolean {
  return (workspace.executionSummary?.totalSessionCount ?? 0) > 0;
}

export function collapseExactLocalWorkspaceDuplicates(
  workspaces: readonly Workspace[],
  currentSelectionId: string | null,
): CollapsedLocalWorkspace[] {
  const byMaterialization = new Map<string, Workspace[]>();
  for (const workspace of workspaces) {
    const key = localWorkspaceExactMaterializationKey(workspace);
    const bucket = byMaterialization.get(key);
    if (bucket) {
      bucket.push(workspace);
    } else {
      byMaterialization.set(key, [workspace]);
    }
  }

  return Array.from(byMaterialization.values()).flatMap((bucket): CollapsedLocalWorkspace[] => {
    if (bucket.length === 1) {
      return [{ workspace: bucket[0]!, aliasIds: [] }];
    }

    const distinct = bucket.filter(
      (candidate) =>
        workspaceHasOwnSessions(candidate)
        || localWorkspaceMatchesSelection(candidate, currentSelectionId),
    );
    const foldable = bucket.filter(
      (candidate) =>
        !workspaceHasOwnSessions(candidate)
        && !localWorkspaceMatchesSelection(candidate, currentSelectionId),
    );

    if (distinct.length === 0) {
      const representative = [...foldable]
        .sort(compareExactLocalWorkspaceDuplicateOrderForSelection(currentSelectionId))[0]!;
      return [{
        workspace: representative,
        aliasIds: foldable
          .filter((candidate) => candidate.id !== representative.id)
          .flatMap(localWorkspaceIdentityIds),
      }];
    }

    const sortedDistinct = [...distinct]
      .sort(compareExactLocalWorkspaceDuplicateOrderForSelection(currentSelectionId));
    const foldedAliasIds = foldable.flatMap(localWorkspaceIdentityIds);
    return sortedDistinct.map((workspace, index) => ({
      workspace,
      // Fold stale empty duplicates onto the first distinct entry.
      aliasIds: index === 0 ? foldedAliasIds : [],
    }));
  });
}
