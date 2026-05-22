import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceRepoTarget } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import type {
  SidebarCloudWorkspaceStatus,
  SidebarCloudWorkspaceSummary,
} from "@/lib/domain/workspaces/sidebar/cloud-workspace";
import type {
  SidebarDetailIndicator,
  SidebarStatusIndicator,
  SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

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
  workspace: SidebarCloudWorkspaceSummary;
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
  cloudStatus: SidebarCloudWorkspaceStatus | null;
  lastInteracted: string | null;
  needsReview: boolean;
  workspaceLocationCopyLabel: string | null;
  workspaceLocationCopyValue: string | null;
  workspaceLocationCopyToastLabel: string | null;
  branchName: string | null;
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
