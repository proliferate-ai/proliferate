import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceSummary,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { isCloudWorkspaceFailedBeforeReady } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
  repoRootGroupKey,
} from "#product/lib/domain/workspaces/cloud/collections";
import {
  buildCloudIdentityLogicalWorkspaceId,
  buildLocalSlotLogicalWorkspaceId,
  buildRemoteLogicalWorkspaceId,
  normalizeLogicalWorkspaceBranchKey,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  cloudWorkspaceHasMaterializations,
  explicitLocalMaterializationAnyharnessId,
  resolvePreferredLogicalWorkspaceMaterialization,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-materialization";
import { collapseExactLocalWorkspaceDuplicates } from "#product/lib/domain/workspaces/cloud/logical-workspace-duplicates";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  buildBaseLogicalWorkspaceIdForLocalWorkspace,
  buildLogicalWorkspaceIdForCloudWorkspace,
  cloudBranchKey,
  compareLocalWorkspaceCanonicalOrder,
  remoteRepoKey,
  resolveLocalWorkspaceRepoRoot,
  workspaceBranchKey,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-source";
import {
  cloudDefaultDisplayName,
  cloudWorkspaceMatchesSelection,
  effectiveOwnerHintForWorkspace,
  inferLifecycle,
  latestUpdatedAt,
  localDefaultDisplayName,
  mobilityDefaultDisplayName,
  preferCloudWorkspaceForLogicalSlot,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-slot";

export function buildLogicalWorkspaces(args: {
  localWorkspaces: Workspace[];
  repoRoots: RepoRoot[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  cloudMobilityWorkspaces?: CloudMobilityWorkspaceSummary[];
  currentSelectionId?: string | null;
  /** This desktop install's id. When present, a Cloud workspace with an
   * explicit healthy local materialization for this install merges with that
   * exact local workspace by id — never by repository/branch heuristic. */
  desktopInstallId?: string | null;
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

  // Map every placed local workspace's AnyHarness id to its logical slot id so a
  // Cloud workspace with an explicit local materialization can attach to the
  // exact same local slot the server linked — never by branch heuristic.
  const localLogicalIdByAnyharnessId = new Map<string, string>();
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
        mobilityWorkspace: null,
        aliasIds: collapsed.aliasIds,
      });
      localLogicalIdByAnyharnessId.set(workspace.id, logicalId);
    });
  }

  for (const workspace of args.cloudWorkspaces) {
    // Explicit association takes precedence over the repository/branch
    // heuristic whenever the Cloud response carries a materialization ledger.
    // A healthy local materialization for THIS install merges the Cloud record
    // onto that exact local slot; otherwise the Cloud record stands on its own
    // identity-keyed slot (no heuristic attachment to a same-branch local).
    const explicitLocalAnyharnessId = cloudWorkspaceHasMaterializations(workspace)
      ? explicitLocalMaterializationAnyharnessId(workspace, args.desktopInstallId)
      : null;
    const explicitLogicalId = explicitLocalAnyharnessId
      ? localLogicalIdByAnyharnessId.get(explicitLocalAnyharnessId) ?? null
      : null;

    const logicalId = explicitLogicalId
      ?? (cloudWorkspaceHasMaterializations(workspace)
        ? buildCloudIdentityLogicalWorkspaceId(workspace.id)
        : buildLogicalWorkspaceIdForCloudWorkspace(workspace));

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
        aliasIds: [],
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
              entry.cloudWorkspace.repo?.provider,
              entry.cloudWorkspace.repo?.owner,
              entry.cloudWorkspace.repo?.name,
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
      const sourceRoot = repoRoot?.path
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
          ?? entry.cloudWorkspace?.repo?.provider
          ?? entry.mobilityWorkspace?.repo.provider
          ?? null,
        owner:
          repoRoot?.remoteOwner
          ?? entry.cloudWorkspace?.repo?.owner
          ?? entry.mobilityWorkspace?.repo.owner
          ?? null,
        repoName:
          repoRoot?.remoteRepoName
          ?? entry.cloudWorkspace?.repo?.name
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
        aliasIds: entry.aliasIds,
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
