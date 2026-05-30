import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { cloudWorkspaceUsesCloudRuntime } from "@/lib/domain/workspaces/cloud/cloud-runtime-kind";
import { isCloudWorkspaceFailedBeforeReady } from "@/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  humanizeBranchName,
  workspaceCurrentBranchName,
} from "@/lib/domain/workspaces/creation/branch-naming";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
  repoRootGroupKey,
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

function remoteRepoKey(
  provider: string | null | undefined,
  owner: string | null | undefined,
  repoName: string | null | undefined,
): string | null {
  if (!provider || !owner || !repoName) {
    return null;
  }

  return `${provider.trim()}:${owner.trim()}:${repoName.trim()}`;
}

function resolveLocalWorkspaceRepoRoot(
  workspace: Workspace,
  repoRootsById: Map<string, RepoRoot>,
  repoRootsByRemoteKey: Map<string, RepoRoot>,
): RepoRoot | null {
  if (workspace.repoRootId) {
    const repoRoot = repoRootsById.get(workspace.repoRootId);
    if (repoRoot) {
      return repoRoot;
    }
  }

  const workspaceRemoteKey = remoteRepoKey(
    workspace.gitProvider,
    workspace.gitOwner,
    workspace.gitRepoName,
  );
  return workspaceRemoteKey ? repoRootsByRemoteKey.get(workspaceRemoteKey) ?? null : null;
}

function buildBaseLogicalWorkspaceIdForLocalWorkspace(
  workspace: Workspace,
  repoRoot: RepoRoot | null,
): string {
  if (repoRoot?.remoteProvider && repoRoot.remoteOwner && repoRoot.remoteRepoName) {
    return buildRemoteLogicalWorkspaceId(
      repoRoot.remoteProvider,
      repoRoot.remoteOwner,
      repoRoot.remoteRepoName,
      workspaceBranchKey(workspace),
    );
  }

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

function cloudWorkspaceMatchesSelection(
  workspace: CloudWorkspaceSummary,
  logicalId: string,
  currentSelectionId: string | null | undefined,
): boolean {
  return currentSelectionId === logicalId
    || currentSelectionId === cloudWorkspaceSyntheticId(workspace.id);
}

function cloudWorkspaceSelectedByMaterialization(
  workspace: CloudWorkspaceSummary,
  currentSelectionId: string | null | undefined,
): boolean {
  return currentSelectionId === cloudWorkspaceSyntheticId(workspace.id);
}

function cloudWorkspaceIsArchived(workspace: CloudWorkspaceSummary): boolean {
  return workspace.productLifecycle === "archived"
    || workspace.status === "archived"
    || workspace.workspaceStatus === "archived";
}

function cloudWorkspaceTimestamp(workspace: CloudWorkspaceSummary): number {
  return new Date(workspace.updatedAt ?? workspace.createdAt ?? "").getTime() || 0;
}

function preferCloudWorkspaceForLogicalSlot(
  current: CloudWorkspaceSummary | null,
  candidate: CloudWorkspaceSummary,
  currentSelectionId: string | null | undefined,
): CloudWorkspaceSummary {
  if (!current) {
    return candidate;
  }

  const candidateSelected = cloudWorkspaceSelectedByMaterialization(candidate, currentSelectionId);
  const currentSelected = cloudWorkspaceSelectedByMaterialization(current, currentSelectionId);
  if (candidateSelected !== currentSelected) {
    return candidateSelected ? candidate : current;
  }

  const candidateArchived = cloudWorkspaceIsArchived(candidate);
  const currentArchived = cloudWorkspaceIsArchived(current);
  if (candidateArchived !== currentArchived) {
    return candidateArchived ? current : candidate;
  }

  return cloudWorkspaceTimestamp(candidate) >= cloudWorkspaceTimestamp(current)
    ? candidate
    : current;
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
    || mobilityLifecycle === "shared_cloud_active"
    || mobilityLifecycle === "ssh_active"
    || mobilityLifecycle === "moving_to_local"
    || mobilityLifecycle === "handoff_failed"
    || mobilityLifecycle === "cleanup_failed"
    || mobilityLifecycle === "repair_required"
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

function effectiveOwnerFromMobilityOwner(
  owner: string | null | undefined,
): "local" | "cloud" | null {
  switch (owner) {
    case "local":
      return "local";
    case "cloud":
    case "personal_cloud":
    case "shared_cloud":
    case "ssh":
      return "cloud";
    default:
      return null;
  }
}

function effectiveOwnerHintForWorkspace(
  mobilityOwner: string | null | undefined,
  cloudWorkspace: CloudWorkspaceSummary | null,
): "local" | "cloud" | null {
  if (cloudWorkspace && !cloudWorkspaceUsesCloudRuntime(cloudWorkspace)) {
    return null;
  }
  return effectiveOwnerFromMobilityOwner(mobilityOwner);
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
