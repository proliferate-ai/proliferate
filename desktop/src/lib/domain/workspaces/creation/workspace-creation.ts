import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { buildBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { BranchPrefixType } from "@/lib/domain/preferences/user-preferences";

export interface CreateWorktreeWorkspaceInput {
  repoRootId: string;
  sourceWorkspaceId?: string | null;
  branchName?: string;
  baseBranch?: string;
  targetPath?: string;
  workspaceName?: string;
}

export interface WorktreeCreationParams {
  repoRootId: string;
  workspaceName: string;
  branchName: string;
  targetPath: string;
  baseRef: string;
  setupScript: string | null;
}

export interface ResolvedWorktreeCreation {
  params: WorktreeCreationParams;
  source: Workspace | null;
  repoName: string;
}

export function resolveWorktreeCreationParams(input: {
  repoRoot: RepoRoot;
  sourceWorkspace: Workspace | null;
  rawInput: CreateWorktreeWorkspaceInput;
  homeDir: string;
  branchPrefixType: BranchPrefixType;
  authUser: AuthUser | null;
  repoConfig?: {
    defaultBranch?: string | null;
    setupScript?: string | null;
  } | null;
}): ResolvedWorktreeCreation {
  const {
    repoRoot,
    sourceWorkspace,
    rawInput,
    homeDir,
    branchPrefixType,
    authUser,
    repoConfig,
  } = input;

  const workspaceName = rawInput.workspaceName?.trim() || "workspace";
  const repoName = repoRoot.remoteRepoName?.trim()
    || sourceWorkspace?.gitRepoName
    || repoRoot.path.split("/").pop()
    || "repo";
  const targetPath = rawInput.targetPath?.trim()
    || `${homeDir}/.proliferate/worktrees/${repoName}/${workspaceName}`;
  const baseRef = rawInput.baseBranch?.trim()
    || repoConfig?.defaultBranch?.trim()
    || repoRoot.defaultBranch?.trim()
    || sourceWorkspace?.currentBranch
    || sourceWorkspace?.originalBranch
    || "HEAD";
  const repoRootId = rawInput.repoRootId.trim();

  return {
    params: {
      repoRootId,
      workspaceName,
      branchName: buildBranchName(
        rawInput.branchName?.trim() || workspaceName,
        branchPrefixType,
        authUser,
      ),
      targetPath,
      baseRef,
      setupScript: repoConfig?.setupScript?.trim() || null,
    },
    source: sourceWorkspace,
    repoName,
  };
}
