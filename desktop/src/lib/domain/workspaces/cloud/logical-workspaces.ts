import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  humanizeBranchName,
  workspaceCurrentBranchName,
} from "@/lib/domain/workspaces/creation/branch-naming";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
} from "@/lib/domain/workspaces/cloud/collections";
import {
  buildLocalSlotLogicalWorkspaceId,
  buildPathLogicalWorkspaceId,
  buildRemoteLogicalWorkspaceId,
  buildRepoRootLogicalWorkspaceId,
  normalizeLogicalWorkspaceBranchKey,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  resolvePreferredLogicalWorkspaceMaterialization,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";

function workspaceBranchKey(workspace: Workspace): string {
  const originalBranch = workspace.originalBranch?.trim();
  if (originalBranch) {
    return normalizeLogicalWorkspaceBranchKey(originalBranch);
  }

  return normalizeLogicalWorkspaceBranchKey(workspaceCurrentBranchName(workspace));
}

function cloudBranchKey(workspace: CloudWorkspaceSummary): string {
  return normalizeLogicalWorkspaceBranchKey(workspace.repo.branch);
}

function buildBaseLogicalWorkspaceIdForLocalWorkspace(workspace: Workspace): string {
  if (workspace.gitProvider && workspace.gitOwner && workspace.gitRepoName) {
    return buildRemoteLogicalWorkspaceId(
      workspace.gitProvider,
      workspace.gitOwner,
      workspace.gitRepoName,
      workspaceBranchKey(workspace),
    );
  }

  if (workspace.repoRootId) {
    return buildRepoRootLogicalWorkspaceId(workspace.repoRootId, workspaceBranchKey(workspace));
  }

  return buildPathLogicalWorkspaceId(
    workspace.sourceRepoRootPath ?? workspace.path,
    workspaceBranchKey(workspace),
  );
}

function compareLocalWorkspaceCanonicalOrder(left: Workspace, right: Workspace): number {
  const byCreatedAt = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (byCreatedAt !== 0) {
    return byCreatedAt;
  }
  return left.id.localeCompare(right.id);
}

function buildLogicalWorkspaceIdForCloudWorkspace(workspace: CloudWorkspaceSummary): string {
  return buildRemoteLogicalWorkspaceId(
    workspace.repo.provider,
    workspace.repo.owner,
    workspace.repo.name,
    cloudBranchKey(workspace),
  );
}

function localDefaultDisplayName(workspace: Workspace): string {
  return workspaceDisplayName(workspace);
}

function cloudDefaultDisplayName(workspace: CloudWorkspaceSummary): string {
  const override = workspace.displayName?.trim();
  if (override) {
    return override;
  }

  return workspace.repo.branch?.trim()
    ? humanizeBranchName(workspace.repo.branch)
    : workspace.repo.name;
}

function mobilityDefaultDisplayName(workspace: CloudMobilityWorkspaceSummary): string {
  const override = workspace.displayName?.trim();
  if (override) {
    return override;
  }

  return workspace.repo.branch?.trim()
    ? humanizeBranchName(workspace.repo.branch)
    : workspace.repo.name;
}

function latestUpdatedAt(
  localWorkspace: Workspace | null,
  cloudWorkspace: CloudWorkspaceSummary | null,
  mobilityWorkspace: CloudMobilityWorkspaceSummary | null,
): string {
  const localUpdatedAt = localWorkspace?.updatedAt ?? "";
  const cloudUpdatedAt = cloudWorkspace?.updatedAt ?? cloudWorkspace?.createdAt ?? "";
  const mobilityUpdatedAt = mobilityWorkspace?.updatedAt ?? mobilityWorkspace?.createdAt ?? "";
  return [localUpdatedAt, cloudUpdatedAt, mobilityUpdatedAt]
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? "";
}

function inferLifecycle(
  localWorkspace: Workspace | null,
  cloudWorkspace: CloudWorkspaceSummary | null,
  mobilityWorkspace: CloudMobilityWorkspaceSummary | null,
  owner: "local" | "cloud",
): LogicalWorkspace["lifecycle"] {
  const mobilityLifecycle = mobilityWorkspace?.lifecycleState;
  if (
    mobilityLifecycle === "local_active"
    || mobilityLifecycle === "moving_to_cloud"
    || mobilityLifecycle === "cloud_active"
    || mobilityLifecycle === "moving_to_local"
    || mobilityLifecycle === "handoff_failed"
    || mobilityLifecycle === "cleanup_failed"
    || mobilityLifecycle === "cloud_lost"
  ) {
    return mobilityLifecycle;
  }

  if (mobilityWorkspace?.lastError) {
    return "handoff_failed";
  }

  if (owner === "cloud") {
    return "cloud_active";
  }

  if (localWorkspace || cloudWorkspace) {
    return "local_active";
  }

  return "handoff_failed";
}

export function buildLogicalWorkspaces(args: {
  localWorkspaces: Workspace[];
  repoRoots: RepoRoot[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  cloudMobilityWorkspaces?: CloudMobilityWorkspaceSummary[];
  currentSelectionId?: string | null;
}): LogicalWorkspace[] {
  const repoRootsById = new Map(args.repoRoots.map((repoRoot) => [repoRoot.id, repoRoot]));
  const repoRootsByRemoteKey = new Map(
    args.repoRoots
      .filter((repoRoot) =>
        repoRoot.remoteProvider
        && repoRoot.remoteOwner
        && repoRoot.remoteRepoName)
      .map((repoRoot) => [
        `${repoRoot.remoteProvider}:${repoRoot.remoteOwner}:${repoRoot.remoteRepoName}`,
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
    const baseLogicalId = buildBaseLogicalWorkspaceIdForLocalWorkspace(workspace);
    const bucket = localBuckets.get(baseLogicalId);
    if (bucket) {
      bucket.push(workspace);
    } else {
      localBuckets.set(baseLogicalId, [workspace]);
    }
  }

  for (const [baseLogicalId, bucket] of localBuckets) {
    const sortedBucket = [...bucket].sort(compareLocalWorkspaceCanonicalOrder);
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
    const current = byId.get(logicalId);
    if (!current) {
      byId.set(logicalId, {
        localWorkspace: null,
        cloudWorkspace: workspace,
        mobilityWorkspace: null,
      });
      continue;
    }

    current.cloudWorkspace = workspace;
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
        cloudWorkspace: null,
        mobilityWorkspace: workspace,
      });
      continue;
    }

    current.mobilityWorkspace = workspace;
  }

  return Array.from(byId.entries())
    .map(([id, entry]) => {
      const materialization = resolvePreferredLogicalWorkspaceMaterialization(
        entry.localWorkspace,
        entry.cloudWorkspace,
        entry.mobilityWorkspace,
        args.currentSelectionId ?? null,
        entry.mobilityWorkspace?.owner === "local" || entry.mobilityWorkspace?.owner === "cloud"
          ? entry.mobilityWorkspace.owner
          : null,
      );
      const repoKey = entry.localWorkspace
        ? localWorkspaceGroupKey(entry.localWorkspace)
        : entry.cloudWorkspace
          ? cloudWorkspaceGroupKey(entry.cloudWorkspace)
          : entry.mobilityWorkspace
            ? cloudWorkspaceGroupKey(entry.mobilityWorkspace)
            : id;
      const repoRoot = entry.localWorkspace?.repoRootId
        ? repoRootsById.get(entry.localWorkspace.repoRootId) ?? null
        : entry.localWorkspace?.gitProvider && entry.localWorkspace.gitOwner && entry.localWorkspace.gitRepoName
          ? repoRootsByRemoteKey.get(
            `${entry.localWorkspace.gitProvider}:${entry.localWorkspace.gitOwner}:${entry.localWorkspace.gitRepoName}`,
          ) ?? null
          : entry.cloudWorkspace
            ? repoRootsByRemoteKey.get(
              `${entry.cloudWorkspace.repo.provider}:${entry.cloudWorkspace.repo.owner}:${entry.cloudWorkspace.repo.name}`,
            ) ?? null
            : entry.mobilityWorkspace
              ? repoRootsByRemoteKey.get(
                `${entry.mobilityWorkspace.repo.provider}:${entry.mobilityWorkspace.repo.owner}:${entry.mobilityWorkspace.repo.name}`,
              ) ?? null
              : null;
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
          entry.localWorkspace?.gitProvider
          ?? entry.cloudWorkspace?.repo.provider
          ?? entry.mobilityWorkspace?.repo.provider
          ?? null,
        owner:
          entry.localWorkspace?.gitOwner
          ?? entry.cloudWorkspace?.repo.owner
          ?? entry.mobilityWorkspace?.repo.owner
          ?? null,
        repoName:
          entry.localWorkspace?.gitRepoName
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
        effectiveOwner: entry.mobilityWorkspace?.owner === "cloud" ? "cloud" : materialization.owner,
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
