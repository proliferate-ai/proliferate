import type { GitStatusSnapshot, RepoRoot, Workspace } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@/lib/domain/sessions/activity";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud-workspace-creation";
import {
  latestLogicalWorkspaceTimestamp,
  type LogicalWorkspace,
} from "@/lib/domain/workspaces/logical-workspaces";
import {
  compareLogicalWorkspaceRecency,
  compareResolvedLogicalWorkspaceRecency,
  type LogicalWorkspaceRecency,
  resolveLogicalWorkspaceRecency,
} from "@/lib/domain/workspaces/recency";
import type {
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/access/cloud/client";
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
  repoRootGroupKey,
} from "./collections";
import {
  activeWorkspaceActivity,
  detailIndicatorsForWorkspace,
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
} from "./sidebar-indicators";
import type {
  SidebarDetailIndicator,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "./sidebar-indicators";

export {
  sidebarStatusIndicatorFromActivity,
  sidebarWorkspaceVariantForLogicalWorkspace,
} from "./sidebar-indicators";
export type {
  SidebarDetailIndicator,
  SidebarIndicatorAction,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "./sidebar-indicators";

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

export type SidebarEmptyState = "noWorkspaces" | "filteredOut" | null;

export const DEFAULT_SIDEBAR_WORKSPACE_TYPES: SidebarWorkspaceVariant[] = [
  "local",
  "worktree",
  "cloud",
];
export const SIDEBAR_REPO_GROUP_ITEM_LIMIT = 6;

export interface SidebarWorkspaceItemState {
  id: string;
  localWorkspaceId: string | null;
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
  variant: SidebarWorkspaceVariant;
  statusIndicator: SidebarStatusIndicator | null;
  detailIndicators: SidebarDetailIndicator[];
  cloudStatus: CloudWorkspaceStatus | null;
  lastInteracted: string | null;
  needsReview: boolean;
}

export interface SidebarGroupState {
  sourceRoot: string;
  name: string;
  items: SidebarWorkspaceItemState[];
  allLogicalWorkspaceIds: string[];
  repoRootId: string | null;
  localSourceRoot: string | null;
  cloudRepoTarget: CloudWorkspaceRepoTarget | null;
}

function logicalGroupName(workspace: LogicalWorkspace): string {
  return workspace.repoName
    ?? workspace.sourceRoot.split("/").filter(Boolean).pop()
    ?? workspace.sourceRoot;
}

interface WorkspaceNeedsReviewInput {
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

export function isWorkspaceNeedsReview({
  isArchived,
  lastInteracted,
  lastViewedAt,
}: WorkspaceNeedsReviewInput): boolean {
  if (isArchived || !lastInteracted) {
    return false;
  }

  return !lastViewedAt
    || new Date(lastInteracted).getTime() > new Date(lastViewedAt).getTime();
}

export function normalizeSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
): SidebarWorkspaceVariant[] {
  const typeSet = new Set<SidebarWorkspaceVariant>(workspaceTypes);
  return DEFAULT_SIDEBAR_WORKSPACE_TYPES.filter((type) => typeSet.has(type));
}

export function resolveSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[] | null | undefined,
): SidebarWorkspaceVariant[] {
  const normalized = normalizeSidebarWorkspaceTypes(workspaceTypes ?? []);
  return normalized.length > 0 ? normalized : DEFAULT_SIDEBAR_WORKSPACE_TYPES;
}

export function isDefaultSidebarWorkspaceTypes(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
): boolean {
  return resolveSidebarWorkspaceTypes(workspaceTypes).length === DEFAULT_SIDEBAR_WORKSPACE_TYPES.length;
}

export function toggleSidebarWorkspaceTypeSelection(
  workspaceTypes: readonly SidebarWorkspaceVariant[],
  type: SidebarWorkspaceVariant,
): SidebarWorkspaceVariant[] {
  const normalized = resolveSidebarWorkspaceTypes(workspaceTypes);
  if (normalized.includes(type)) {
    return normalized.length === 1
      ? normalized
      : normalized.filter((selectedType) => selectedType !== type);
  }

  return normalizeSidebarWorkspaceTypes([...normalized, type]);
}

export function resolveAutoShowMoreRepoKey(args: {
  groups: SidebarGroupState[];
  selectedLogicalWorkspaceId: string | null;
  itemLimit: number;
}): string | null {
  const {
    groups,
    selectedLogicalWorkspaceId,
    itemLimit,
  } = args;

  if (!selectedLogicalWorkspaceId) {
    return null;
  }

  for (const group of groups) {
    if (group.items.length <= itemLimit) continue;
    const selectedIndex = group.items.findIndex((item) => item.id === selectedLogicalWorkspaceId);
    if (selectedIndex >= itemLimit) {
      return group.sourceRoot;
    }
  }

  return null;
}

export function resolveSidebarEmptyState(
  logicalWorkspaceCount: number,
  groupCount: number,
): SidebarEmptyState {
  if (groupCount > 0) {
    return null;
  }

  if (logicalWorkspaceCount === 0) {
    return "noWorkspaces";
  }

  return "filteredOut";
}

export function buildSidebarGroupStates(args: {
  repoRoots: RepoRoot[];
  logicalWorkspaces: LogicalWorkspace[];
  showArchived: boolean;
  workspaceTypes: SidebarWorkspaceVariant[];
  archivedSet: Set<string>;
  hiddenRepoRootIds: Set<string>;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  workspaceActivities: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  gitStatus: GitStatusSnapshot | undefined;
  activeSessionTitle: string | null;
  lastViewedAt: Record<string, string>;
  workspaceLastInteracted: Record<string, string>;
  finishSuggestionsByWorkspaceId?: Record<string, { workspaceId: string; readinessFingerprint: string }>;
}): SidebarGroupState[] {
  const visibleWorkspaceTypes = new Set(resolveSidebarWorkspaceTypes(args.workspaceTypes));
  const repoRootsByKey = new Map(
    args.repoRoots.map((repoRoot) => [repoRootGroupKey(repoRoot), repoRoot]),
  );
  const groups = new Map<string, LogicalWorkspace[]>();
  for (const workspace of args.logicalWorkspaces) {
    const entries = groups.get(workspace.repoKey);
    if (entries) {
      entries.push(workspace);
    } else {
      groups.set(workspace.repoKey, [workspace]);
    }
  }

  const groupKeys = new Set<string>([
    ...repoRootsByKey.keys(),
    ...groups.keys(),
  ]);

  return Array.from(groupKeys)
    .map((repoKey): { group: SidebarGroupState; sortRecency: LogicalWorkspaceRecency } | null => {
      const rawGroupWorkspaces = groups.get(repoKey) ?? [];
      const groupWorkspaces = groupHasWorkActivity(
        rawGroupWorkspaces,
        args.workspaceLastInteracted,
      )
        ? [...rawGroupWorkspaces].sort((left, right) =>
          compareLogicalWorkspaceRecency(left, right, args.workspaceLastInteracted)
        )
        : rawGroupWorkspaces;
      const representative = groupWorkspaces[0] ?? null;
      const repoRoot = representative?.repoRoot ?? repoRootsByKey.get(repoKey) ?? null;
      if (repoRoot && args.hiddenRepoRootIds.has(repoRoot.id)) {
        return null;
      }
      const items = groupWorkspaces.map((entry) => {
        const active = entry.id === args.selectedLogicalWorkspaceId;
        const archived = args.archivedSet.has(entry.id);
        const recency = resolveLogicalWorkspaceRecency(entry, args.workspaceLastInteracted);
        const lastInteracted = recency.displayAt;
        const preferredLocalWorkspace = entry.localWorkspace;
        const preferredCloudWorkspace = entry.cloudWorkspace;
        const variant = sidebarWorkspaceVariantForLogicalWorkspace(entry);
        const displayNameOverride = preferredLocalWorkspace?.displayName?.trim()
          || preferredCloudWorkspace?.displayName?.trim()
          || null;
        const defaultName = preferredLocalWorkspace
          ? (
            active && args.selectedWorkspaceId === preferredLocalWorkspace.id && args.gitStatus?.currentBranch
              ? humanizeBranchName(args.gitStatus.currentBranch)
              : workspaceDefaultDisplayName(preferredLocalWorkspace)
          )
          : preferredCloudWorkspace
            ? cloudEntryDefaultDisplayName({
              source: "cloud",
              id: entry.id,
              cloudWorkspaceId: preferredCloudWorkspace.id,
              repoKey: entry.repoKey,
              workspace: preferredCloudWorkspace,
            })
            : entry.displayName;
        const needsReview = isWorkspaceNeedsReview({
          isArchived: archived,
          lastInteracted,
          lastViewedAt: latestLogicalWorkspaceTimestamp(args.lastViewedAt, entry),
        });
        const activity = activeWorkspaceActivity(entry, args.workspaceActivities);

        return {
          id: entry.id,
          localWorkspaceId: preferredLocalWorkspace?.id ?? null,
          name: displayNameOverride ?? defaultName,
          defaultName,
          hasDisplayNameOverride: displayNameOverride !== null,
          renameSupported: !(entry.localWorkspace && entry.cloudWorkspace),
          subtitle: active ? args.activeSessionTitle : null,
          active,
          archived,
          variant,
          statusIndicator: sidebarStatusIndicatorFromActivity({
            activity,
            needsReview,
            pendingPromptCount: args.pendingPromptCounts?.[entry.id] ?? 0,
            errorAction: { kind: "open_workspace", workspaceId: entry.id },
          }),
          detailIndicators: detailIndicatorsForWorkspace(
            entry,
            variant,
            preferredLocalWorkspace
              ? args.finishSuggestionsByWorkspaceId?.[preferredLocalWorkspace.id] ?? null
              : null,
          ),
          cloudStatus: preferredCloudWorkspace
            ? preferredCloudWorkspace.status as CloudWorkspaceStatus
            : null,
          lastInteracted,
          needsReview,
        };
      });
      const visibleItems = items.filter((item) =>
        item.active
        || ((args.showArchived || !item.archived) && visibleWorkspaceTypes.has(item.variant))
      );
      const archiveHiddenItems = items.filter((item) =>
        !item.active
        && item.archived
        && visibleWorkspaceTypes.has(item.variant)
      );
      if (visibleItems.length === 0 && groupWorkspaces.length > 0) {
        if (!repoRoot || archiveHiddenItems.length === 0) {
          return null;
        }
      }
      const visibleItemIds = new Set(visibleItems.map((item) => item.id));
      const sortRecency = latestVisibleWorkspaceRecency(
        groupWorkspaces,
        visibleItemIds,
        args.workspaceLastInteracted,
      ) ?? {
        activityAt: null,
        recordUpdatedAt: repoRoot?.updatedAt ?? "",
        sortAt: repoRoot?.updatedAt ?? "",
        displayAt: null,
      };

      const sourceRoot = repoRoot?.path
        ?? representative?.sourceRoot
        ?? repoKey;
      const name = repoRoot?.displayName?.trim()
        || repoRoot?.remoteRepoName?.trim()
        || (representative ? logicalGroupName(representative) : sourceRoot.split("/").filter(Boolean).pop())
        || sourceRoot;
      const provider = repoRoot?.remoteProvider ?? representative?.provider ?? null;
      const owner = repoRoot?.remoteOwner ?? representative?.owner ?? null;
      const repoName = repoRoot?.remoteRepoName ?? representative?.repoName ?? null;

      return {
        sortRecency,
        group: {
          sourceRoot,
          name,
          allLogicalWorkspaceIds: groupWorkspaces.map((entry) => entry.id),
          repoRootId:
            repoRoot?.id
            ?? representative?.repoRoot?.id
            ?? null,
          localSourceRoot:
            repoRoot?.path
            ?? groupWorkspaces.find((entry) => entry.localWorkspace)?.localWorkspace?.sourceRepoRootPath
            ?? null,
          cloudRepoTarget:
            provider === "github" && owner && repoName
              ? {
                gitOwner: owner,
                gitRepoName: repoName,
              }
              : null,
          items: visibleItems,
        },
      };
    })
    .filter((entry): entry is { group: SidebarGroupState; sortRecency: LogicalWorkspaceRecency } =>
      entry !== null)
    .sort((a, b) => compareResolvedLogicalWorkspaceRecency(a.sortRecency, b.sortRecency))
    .map((entry) => entry.group);
}

function latestVisibleWorkspaceRecency(
  workspaces: LogicalWorkspace[],
  visibleItemIds: Set<string>,
  workspaceActivityAt: Record<string, string>,
): LogicalWorkspaceRecency | null {
  let latestRecency: LogicalWorkspaceRecency | null = null;
  for (const workspace of workspaces) {
    if (!visibleItemIds.has(workspace.id)) {
      continue;
    }
    const recency = resolveLogicalWorkspaceRecency(workspace, workspaceActivityAt);
    if (!latestRecency || compareResolvedLogicalWorkspaceRecency(recency, latestRecency) < 0) {
      latestRecency = recency;
    }
  }
  return latestRecency;
}

function groupHasWorkActivity(
  workspaces: LogicalWorkspace[],
  workspaceActivityAt: Record<string, string>,
): boolean {
  return workspaces.some((workspace) =>
    resolveLogicalWorkspaceRecency(workspace, workspaceActivityAt).activityAt !== null
  );
}

function sidebarEntryGroupName(entry: SidebarWorkspaceEntry): string {
  if (entry.source === "cloud") {
    return entry.workspace.repo.name;
  }

  return entry.workspace.gitRepoName
    ?? entry.workspace.sourceRepoRootPath?.split("/").pop()
    ?? entry.workspace.sourceRepoRootPath
    ?? entry.workspace.path;
}
