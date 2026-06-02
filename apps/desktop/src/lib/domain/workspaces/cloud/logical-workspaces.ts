import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudMobilityWorkspaceSummary,
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
  buildRemoteLogicalWorkspaceId,
  normalizeLogicalWorkspaceBranchKey,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  resolvePreferredLogicalWorkspaceMaterialization,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
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
  effectiveOwnerHintForWorkspace,
  inferLifecycle,
  latestUpdatedAt,
  localDefaultDisplayName,
  mobilityDefaultDisplayName,
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

function collapseExactLocalWorkspaceDuplicates(workspaces: readonly Workspace[]): Workspace[] {
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

  return Array.from(byMaterialization.values()).map((bucket) => (
    bucket.length === 1
      ? bucket[0]!
      : [...bucket].sort(compareExactLocalWorkspaceDuplicateOrder)[0]!
  ));
}

export function buildLogicalWorkspaces(args: {
  localWorkspaces: Workspace[];
  repoRoots: RepoRoot[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  cloudMobilityWorkspaces?: CloudMobilityWorkspaceSummary[];
  currentSelectionId?: string | null;
}): LogicalWorkspace[] {
  const repoRootsById = new Map(args.repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const cloudWorkspacesById = new Map(args.cloudWorkspaces.map((workspace) => [
    workspace.id,
    workspace,
  ]));
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
    mobilityWorkspace: CloudMobilityWorkspaceSummary | null;
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
    const sortedBucket = collapseExactLocalWorkspaceDuplicates(bucket)
      .sort(compareLocalWorkspaceCanonicalOrder);
    sortedBucket.forEach((workspace, index) => {
      const logicalId = index === 0
        ? baseLogicalId
        : buildLocalSlotLogicalWorkspaceId(workspace.id);
      byId.set(logicalId, {
        localWorkspace: workspace,
        cloudWorkspace: null,
        mobilityWorkspace: null,
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
        mobilityWorkspace: null,
      });
      continue;
    }

    current.cloudWorkspace = preferCloudWorkspaceForLogicalSlot(
      current.cloudWorkspace,
      workspace,
      args.currentSelectionId,
    );
  }

  for (const workspace of args.cloudMobilityWorkspaces ?? []) {
    const logicalId = buildRemoteLogicalWorkspaceId(
      workspace.repo.provider,
      workspace.repo.owner,
      workspace.repo.name,
      normalizeLogicalWorkspaceBranchKey(workspace.repo.branch),
    );
    const current = byId.get(logicalId);
    if (!current) {
      byId.set(logicalId, {
        localWorkspace: null,
        cloudWorkspace: workspace.cloudWorkspaceId
          ? cloudWorkspacesById.get(workspace.cloudWorkspaceId) ?? null
          : null,
        mobilityWorkspace: workspace,
      });
      continue;
    }

    if (workspace.cloudWorkspaceId) {
      current.cloudWorkspace = cloudWorkspacesById.get(workspace.cloudWorkspaceId)
        ?? current.cloudWorkspace;
    }
    current.mobilityWorkspace = workspace;
  }

  return Array.from(byId.entries())
    .map(([id, entry]) => {
      const effectiveOwnerHint = effectiveOwnerHintForWorkspace(
        entry.mobilityWorkspace?.owner,
        entry.cloudWorkspace,
      );
      const materialization = resolvePreferredLogicalWorkspaceMaterialization(
        entry.localWorkspace,
        entry.cloudWorkspace,
        entry.mobilityWorkspace,
        args.currentSelectionId ?? null,
        effectiveOwnerHint,
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
          : entry.mobilityWorkspace
            ? repoRootsByRemoteKey.get(
              remoteRepoKey(
                entry.mobilityWorkspace.repo.provider,
                entry.mobilityWorkspace.repo.owner,
                entry.mobilityWorkspace.repo.name,
              )!,
            ) ?? null
            : null;
      const repoKey = entry.localWorkspace
        ? repoRoot
          ? repoRootGroupKey(repoRoot)
          : localWorkspaceGroupKey(entry.localWorkspace)
        : entry.cloudWorkspace
          ? cloudWorkspaceGroupKey(entry.cloudWorkspace)
          : entry.mobilityWorkspace
            ? cloudWorkspaceGroupKey(entry.mobilityWorkspace)
            : id;
      const sourceRoot = entry.localWorkspace?.sourceRepoRootPath
        ?? repoRoot?.path
        ?? entry.localWorkspace?.repoRootId
        ?? entry.localWorkspace?.path
        ?? repoKey;
      const displayName = entry.localWorkspace
        ? localDefaultDisplayName(entry.localWorkspace)
        : entry.cloudWorkspace
          ? cloudDefaultDisplayName(entry.cloudWorkspace)
          : entry.mobilityWorkspace
            ? mobilityDefaultDisplayName(entry.mobilityWorkspace)
            : id;

      return {
        id,
        repoKey,
        sourceRoot,
        repoRoot,
        provider:
          repoRoot?.remoteProvider
          ?? entry.localWorkspace?.gitProvider
          ?? entry.cloudWorkspace?.repo.provider
          ?? entry.mobilityWorkspace?.repo.provider
          ?? null,
        owner:
          repoRoot?.remoteOwner
          ?? entry.localWorkspace?.gitOwner
          ?? entry.cloudWorkspace?.repo.owner
          ?? entry.mobilityWorkspace?.repo.owner
          ?? null,
        repoName:
          repoRoot?.remoteRepoName
          ?? entry.localWorkspace?.gitRepoName
          ?? entry.cloudWorkspace?.repo.name
          ?? entry.mobilityWorkspace?.repo.name
          ?? null,
        branchKey: entry.localWorkspace
          ? workspaceBranchKey(entry.localWorkspace)
          : entry.cloudWorkspace
            ? cloudBranchKey(entry.cloudWorkspace)
            : entry.mobilityWorkspace
              ? normalizeLogicalWorkspaceBranchKey(entry.mobilityWorkspace.repo.branch)
              : "HEAD",
        displayName,
        localWorkspace: entry.localWorkspace,
        cloudWorkspace: entry.cloudWorkspace,
        mobilityWorkspace: entry.mobilityWorkspace,
        preferredMaterializationId: materialization.workspaceId,
        effectiveOwner: effectiveOwnerHint ?? materialization.owner,
        lifecycle: inferLifecycle(
          entry.localWorkspace,
          entry.cloudWorkspace,
          entry.mobilityWorkspace,
          materialization.owner,
        ),
        updatedAt: latestUpdatedAt(
          entry.localWorkspace,
          entry.cloudWorkspace,
          entry.mobilityWorkspace,
        ),
      } satisfies LogicalWorkspace;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
