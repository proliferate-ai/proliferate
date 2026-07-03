import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { isCloudWorkspaceFailedBeforeReady } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
  repoRootGroupKey,
} from "@/lib/domain/workspaces/cloud/collections";
import {
  buildLocalSlotLogicalWorkspaceId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import { resolvePreferredLogicalWorkspaceMaterialization } from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  buildBaseLogicalWorkspaceIdForLocalWorkspace,
  buildLogicalWorkspaceIdForCloudWorkspace,
  cloudBranchKey,
  compareLocalWorkspaceCanonicalOrder,
  remoteRepoKey,
  resolveLocalWorkspaceRepoRoot,
  workspaceBranchKey,
} from "@/lib/domain/workspaces/cloud/logical-workspace-source";
import {
  cloudDefaultDisplayName,
  cloudWorkspaceMatchesSelection,
  inferLifecycle,
  latestUpdatedAt,
  localDefaultDisplayName,
  preferCloudWorkspaceForLogicalSlot,
} from "@/lib/domain/workspaces/cloud/logical-workspace-slot";

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

interface CollapsedLocalWorkspace {
  workspace: Workspace;
  aliasIds: string[];
}

function localWorkspaceIdentityIds(workspace: Workspace): string[] {
  return [workspace.id, buildLocalSlotLogicalWorkspaceId(workspace.id)];
}

function localWorkspaceMatchesSelection(
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

function collapseExactLocalWorkspaceDuplicates(
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

export function buildLogicalWorkspaces(args: {
  localWorkspaces: Workspace[];
  repoRoots: RepoRoot[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  currentSelectionId?: string | null;
}): LogicalWorkspace[] {
  const repoRootsById = new Map(args.repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const repoRootsByRemoteKey = new Map(
    args.repoRoots
      .filter((repoRoot) => (
        repoRoot.remoteProvider
        && repoRoot.remoteOwner
        && repoRoot.remoteRepoName
      ))
      .map((repoRoot) => [
        remoteRepoKey(repoRoot.remoteProvider, repoRoot.remoteOwner, repoRoot.remoteRepoName)!,
        repoRoot,
      ]),
  );
  const byId = new Map<string, {
    localWorkspace: Workspace | null;
    cloudWorkspace: CloudWorkspaceSummary | null;
    aliasIds: string[];
  }>();

  const localBuckets = new Map<string, Workspace[]>();
  for (const workspace of args.localWorkspaces) {
    const repoRoot = resolveLocalWorkspaceRepoRoot(workspace, repoRootsById, repoRootsByRemoteKey);
    const baseLogicalId = buildBaseLogicalWorkspaceIdForLocalWorkspace(workspace, repoRoot);
    const bucket = localBuckets.get(baseLogicalId);
    if (bucket) {
      bucket.push(workspace);
    } else {
      localBuckets.set(baseLogicalId, [workspace]);
    }
  }

  for (const [baseLogicalId, bucket] of localBuckets) {
    const sortedBucket = collapseExactLocalWorkspaceDuplicates(
      bucket,
      args.currentSelectionId ?? null,
    )
      .sort((left, right) => compareLocalWorkspaceCanonicalOrder(left.workspace, right.workspace));
    sortedBucket.forEach((collapsed, index) => {
      const { workspace } = collapsed;
      const logicalId = index === 0
        ? baseLogicalId
        : buildLocalSlotLogicalWorkspaceId(workspace.id);
      byId.set(logicalId, {
        localWorkspace: workspace,
        cloudWorkspace: null,
        aliasIds: collapsed.aliasIds,
      });
    });
  }

  for (const workspace of args.cloudWorkspaces) {
    const logicalId = buildLogicalWorkspaceIdForCloudWorkspace(workspace);
    if (
      isCloudWorkspaceFailedBeforeReady(workspace)
      && !cloudWorkspaceMatchesSelection(workspace, logicalId, args.currentSelectionId)
    ) {
      continue;
    }

    const current = byId.get(logicalId);
    if (!current) {
      byId.set(logicalId, {
        localWorkspace: null,
        cloudWorkspace: workspace,
        aliasIds: [],
      });
      continue;
    }

    current.cloudWorkspace = preferCloudWorkspaceForLogicalSlot(
      current.cloudWorkspace,
      workspace,
      args.currentSelectionId,
    );
  }

  return Array.from(byId.entries())
    .map(([id, entry]) => {
      const materialization = resolvePreferredLogicalWorkspaceMaterialization(
        entry.localWorkspace,
        entry.cloudWorkspace,
        args.currentSelectionId ?? null,
      );
      const repoRoot = entry.localWorkspace
        ? resolveLocalWorkspaceRepoRoot(entry.localWorkspace, repoRootsById, repoRootsByRemoteKey)
        : entry.cloudWorkspace
          ? repoRootsByRemoteKey.get(
            remoteRepoKey(
              entry.cloudWorkspace.repo.provider,
              entry.cloudWorkspace.repo.owner,
              entry.cloudWorkspace.repo.name,
            )!,
          ) ?? null
          : null;
      const repoKey = entry.localWorkspace
        ? repoRoot
          ? repoRootGroupKey(repoRoot)
          : localWorkspaceGroupKey(entry.localWorkspace)
        : entry.cloudWorkspace
          ? cloudWorkspaceGroupKey(entry.cloudWorkspace)
          : id;
      const sourceRoot = repoRoot?.path
        ?? entry.localWorkspace?.repoRootId
        ?? entry.localWorkspace?.path
        ?? repoKey;
      const displayName = entry.localWorkspace
        ? localDefaultDisplayName(entry.localWorkspace)
        : entry.cloudWorkspace
          ? cloudDefaultDisplayName(entry.cloudWorkspace)
          : id;

      return {
        id,
        repoKey,
        sourceRoot,
        repoRoot,
        provider:
          repoRoot?.remoteProvider
          ?? entry.cloudWorkspace?.repo.provider
          ?? null,
        owner:
          repoRoot?.remoteOwner
          ?? entry.cloudWorkspace?.repo.owner
          ?? null,
        repoName:
          repoRoot?.remoteRepoName
          ?? entry.cloudWorkspace?.repo.name
          ?? null,
        branchKey: entry.localWorkspace
          ? workspaceBranchKey(entry.localWorkspace)
          : entry.cloudWorkspace
            ? cloudBranchKey(entry.cloudWorkspace)
            : "HEAD",
        displayName,
        localWorkspace: entry.localWorkspace,
        cloudWorkspace: entry.cloudWorkspace,
        aliasIds: entry.aliasIds,
        preferredMaterializationId: materialization.workspaceId,
        effectiveOwner: materialization.owner,
        lifecycle: inferLifecycle(
          entry.localWorkspace,
          entry.cloudWorkspace,
          materialization.owner,
        ),
        updatedAt: latestUpdatedAt(
          entry.localWorkspace,
          entry.cloudWorkspace,
        ),
      } satisfies LogicalWorkspace;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
