import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import {
  type CloudRepoActionState,
  type CloudWorkspaceRepoTarget,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  getCloudRepoTargetForSelectedWorkspace,
  getRepoForSelectedWorkspace,
} from "@/lib/domain/workspaces/cloud/selected-repo-target";
import {
  sidebarRepoGroupKeyForCloudTarget,
  sidebarRepoGroupKeyForWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-group-key";

export type NewWorkspaceCommandKind = "local" | "worktree" | "cloud";

export type NewWorkspaceCommandScopeSource =
  | "sidebar"
  | "home"
  | "selected-workspace";

export interface NewWorkspaceCommandScope {
  id: string;
  source: NewWorkspaceCommandScopeSource;
  repoGroupKeyToExpand: string | null;
  localSourceRoot: string | null;
  repoRootId: string | null;
  sourceWorkspaceId: string | null;
  cloudRepoTarget: CloudWorkspaceRepoTarget | null;
  baseBranch: string | null;
  defaultBranch: string | null;
}

export type NewWorkspaceDisabledCommandTarget<
  Kind extends NewWorkspaceCommandKind = NewWorkspaceCommandKind,
> = {
  commandKind: Kind;
  disabledReason: string;
};

export type NewLocalWorkspaceCommandTarget =
  | {
    commandKind: "local";
    sourceRoot: string;
    repoGroupKeyToExpand: string | null;
    disabledReason: null;
  }
  | NewWorkspaceDisabledCommandTarget<"local">;

export type NewWorktreeWorkspaceCommandTarget =
  | {
    commandKind: "worktree";
    repoRootId: string;
    sourceWorkspaceId: string | null;
    baseBranch: string | null;
    defaultBranch: string | null;
    repoGroupKeyToExpand: string | null;
    disabledReason: null;
  }
  | NewWorkspaceDisabledCommandTarget<"worktree">;

export type NewCloudWorkspaceCommandTarget =
  | {
    commandKind: "cloud";
    cloudActionKind: "create" | "configure";
    target: CloudWorkspaceRepoTarget;
    repoGroupKeyToExpand: string | null;
    disabledReason: null;
  }
  | NewWorkspaceDisabledCommandTarget<"cloud">;

export type NewWorkspaceCommandTarget =
  | NewLocalWorkspaceCommandTarget
  | NewWorktreeWorkspaceCommandTarget
  | NewCloudWorkspaceCommandTarget;

interface ResolveNewWorkspaceCommandTargetInput<
  Kind extends NewWorkspaceCommandKind = NewWorkspaceCommandKind,
> {
  commandKind: Kind;
  scope: NewWorkspaceCommandScope | null;
  busyReason?: string | null;
  cloudUnavailableReason?: string | null;
  cloudRepoAction?: CloudRepoActionState | null;
}

export interface BuildSelectedWorkspaceCommandScopeInput {
  selectedWorkspaceId: string | null;
  workspaces: Workspace[];
  cloudWorkspaces: CloudWorkspaceSummary[];
  repoRoots: RepoRoot[];
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function withBaseBranch(
  target: CloudWorkspaceRepoTarget,
  baseBranch: string | null,
): CloudWorkspaceRepoTarget {
  const normalizedBaseBranch = trimToNull(target.baseBranch) ?? trimToNull(baseBranch);
  return normalizedBaseBranch
    ? { ...target, baseBranch: normalizedBaseBranch }
    : { gitOwner: target.gitOwner, gitRepoName: target.gitRepoName };
}

function disabledTarget<Kind extends NewWorkspaceCommandKind>(
  commandKind: Kind,
  disabledReason: string,
): NewWorkspaceDisabledCommandTarget<Kind> {
  return { commandKind, disabledReason };
}

export function buildSidebarNewWorkspaceCommandScope(input: {
  sourceRoot: string;
  localSourceRoot: string | null;
  repoRootId: string | null;
  cloudRepoTarget: CloudWorkspaceRepoTarget | null;
}): NewWorkspaceCommandScope {
  const sourceRoot = trimToNull(input.sourceRoot) ?? "unknown";

  return {
    id: `sidebar:${sourceRoot}`,
    source: "sidebar",
    repoGroupKeyToExpand: sourceRoot,
    localSourceRoot: trimToNull(input.localSourceRoot),
    repoRootId: trimToNull(input.repoRootId),
    sourceWorkspaceId: null,
    cloudRepoTarget: input.cloudRepoTarget,
    baseBranch: null,
    defaultBranch: null,
  };
}

export function buildRepositoryNewWorkspaceCommandScope(
  repository: SettingsRepositoryEntry | null,
  baseBranch: string | null,
  source: "home",
  defaultBranch?: string | null,
): NewWorkspaceCommandScope | null {
  const sourceRoot = trimToNull(repository?.sourceRoot);
  if (!repository || !sourceRoot) {
    return null;
  }

  const normalizedBaseBranch = trimToNull(baseBranch);
  const hasLocalEnvironment = repository.availability !== "cloud";
  const gitOwner = trimToNull(repository.gitOwner);
  const gitRepoName = trimToNull(repository.gitRepoName);
  const cloudRepoTarget = gitOwner && gitRepoName
    ? withBaseBranch({ gitOwner, gitRepoName }, normalizedBaseBranch)
    : null;

  return {
    id: `${source}:${sourceRoot}`,
    source,
    repoGroupKeyToExpand: sourceRoot,
    localSourceRoot: hasLocalEnvironment ? sourceRoot : null,
    repoRootId: hasLocalEnvironment ? trimToNull(repository.repoRootId) : null,
    sourceWorkspaceId: hasLocalEnvironment ? trimToNull(repository.localWorkspaceId) : null,
    cloudRepoTarget,
    baseBranch: normalizedBaseBranch,
    defaultBranch: trimToNull(defaultBranch),
  };
}

export function buildSelectedWorkspaceNewWorkspaceCommandScope(
  input: BuildSelectedWorkspaceCommandScopeInput,
): NewWorkspaceCommandScope | null {
  const repoContext = getRepoForSelectedWorkspace(
    input.selectedWorkspaceId,
    input.workspaces,
  );
  const cloudRepoTarget = getCloudRepoTargetForSelectedWorkspace(
    input.selectedWorkspaceId,
    input.workspaces,
    input.cloudWorkspaces,
    input.repoRoots,
  );

  if (!repoContext?.repoWs && !cloudRepoTarget) {
    return null;
  }

  const repoWs = repoContext?.repoWs ?? null;
  const repoRoot = repoWs?.repoRootId
    ? input.repoRoots.find((candidate) => candidate.id === repoWs.repoRootId) ?? null
    : null;
  const repoGroupKeyToExpand = repoWs
    ? sidebarRepoGroupKeyForWorkspace(repoWs, input.repoRoots)
    : cloudRepoTarget
      ? sidebarRepoGroupKeyForCloudTarget(cloudRepoTarget, input.repoRoots)
      : null;

  return {
    id: `selected:${input.selectedWorkspaceId ?? "none"}`,
    source: "selected-workspace",
    repoGroupKeyToExpand,
    localSourceRoot: trimToNull(repoRoot?.path) ?? trimToNull(repoWs?.path),
    repoRootId: trimToNull(repoWs?.repoRootId),
    sourceWorkspaceId: trimToNull(repoWs?.id),
    cloudRepoTarget,
    baseBranch: null,
    defaultBranch: null,
  };
}

export function resolveNewWorkspaceCommandTarget(
  input: ResolveNewWorkspaceCommandTargetInput<"local">,
): NewLocalWorkspaceCommandTarget;
export function resolveNewWorkspaceCommandTarget(
  input: ResolveNewWorkspaceCommandTargetInput<"worktree">,
): NewWorktreeWorkspaceCommandTarget;
export function resolveNewWorkspaceCommandTarget(
  input: ResolveNewWorkspaceCommandTargetInput<"cloud">,
): NewCloudWorkspaceCommandTarget;
export function resolveNewWorkspaceCommandTarget(
  input: ResolveNewWorkspaceCommandTargetInput,
): NewWorkspaceCommandTarget {
  if (input.busyReason) {
    return disabledTarget(input.commandKind, input.busyReason);
  }

  if (input.commandKind === "local") {
    const sourceRoot = trimToNull(input.scope?.localSourceRoot);
    return sourceRoot
      ? {
        commandKind: "local",
        sourceRoot,
        repoGroupKeyToExpand: trimToNull(input.scope?.repoGroupKeyToExpand),
        disabledReason: null,
      }
      : disabledTarget("local", "Select a repository workspace first.");
  }

  if (input.commandKind === "worktree") {
    const repoRootId = trimToNull(input.scope?.repoRootId);
    return repoRootId
      ? {
        commandKind: "worktree",
        repoRootId,
        sourceWorkspaceId: trimToNull(input.scope?.sourceWorkspaceId),
        baseBranch: trimToNull(input.scope?.baseBranch),
        defaultBranch: trimToNull(input.scope?.defaultBranch),
        repoGroupKeyToExpand: trimToNull(input.scope?.repoGroupKeyToExpand),
        disabledReason: null,
      }
      : disabledTarget("worktree", "Select a repository workspace first.");
  }

  if (input.cloudUnavailableReason) {
    return disabledTarget("cloud", input.cloudUnavailableReason);
  }

  const target = input.scope?.cloudRepoTarget
    ? withBaseBranch(input.scope.cloudRepoTarget, trimToNull(input.scope.baseBranch))
    : null;
  const cloudRepoAction = input.cloudRepoAction ?? { kind: "hidden", label: null };
  if (!target || cloudRepoAction.kind === "hidden") {
    return disabledTarget("cloud", "Select a repository workspace first.");
  }
  if (cloudRepoAction.kind === "loading") {
    return disabledTarget("cloud", "Cloud repository settings are loading.");
  }

  return {
    commandKind: "cloud",
    cloudActionKind: cloudRepoAction.kind,
    target,
    repoGroupKeyToExpand: trimToNull(input.scope?.repoGroupKeyToExpand),
    disabledReason: null,
  };
}
