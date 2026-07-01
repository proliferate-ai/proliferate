import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { RepoConfigResponse, RepoEnvironmentResponse } from "@proliferate/cloud-sdk";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import type { SidebarCloudWorkspaceSummary } from "./cloud-workspace";
import {
  buildSidebarGroupStates,
} from "./sidebar-groups";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
} from "./sidebar-model";
import type { SidebarWorkspaceVariant } from "./sidebar-indicators";

const DEFAULT_UPDATED_AT = "2026-04-13T10:00:00.000Z";

export function makeWorkspace(args: {
  id: string;
  repoName?: string;
  sourceRoot?: string;
  kind?: Workspace["kind"];
  branch?: string;
  currentBranch?: string | null;
  originalBranch?: string | null;
  displayName?: string | null;
  origin?: Workspace["origin"];
  creatorContext?: Workspace["creatorContext"];
  executionSummary?: Workspace["executionSummary"];
  updatedAt?: string;
  path?: string;
}): Workspace {
  const {
    id,
    repoName = "proliferate",
    sourceRoot = `/tmp/${repoName}`,
    kind = "local",
    branch = kind === "worktree" ? `feature/${id}` : "main",
    currentBranch = branch,
    originalBranch = branch,
    displayName = null,
    origin = null,
    creatorContext = null,
    executionSummary = null,
    updatedAt = DEFAULT_UPDATED_AT,
    path = kind === "local" ? sourceRoot : `${sourceRoot}/${id}`,
  } = args;

  return {
    id,
    kind,
    repoRootId: `${repoName}-root`,
    path,
    surface: "standard",
    originalBranch,
    currentBranch,
    displayName,
    origin,
    creatorContext,
    executionSummary,
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: updatedAt,
    updatedAt,
  };
}

export function makeRepoRoot(args: {
  id?: string;
  repoName?: string;
  sourceRoot?: string;
  updatedAt?: string;
} = {}): RepoRoot {
  const {
    repoName = "proliferate",
    id = `${repoName}-root`,
    sourceRoot = `/tmp/${repoName}`,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;

  return {
    id,
    kind: "external",
    path: sourceRoot,
    displayName: repoName,
    defaultBranch: "main",
    remoteProvider: "github",
    remoteOwner: "proliferate-ai",
    remoteRepoName: repoName,
    remoteUrl: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

export function makeRepoConfig(args: {
  id?: string;
  repoName?: string;
  owner?: string;
  environments?: RepoEnvironmentResponse[];
} = {}): RepoConfigResponse {
  const {
    id = "repo-config-1",
    repoName = "proliferate",
    owner = "proliferate-ai",
    environments = [makeRepoEnvironment({ repoConfigId: id })],
  } = args;

  return {
    id,
    gitProvider: "github",
    gitOwner: owner,
    gitRepoName: repoName,
    environments,
  };
}

export function makeRepoEnvironment(
  overrides: Partial<RepoEnvironmentResponse> = {},
): RepoEnvironmentResponse {
  return {
    id: "repo-environment-1",
    repoConfigId: "repo-config-1",
    kind: "cloud",
    desktopInstallId: null,
    localPath: null,
    defaultBranch: "main",
    setupScript: "",
    runCommand: "",
    ...overrides,
  };
}

export function makeCloudWorkspace(args: {
  id: string;
  repoName?: string;
  branch?: string;
  displayName?: string | null;
  productLifecycle?: SidebarCloudWorkspaceSummary["productLifecycle"];
  origin?: SidebarCloudWorkspaceSummary["origin"];
  creatorContext?: SidebarCloudWorkspaceSummary["creatorContext"];
  directTargetContext?: SidebarCloudWorkspaceSummary["directTargetContext"];
  exposureState?: SidebarCloudWorkspaceSummary["exposureState"];
  sandboxType?: SidebarCloudWorkspaceSummary["sandboxType"];
  status?: SidebarCloudWorkspaceSummary["status"];
  updatedAt?: string;
  readyAt?: string | null;
}): SidebarCloudWorkspaceSummary {
  const {
    id,
    repoName = "proliferate",
    branch = "main",
    displayName = null,
    productLifecycle,
    origin = null,
    creatorContext = null,
    directTargetContext = null,
    exposureState,
    sandboxType,
    status = "ready",
    updatedAt = DEFAULT_UPDATED_AT,
    readyAt = status === "ready" ? updatedAt : null,
  } = args;

  return {
    id,
    displayName,
    origin,
    creatorContext,
    directTargetContext,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: repoName,
      branch,
      baseBranch: "main",
    },
    status,
    workspaceStatus: status,
    productLifecycle,
    runtime: {
      environmentId: null,
      status: "running",
      generation: 0,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    actionBlockKind: null,
    createdAt: updatedAt,
    updatedAt,
    readyAt,
    postReadyPhase: "idle",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
    exposureState,
    sandboxType,
  };
}

export function makeLocalLogicalWorkspace(args: {
  id: string;
  workspaceId?: string;
  repoKey: string;
  repoName: string;
  kind?: Workspace["kind"];
  branch?: string;
  displayName?: string | null;
  origin?: Workspace["origin"];
  creatorContext?: Workspace["creatorContext"];
  executionSummary?: Workspace["executionSummary"];
  updatedAt?: string;
}): LogicalWorkspace {
  const {
    id,
    workspaceId,
    repoKey,
    repoName,
    kind = "local",
    branch,
    displayName,
    origin,
    creatorContext,
    executionSummary,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;
  const localWorkspace = makeWorkspace({
    id: workspaceId ?? `${id}-materialization`,
    repoName,
    sourceRoot: repoKey,
    kind,
    branch,
    displayName,
    origin,
    creatorContext,
    executionSummary,
    updatedAt,
  });

  return {
    id,
    repoKey,
    sourceRoot: repoKey,
    repoRoot: null,
    provider: "github",
    owner: "proliferate-ai",
    repoName,
    branchKey: branch ?? localWorkspace.currentBranch ?? "main",
    displayName: localWorkspace.displayName ?? repoName,
    localWorkspace,
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: localWorkspace.id,
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt,
  };
}

export function makeCloudLogicalWorkspace(args: {
  id: string;
  cloudWorkspaceId?: string;
  repoKey: string;
  repoName: string;
  branch?: string;
  origin?: SidebarCloudWorkspaceSummary["origin"];
  creatorContext?: SidebarCloudWorkspaceSummary["creatorContext"];
  updatedAt?: string;
}): LogicalWorkspace {
  const {
    id,
    cloudWorkspaceId = `${id}-cloud`,
    repoKey,
    repoName,
    branch = "main",
    origin,
    creatorContext,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;
  const cloudWorkspace = makeCloudWorkspace({
    id: cloudWorkspaceId,
    repoName,
    branch,
    origin,
    creatorContext,
    updatedAt,
  });

  return {
    id,
    repoKey,
    sourceRoot: repoKey,
    repoRoot: null,
    provider: "github",
    owner: "proliferate-ai",
    repoName,
    branchKey: branch,
    displayName: cloudWorkspace.displayName ?? repoName,
    localWorkspace: null,
    cloudWorkspace,
    mobilityWorkspace: null,
    preferredMaterializationId: `cloud:${cloudWorkspace.id}`,
    effectiveOwner: "cloud",
    lifecycle: "cloud_active",
    updatedAt,
  };
}

export function buildGroups(args: {
  logicalWorkspaces: LogicalWorkspace[];
  repoRoots?: RepoRoot[];
  repoConfigs?: readonly RepoConfigResponse[];
  workspaceTypes?: SidebarWorkspaceVariant[];
  showArchived?: boolean;
  archivedIds?: string[];
  hiddenRepoRootIds?: string[];
  selectedLogicalWorkspaceId?: string | null;
  selectedWorkspaceId?: string | null;
  pendingWorkspaceEntry?: PendingWorkspaceEntry | null;
  workspaceActivities?: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  lastViewedAt?: Record<string, string>;
  workspaceLastInteracted?: Record<string, string>;
  sessionWorkspaceIds?: Record<string, string | null>;
  sessionLastInteracted?: Record<string, string>;
  sessionLastViewedAt?: Record<string, string>;
  suppressActiveNeedsReview?: boolean;
}) {
  return buildSidebarGroupStates({
    repoRoots: args.repoRoots ?? [],
    repoConfigs: args.repoConfigs ?? [],
    logicalWorkspaces: args.logicalWorkspaces,
    showArchived: args.showArchived ?? false,
    workspaceTypes: args.workspaceTypes ?? DEFAULT_SIDEBAR_WORKSPACE_TYPES,
    archivedSet: new Set(args.archivedIds ?? []),
    hiddenRepoRootIds: new Set(args.hiddenRepoRootIds ?? []),
    selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId ?? null,
    selectedWorkspaceId: args.selectedWorkspaceId ?? null,
    pendingWorkspaceEntry: args.pendingWorkspaceEntry ?? null,
    workspaceActivities: args.workspaceActivities ?? {},
    pendingPromptCounts: args.pendingPromptCounts,
    gitStatus: undefined,
    activeSessionTitle: null,
    lastViewedAt: args.lastViewedAt ?? {},
    workspaceLastInteracted: args.workspaceLastInteracted ?? {},
    sessionWorkspaceIds: args.sessionWorkspaceIds,
    sessionLastInteracted: args.sessionLastInteracted,
    sessionLastViewedAt: args.sessionLastViewedAt,
    suppressActiveNeedsReview: args.suppressActiveNeedsReview,
  });
}
