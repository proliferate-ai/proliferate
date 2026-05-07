import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { SidebarSessionActivityState } from "@/lib/domain/sessions/activity";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import type { CloudWorkspaceSummary } from "@/lib/access/cloud/client";
import {
  buildSidebarGroupStates,
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  type SidebarWorkspaceVariant,
} from "./sidebar";

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
  } = args;

  return {
    id,
    kind,
    repoRootId: `${repoName}-root`,
    path: `${sourceRoot}/${id}`,
    surface: "standard",
    sourceRepoRootPath: sourceRoot,
    sourceWorkspaceId: `${repoName}-root-workspace`,
    gitProvider: "github",
    gitOwner: "proliferate-ai",
    gitRepoName: repoName,
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
    id = "repo-root-1",
    repoName = "proliferate",
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

export function makeCloudWorkspace(args: {
  id: string;
  repoName?: string;
  branch?: string;
  displayName?: string | null;
  origin?: CloudWorkspaceSummary["origin"];
  creatorContext?: CloudWorkspaceSummary["creatorContext"];
  status?: CloudWorkspaceSummary["status"];
  updatedAt?: string;
}): CloudWorkspaceSummary {
  const {
    id,
    repoName = "proliferate",
    branch = "main",
    displayName = null,
    origin = null,
    creatorContext = null,
    status = "ready",
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;

  return {
    id,
    displayName,
    origin,
    creatorContext,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: repoName,
      branch,
      baseBranch: "main",
    },
    status,
    workspaceStatus: status,
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
    postReadyPhase: "idle",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
  };
}

export function makeLocalLogicalWorkspace(args: {
  id: string;
  repoKey: string;
  repoName: string;
  kind?: Workspace["kind"];
  branch?: string;
  origin?: Workspace["origin"];
  creatorContext?: Workspace["creatorContext"];
  executionSummary?: Workspace["executionSummary"];
  updatedAt?: string;
}): LogicalWorkspace {
  const {
    id,
    repoKey,
    repoName,
    kind = "local",
    branch,
    origin,
    creatorContext,
    executionSummary,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;
  const localWorkspace = makeWorkspace({
    id: `${id}-materialization`,
    repoName,
    sourceRoot: repoKey,
    kind,
    branch,
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
    displayName: localWorkspace.displayName ?? localWorkspace.gitRepoName ?? repoName,
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
  repoKey: string;
  repoName: string;
  branch?: string;
  origin?: CloudWorkspaceSummary["origin"];
  creatorContext?: CloudWorkspaceSummary["creatorContext"];
  updatedAt?: string;
}): LogicalWorkspace {
  const {
    id,
    repoKey,
    repoName,
    branch = "main",
    origin,
    creatorContext,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;
  const cloudWorkspace = makeCloudWorkspace({
    id: `${id}-cloud`,
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
  workspaceTypes?: SidebarWorkspaceVariant[];
  showArchived?: boolean;
  archivedIds?: string[];
  hiddenRepoRootIds?: string[];
  selectedLogicalWorkspaceId?: string | null;
  workspaceActivities?: Record<string, SidebarSessionActivityState>;
  pendingPromptCounts?: Record<string, number>;
  lastViewedAt?: Record<string, string>;
  workspaceLastInteracted?: Record<string, string>;
  finishSuggestionsByWorkspaceId?: Record<
    string,
    { workspaceId: string; readinessFingerprint: string }
  >;
}) {
  return buildSidebarGroupStates({
    repoRoots: args.repoRoots ?? [],
    logicalWorkspaces: args.logicalWorkspaces,
    showArchived: args.showArchived ?? false,
    workspaceTypes: args.workspaceTypes ?? DEFAULT_SIDEBAR_WORKSPACE_TYPES,
    archivedSet: new Set(args.archivedIds ?? []),
    hiddenRepoRootIds: new Set(args.hiddenRepoRootIds ?? []),
    selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId ?? null,
    selectedWorkspaceId: null,
    workspaceActivities: args.workspaceActivities ?? {},
    pendingPromptCounts: args.pendingPromptCounts,
    gitStatus: undefined,
    activeSessionTitle: null,
    lastViewedAt: args.lastViewedAt ?? {},
    workspaceLastInteracted: args.workspaceLastInteracted ?? {},
    finishSuggestionsByWorkspaceId: args.finishSuggestionsByWorkspaceId,
  });
}
