import type { Workspace } from "@anyharness/sdk";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
} from "@/lib/domain/workspaces/cloud/collections";
import {
  humanizeBranchName,
  workspaceCurrentBranchName,
} from "@/lib/domain/workspaces/creation/branch-naming";
import { workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import type { SidebarCloudWorkspaceSummary } from "@/lib/domain/workspaces/sidebar/cloud-workspace";
import type {
  CloudSidebarWorkspaceEntry,
  SidebarEntryGitMetadata,
  SidebarRepoGroupEntry,
  SidebarWorkspaceEntry,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";

export function buildSidebarWorkspaceEntries(
  localWorkspaces: Workspace[],
  cloudWorkspaces: SidebarCloudWorkspaceSummary[],
): SidebarWorkspaceEntry[] {
  const entries: SidebarWorkspaceEntry[] = [
    ...localWorkspaces.map((workspace) => ({
      source: "local" as const,
      id: workspace.id,
      repoKey: localWorkspaceGroupKey(workspace),
      workspace,
    })),
    ...cloudWorkspaces.map((workspace) => ({
      source: "cloud" as const,
      id: cloudWorkspaceSyntheticId(workspace.id),
      cloudWorkspaceId: workspace.id,
      repoKey: cloudWorkspaceGroupKey(workspace),
      workspace,
    })),
  ];

  return entries.sort((a, b) => {
    const aTime = new Date(sidebarEntryUpdatedAt(a)).getTime();
    const bTime = new Date(sidebarEntryUpdatedAt(b)).getTime();
    return bTime - aTime;
  });
}

export function groupSidebarEntries(
  entries: SidebarWorkspaceEntry[],
): SidebarRepoGroupEntry[] {
  const groups = new Map<string, SidebarRepoGroupEntry>();

  for (const entry of entries) {
    if (!groups.has(entry.repoKey)) {
      groups.set(entry.repoKey, {
        repoKey: entry.repoKey,
        name: sidebarEntryGroupName(entry),
        entries: [],
      });
    }

    groups.get(entry.repoKey)!.entries.push(entry);
  }

  return Array.from(groups.values());
}

export function sidebarEntryDisplayName(entry: SidebarWorkspaceEntry): string {
  if (entry.source === "cloud") {
    const override = entry.workspace.displayName?.trim();
    if (override) {
      return override;
    }
    return cloudSidebarEntryDefaultDisplayName(entry);
  }

  return workspaceDisplayName(entry.workspace);
}

export function cloudSidebarEntryDefaultDisplayName(
  entry: CloudSidebarWorkspaceEntry,
): string {
  return entry.workspace.repo.branch?.trim()
    ? humanizeBranchName(entry.workspace.repo.branch)
    : entry.workspace.repo.name;
}

export function sidebarEntryUpdatedAt(entry: SidebarWorkspaceEntry): string {
  if (entry.source === "cloud") {
    return entry.workspace.updatedAt ?? entry.workspace.createdAt ?? "";
  }

  return entry.workspace.updatedAt;
}

export function sidebarEntryGitMetadata(
  entry: SidebarWorkspaceEntry,
): SidebarEntryGitMetadata {
  if (entry.source === "cloud") {
    return {
      provider: entry.workspace.repo.provider,
      owner: entry.workspace.repo.owner,
      repoName: entry.workspace.repo.name,
      branchName: entry.workspace.repo.branch,
    };
  }

  return {
    provider: null,
    owner: null,
    repoName: null,
    branchName: workspaceCurrentBranchName(entry.workspace),
  };
}

export function sidebarEntryIsBranchBacked(entry: SidebarWorkspaceEntry): boolean {
  return entry.source === "cloud" || entry.workspace.kind === "worktree";
}

export function sidebarEntryIsCloud(
  entry: SidebarWorkspaceEntry,
): entry is CloudSidebarWorkspaceEntry {
  return entry.source === "cloud";
}

function sidebarEntryGroupName(entry: SidebarWorkspaceEntry): string {
  if (entry.source === "cloud") {
    return entry.workspace.repo.name;
  }

  return entry.workspace.path.split("/").filter(Boolean).pop()
    ?? entry.workspace.path;
}
