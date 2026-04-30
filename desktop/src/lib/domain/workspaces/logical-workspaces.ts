import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudMobilityWorkspaceSummary,
  CloudWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import { humanizeBranchName } from "@/lib/domain/workspaces/branch-naming";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
} from "@/lib/domain/workspaces/collections";
import { workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";

function encodeLogicalSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeLogicalSegment(value: string): string {
  return decodeURIComponent(value);
}

function normalizeBranchKey(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "HEAD";
}

export type LogicalWorkspaceIdKind = "remote" | "repo-root" | "path";

export interface ParsedLogicalWorkspaceId {
  kind: LogicalWorkspaceIdKind;
  segments: string[];
}

export interface LogicalWorkspace {
  id: string;
  repoKey: string;
  sourceRoot: string;
  repoRoot: RepoRoot | null;
  provider: string | null;
  owner: string | null;
  repoName: string | null;
  branchKey: string;
  displayName: string;
  localWorkspace: Workspace | null;
  cloudWorkspace: CloudWorkspaceSummary | null;
  mobilityWorkspace: CloudMobilityWorkspaceSummary | null;
  preferredMaterializationId: string | null;
  effectiveOwner: "local" | "cloud";
  lifecycle:
    | "local_active"
    | "moving_to_cloud"
    | "cloud_active"
    | "moving_to_local"
    | "handoff_failed"
    | "cleanup_failed"
    | "cloud_lost";
  updatedAt: string;
}

export function buildRemoteLogicalWorkspaceId(
  provider: string,
  owner: string,
  repo: string,
  branchKey: string,
): string {
  return [
    "remote",
    encodeLogicalSegment(provider),
    encodeLogicalSegment(owner),
    encodeLogicalSegment(repo),
    encodeLogicalSegment(branchKey),
  ].join(":");
}

export function buildRepoRootLogicalWorkspaceId(
  repoRootId: string,
  branchKey: string,
): string {
  return [
    "repo-root",
    encodeLogicalSegment(repoRootId),
    encodeLogicalSegment(branchKey),
  ].join(":");
}

export function buildPathLogicalWorkspaceId(
  path: string,
  branchKey: string,
): string {
  return [
    "path",
    encodeLogicalSegment(path),
    encodeLogicalSegment(branchKey),
  ].join(":");
}

export function parseLogicalWorkspaceId(
  logicalWorkspaceId: string | null | undefined,
): ParsedLogicalWorkspaceId | null {
  if (!logicalWorkspaceId) {
    return null;
  }

  const [kind, ...encodedSegments] = logicalWorkspaceId.split(":");
  if (kind !== "remote" && kind !== "repo-root" && kind !== "path") {
    return null;
  }

  return {
    kind,
    segments: encodedSegments.map(decodeLogicalSegment),
  };
}

export function replaceLogicalWorkspaceBranch(
  logicalWorkspaceId: string | null | undefined,
  branchKey: string,
): string | null {
  const parsed = parseLogicalWorkspaceId(logicalWorkspaceId);
  if (!parsed) {
    return null;
  }

  const nextBranchKey = normalizeBranchKey(branchKey);
  if (parsed.kind === "remote" && parsed.segments.length === 4) {
    const [provider, owner, repo] = parsed.segments;
    return buildRemoteLogicalWorkspaceId(provider!, owner!, repo!, nextBranchKey);
  }

  if (parsed.kind === "repo-root" && parsed.segments.length === 2) {
    return buildRepoRootLogicalWorkspaceId(parsed.segments[0]!, nextBranchKey);
  }

  if (parsed.kind === "path" && parsed.segments.length === 2) {
    return buildPathLogicalWorkspaceId(parsed.segments[0]!, nextBranchKey);
  }

  return null;
}

function workspaceBranchKey(workspace: Workspace): string {
  return normalizeBranchKey(workspace.currentBranch ?? workspace.originalBranch ?? null);
}

function cloudBranchKey(workspace: CloudWorkspaceSummary): string {
  return normalizeBranchKey(workspace.repo.branch);
}

function buildLogicalWorkspaceIdForLocalWorkspace(workspace: Workspace): string {
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

function preferredMaterializationId(
  localWorkspace: Workspace | null,
  cloudWorkspace: CloudWorkspaceSummary | null,
  mobilityWorkspace: CloudMobilityWorkspaceSummary | null,
  currentSelectionId: string | null,
  effectiveOwnerHint: "local" | "cloud" | null,
): { workspaceId: string | null; owner: "local" | "cloud" } {
  if (localWorkspace && currentSelectionId === localWorkspace.id) {
    return { workspaceId: localWorkspace.id, owner: "local" };
  }

  const cloudId = cloudWorkspace
    ? cloudWorkspaceSyntheticId(cloudWorkspace.id)
    : mobilityWorkspace?.cloudWorkspaceId
      ? cloudWorkspaceSyntheticId(mobilityWorkspace.cloudWorkspaceId)
      : null;
  if (cloudId) {
    if (currentSelectionId === cloudId) {
      return { workspaceId: cloudId, owner: "cloud" };
    }
  }

  if (effectiveOwnerHint === "cloud" && cloudId) {
    return {
      workspaceId: cloudId,
      owner: "cloud",
    };
  }

  if (localWorkspace) {
    return { workspaceId: localWorkspace.id, owner: "local" };
  }

  return {
    workspaceId: cloudId,
    owner: "cloud",
  };
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

  for (const workspace of args.localWorkspaces) {
    const logicalId = buildLogicalWorkspaceIdForLocalWorkspace(workspace);
    const current = byId.get(logicalId);
    if (!current) {
      byId.set(logicalId, {
        localWorkspace: workspace,
        cloudWorkspace: null,
        mobilityWorkspace: null,
      });
      continue;
    }

    if (!current.localWorkspace) {
      current.localWorkspace = workspace;
      continue;
    }

    if (new Date(workspace.updatedAt).getTime() > new Date(current.localWorkspace.updatedAt).getTime()) {
      current.localWorkspace = workspace;
    }
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
      normalizeBranchKey(workspace.repo.branch),
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
      const materialization = preferredMaterializationId(
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
          : entry.mobilityWorkspace?.displayName?.trim()
            ? entry.mobilityWorkspace.displayName.trim()
          : id;

      return {
        id,
        repoKey,
        sourceRoot,
        repoRoot,
        provider: entry.localWorkspace?.gitProvider ?? entry.cloudWorkspace?.repo.provider ?? null,
        owner: entry.localWorkspace?.gitOwner ?? entry.cloudWorkspace?.repo.owner ?? null,
        repoName: entry.localWorkspace?.gitRepoName ?? entry.cloudWorkspace?.repo.name ?? null,
        branchKey: entry.localWorkspace
          ? workspaceBranchKey(entry.localWorkspace)
          : entry.cloudWorkspace
            ? cloudBranchKey(entry.cloudWorkspace)
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

export function logicalWorkspaceMatchesId(
  workspace: LogicalWorkspace,
  candidateId: string | null | undefined,
): boolean {
  if (!candidateId) {
    return false;
  }

  return candidateId === workspace.id
    || candidateId === workspace.localWorkspace?.id
    || candidateId === logicalWorkspaceCloudMaterializationId(workspace);
}

export function findLogicalWorkspace(
  workspaces: readonly LogicalWorkspace[],
  candidateId: string | null | undefined,
): LogicalWorkspace | null {
  if (!candidateId) {
    return null;
  }

  return workspaces.find((workspace) => logicalWorkspaceMatchesId(workspace, candidateId)) ?? null;
}

export function resolveLogicalWorkspaceMaterializationId(
  workspace: LogicalWorkspace,
  currentSelectionId?: string | null,
): string | null {
  const selected = preferredMaterializationId(
    workspace.localWorkspace,
    workspace.cloudWorkspace,
    workspace.mobilityWorkspace,
    currentSelectionId ?? null,
    workspace.mobilityWorkspace?.owner === "local" || workspace.mobilityWorkspace?.owner === "cloud"
      ? workspace.mobilityWorkspace.owner
      : null,
  );
  return selected.workspaceId;
}

export function logicalWorkspaceCloudMaterializationId(
  workspace: Pick<LogicalWorkspace, "cloudWorkspace" | "mobilityWorkspace">,
): string | null {
  if (workspace.cloudWorkspace) {
    return cloudWorkspaceSyntheticId(workspace.cloudWorkspace.id);
  }
  if (workspace.mobilityWorkspace?.cloudWorkspaceId) {
    return cloudWorkspaceSyntheticId(workspace.mobilityWorkspace.cloudWorkspaceId);
  }
  return null;
}
