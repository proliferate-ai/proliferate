import type { RepoRoot } from "@anyharness/sdk";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { repoRootGroupKey } from "@/lib/domain/workspaces/cloud/collections";
import {
  buildPendingWorkspaceUiKey,
  isPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import type { LogicalWorkspaceRecency } from "@/lib/domain/workspaces/sidebar/recency";
import type {
  SidebarDetailIndicator,
  SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { SidebarGroupState } from "@/lib/domain/workspaces/sidebar/sidebar-model";

export interface PendingSidebarProjection {
  repoKey: string;
  sourceRoot: string;
  repoRoot: RepoRoot | null;
  name: string;
  item: SidebarGroupState["items"][number];
  sortRecency: LogicalWorkspaceRecency;
}

export function buildPendingSidebarProjection(args: {
  entry: PendingWorkspaceEntry;
  repoRootsById: Map<string, RepoRoot>;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  activeSessionTitle: string | null;
}): PendingSidebarProjection | null {
  const { entry, repoRootsById } = args;
  const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
  const materializedSelectedLogicalId =
    entry.workspaceId
    && args.selectedWorkspaceId === entry.workspaceId
    && args.selectedLogicalWorkspaceId
    && !isPendingWorkspaceUiKey(args.selectedLogicalWorkspaceId)
      ? args.selectedLogicalWorkspaceId
      : null;
  const id = materializedSelectedLogicalId ?? pendingWorkspaceUiKey;
  const createdAt = new Date(entry.createdAt).toISOString();
  const variant = pendingSidebarVariant(entry);
  const repoRoot = entry.request.kind === "worktree"
    ? repoRootsById.get(entry.request.input.repoRootId) ?? null
    : null;
  const repoKey = pendingSidebarRepoKey(entry, repoRoot);
  if (!repoKey) {
    return null;
  }

  const active = id === args.selectedLogicalWorkspaceId
    || pendingWorkspaceUiKey === args.selectedLogicalWorkspaceId
    || (!!entry.workspaceId && args.selectedWorkspaceId === entry.workspaceId);
  const sourceRoot = repoRoot?.path
    ?? pendingSidebarSourceRoot(entry)
    ?? repoKey;
  const detailIndicators: SidebarDetailIndicator[] = [{
    kind: "materialization",
    variant,
    tooltip: pendingMaterializationTooltip(variant),
  }];

  return {
    repoKey,
    sourceRoot,
    repoRoot,
    name: entry.repoLabel?.trim()
      || repoRoot?.displayName?.trim()
      || repoRoot?.remoteRepoName?.trim()
      || sourceRoot.split("/").filter(Boolean).pop()
      || sourceRoot,
    item: {
      id,
      localWorkspaceId: null,
      cloudWorkspaceId: pendingSelectExistingCloudWorkspaceId(entry),
      name: entry.displayName,
      defaultName: entry.displayName,
      hasDisplayNameOverride: false,
      renameSupported: false,
      subtitle: active ? args.activeSessionTitle : null,
      active,
      archived: false,
      variant,
      statusIndicator: null,
      detailIndicators,
      cloudStatus: null,
      lastInteracted: createdAt,
      needsReview: false,
      workspaceLocationCopyLabel: null,
      workspaceLocationCopyValue: null,
      workspaceLocationCopyToastLabel: null,
      branchName: null,
      gitStatus: null,
    },
    sortRecency: {
      activityAt: createdAt,
      recordUpdatedAt: createdAt,
      sortAt: createdAt,
      displayAt: null,
    },
  };
}

function pendingSidebarVariant(entry: PendingWorkspaceEntry): SidebarWorkspaceVariant {
  switch (entry.request.kind) {
    case "worktree":
      return "worktree";
    case "cloud":
      return "cloud";
    case "select-existing":
      return pendingSelectExistingCloudWorkspaceId(entry) ? "cloud" : "local";
    case "local":
    case "cowork":
      return "local";
  }
}

function pendingSidebarRepoKey(
  entry: PendingWorkspaceEntry,
  repoRoot: RepoRoot | null,
): string | null {
  if (repoRoot) {
    return repoRootGroupKey(repoRoot);
  }

  switch (entry.request.kind) {
    case "local":
      return entry.request.sourceRoot.trim() || null;
    case "worktree":
      return entry.request.input.repoRootId.trim() || null;
    case "cloud":
      return `${entry.request.input.gitProvider}:${entry.request.input.gitOwner}:${entry.request.input.gitRepoName}`;
    case "cowork":
      return entry.request.input.sourceWorkspaceId?.trim() || null;
    case "select-existing":
      return pendingSelectExistingCloudWorkspaceId(entry)
        ? pendingCloudRepoKeyFromLabel(entry) ?? (entry.request.workspaceId.trim() || null)
        : entry.request.workspaceId.trim() || null;
  }
}

function pendingCloudRepoKeyFromLabel(entry: PendingWorkspaceEntry): string | null {
  const repoLabel = entry.repoLabel?.trim();
  if (!repoLabel) {
    return null;
  }
  const [owner, repoName, ...rest] = repoLabel.split("/");
  if (!owner || !repoName || rest.length > 0) {
    return null;
  }
  return `github:${owner}:${repoName}`;
}

function pendingSelectExistingCloudWorkspaceId(entry: PendingWorkspaceEntry): string | null {
  if (entry.source !== "cloud-created" || entry.request.kind !== "select-existing") {
    return null;
  }
  return parseCloudWorkspaceSyntheticId(entry.request.workspaceId);
}

function pendingCloudRepoKeyOrWorkspaceId(entry: PendingWorkspaceEntry): string | null {
  if (entry.request.kind !== "select-existing" || !pendingSelectExistingCloudWorkspaceId(entry)) {
    return null;
  }
  return pendingCloudRepoKeyFromLabel(entry) ?? (entry.request.workspaceId.trim() || null);
}

function pendingSelectExistingSourceRoot(entry: PendingWorkspaceEntry): string | null {
  if (entry.request.kind !== "select-existing") {
    return null;
  }
  const cloudSourceRoot = pendingCloudRepoKeyOrWorkspaceId(entry);
  if (cloudSourceRoot) {
    return cloudSourceRoot;
  }
  return null;
}

function pendingExistingWorkspaceKey(entry: PendingWorkspaceEntry): string | null {
  switch (entry.request.kind) {
    case "select-existing":
      return entry.request.workspaceId.trim() || null;
    case "local":
    case "worktree":
    case "cloud":
    case "cowork":
      return null;
  }
}

function pendingSidebarSourceRoot(entry: PendingWorkspaceEntry): string | null {
  switch (entry.request.kind) {
    case "local":
      return entry.request.sourceRoot.trim() || null;
    case "worktree": {
      const targetPath = entry.request.input.targetPath?.trim();
      return targetPath?.split("/").slice(0, -1).join("/") || targetPath || null;
    }
    case "cloud":
      return `${entry.request.input.gitProvider}:${entry.request.input.gitOwner}:${entry.request.input.gitRepoName}`;
    case "cowork":
      return null;
    case "select-existing":
      return pendingSelectExistingSourceRoot(entry) ?? pendingExistingWorkspaceKey(entry);
  }
}

function pendingMaterializationTooltip(variant: SidebarWorkspaceVariant): string {
  switch (variant) {
    case "worktree":
      return "Local worktree";
    case "cloud":
      return "Cloud workspace";
    case "ssh":
      return "SSH target";
    case "local":
      return "Local workspace";
  }
}
