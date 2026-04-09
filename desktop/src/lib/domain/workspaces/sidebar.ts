import type { GitStatusSnapshot, Workspace } from "@anyharness/sdk";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import { resolveWorkspaceExecutionViewState } from "@/lib/domain/sessions/activity";
import type { NewCloudWorkspaceSeed } from "@/lib/domain/workspaces/cloud-workspace-creation";
import { isCloudWorkspacePending } from "@/lib/domain/workspaces/cloud-workspace-status";
import type {
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import {
  humanizeBranchName,
  workspaceCurrentBranchName,
} from "@/lib/domain/workspaces/branch-naming";
import {
  workspaceDefaultDisplayName,
  workspaceDisplayName,
} from "@/lib/domain/workspaces/workspace-display";
import { cloudWorkspaceSyntheticId } from "./cloud-ids";
import {
  cloudWorkspaceGroupKey,
  localWorkspaceGroupKey,
} from "./collections";

export interface LocalSidebarWorkspaceEntry {
  source: "local";
  id: string;
  repoKey: string;
  workspace: Workspace;
}

export interface CloudSidebarWorkspaceEntry {
  source: "cloud";
  id: string;
  cloudWorkspaceId: string;
  repoKey: string;
  workspace: CloudWorkspaceSummary;
}

export type SidebarWorkspaceEntry =
  | LocalSidebarWorkspaceEntry
  | CloudSidebarWorkspaceEntry;

export interface SidebarRepoGroupEntry {
  repoKey: string;
  name: string;
  entries: SidebarWorkspaceEntry[];
}

export interface SidebarEntryGitMetadata {
  provider: string | null;
  owner: string | null;
  repoName: string | null;
  branchName: string | null;
}

export type SidebarWorkspaceVariant = "local" | "worktree" | "cloud";

export interface SidebarWorkspaceItemState {
  id: string;
  name: string;
  /**
   * The label we would render if the user had not set a display name override.
   * Used as the input placeholder in the rename popover. Equal to `name`
   * when no override is set.
   */
  defaultName: string;
  /**
   * Whether the local workspace has a user-set display name override. Cloud
   * entries are always `false` (cloud renaming uses a separate flow).
   */
  hasDisplayNameOverride: boolean;
  /**
   * Whether this entry supports renaming via the AnyHarness display name
   * override. False for cloud entries (handled separately).
   */
  renameSupported: boolean;
  subtitle: string | null;
  active: boolean;
  archived: boolean;
  activity: SessionViewState;
  variant: SidebarWorkspaceVariant;
  cloudStatus: CloudWorkspaceStatus | null;
  additions: number | undefined;
  deletions: number | undefined;
  lastInteracted: string | null;
  unread: boolean;
}

export interface SidebarGroupState {
  sourceRoot: string;
  name: string;
  items: SidebarWorkspaceItemState[];
  repoWorkspaceId: string | null;
  localSourceRoot: string | null;
  cloudDialogState: NewCloudWorkspaceSeed | null;
}

interface WorkspaceUnreadInput {
  isActive: boolean;
  isArchived: boolean;
  lastInteracted: string | null | undefined;
  lastViewedAt: string | null | undefined;
}

export function buildSidebarWorkspaceEntries(
  localWorkspaces: Workspace[],
  cloudWorkspaces: CloudWorkspaceSummary[],
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
    return cloudEntryDefaultDisplayName(entry);
  }

  return workspaceDisplayName(entry.workspace);
}

function cloudEntryDefaultDisplayName(entry: CloudSidebarWorkspaceEntry): string {
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
    provider: entry.workspace.gitProvider ?? null,
    owner: entry.workspace.gitOwner ?? null,
    repoName: entry.workspace.gitRepoName ?? null,
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

export function isWorkspaceUnread({
  isActive,
  isArchived,
  lastInteracted,
  lastViewedAt,
}: WorkspaceUnreadInput): boolean {
  if (isActive || isArchived || !lastInteracted) {
    return false;
  }

  return !lastViewedAt
    || new Date(lastInteracted).getTime() > new Date(lastViewedAt).getTime();
}

export function buildSidebarGroupStates(args: {
  sidebarEntries: SidebarWorkspaceEntry[];
  showArchived: boolean;
  archivedSet: Set<string>;
  selectedWorkspaceId: string | null;
  workspaceActivities: Record<string, SessionViewState>;
  gitStatus: GitStatusSnapshot | undefined;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
}): SidebarGroupState[] {
  return groupSidebarEntries(args.sidebarEntries)
    .map((group): SidebarGroupState | null => {
      const visibleEntries = group.entries.filter(
        (entry) =>
          (args.showArchived || !args.archivedSet.has(entry.id))
          && !(entry.source === "local" && entry.workspace.kind === "repo"),
      );
      if (
        visibleEntries.length === 0
        && group.entries.every((entry) => args.archivedSet.has(entry.id))
      ) {
        return null;
      }

      const cloudWorkspaceSource = group.entries.find((entry) => {
        const gitMetadata = sidebarEntryGitMetadata(entry);
        return gitMetadata.provider === "github"
          && !!gitMetadata.owner
          && !!gitMetadata.repoName;
      });
      const selectedGroupWorkspace = group.entries.find(
        (entry): entry is LocalSidebarWorkspaceEntry =>
          entry.source === "local" && entry.id === args.selectedWorkspaceId,
      );
      const cloudWorkspaceSourceGitMetadata = cloudWorkspaceSource
        ? sidebarEntryGitMetadata(cloudWorkspaceSource)
        : null;

      return {
        sourceRoot: group.repoKey,
        name: group.name,
        repoWorkspaceId:
          group.entries.find(
            (entry) => entry.source === "local" && entry.workspace.kind === "repo",
          )?.id ?? null,
        localSourceRoot:
          group.entries.find((entry) => entry.source === "local")
            ?.workspace.sourceRepoRootPath ?? null,
        cloudDialogState:
          cloudWorkspaceSourceGitMetadata?.owner && cloudWorkspaceSourceGitMetadata.repoName
            ? {
              gitOwner: cloudWorkspaceSourceGitMetadata.owner,
              gitRepoName: cloudWorkspaceSourceGitMetadata.repoName,
              prefillBranchName:
                selectedGroupWorkspace?.workspace.kind === "worktree"
                  ? selectedGroupWorkspace.workspace.currentBranch
                    ?? selectedGroupWorkspace.workspace.originalBranch
                    ?? undefined
                  : undefined,
            }
            : null,
        items: visibleEntries.map((entry) => {
          const archived = args.archivedSet.has(entry.id);
          const active = entry.id === args.selectedWorkspaceId;
          const lastInteracted = args.workspaceLastInteracted[entry.id] ?? null;
          const isCloudEntry = sidebarEntryIsCloud(entry);
          const activity = isCloudEntry
            ? (isCloudWorkspacePending(entry.workspace.status) ? "working" : "idle")
            : args.workspaceActivities[entry.id]
              ?? resolveWorkspaceExecutionViewState(entry.workspace.executionSummary ?? null);

          const variant: SidebarWorkspaceVariant = isCloudEntry
            ? "cloud"
            : entry.workspace.kind === "worktree"
              ? "worktree"
              : "local";
          const displayNameOverride = entry.source === "local"
            ? entry.workspace.displayName?.trim() || null
            : entry.workspace.displayName?.trim() || null;
          const defaultName = entry.source === "local"
            ? (
              active && sidebarEntryIsBranchBacked(entry) && args.gitStatus?.currentBranch
                ? humanizeBranchName(args.gitStatus.currentBranch)
                : workspaceDefaultDisplayName(entry.workspace)
            )
            : cloudEntryDefaultDisplayName(entry);

          return {
            id: entry.id,
            name: displayNameOverride ?? defaultName,
            defaultName,
            hasDisplayNameOverride: displayNameOverride !== null,
            renameSupported: true,
            subtitle: active ? args.activeSessionTitle : null,
            active,
            archived,
            activity,
            variant,
            cloudStatus: isCloudEntry
              ? entry.workspace.status as CloudWorkspaceStatus
              : null,
            additions: active ? args.gitStatus?.summary.additions : undefined,
            deletions: active ? args.gitStatus?.summary.deletions : undefined,
            lastInteracted,
            unread: isWorkspaceUnread({
              isActive: active,
              isArchived: archived,
              lastInteracted,
              lastViewedAt: args.lastViewedAt[entry.id],
            }),
          };
        }),
      };
    })
    .filter((group): group is SidebarGroupState => group !== null);
}

function sidebarEntryGroupName(entry: SidebarWorkspaceEntry): string {
  if (entry.source === "cloud") {
    return entry.workspace.repo.name;
  }

  return entry.workspace.gitRepoName
    ?? entry.workspace.sourceRepoRootPath.split("/").pop()
    ?? entry.workspace.sourceRepoRootPath;
}
