import type { Workspace } from "@anyharness/sdk";
import { buildBranchName } from "@/lib/domain/workspaces/branch-naming";
import type { AuthUser } from "@/lib/integrations/auth/proliferate-auth";
import type { BranchPrefixType } from "@/stores/preferences/user-preferences-store";

export interface CreateWorktreeWorkspaceInput {
  sourceWorkspaceId: string;
  branchName?: string;
  baseBranch?: string;
  targetPath?: string;
  workspaceName?: string;
}

export interface WorktreeCreationParams {
  sourceWorkspaceId: string;
  workspaceName: string;
  branchName: string;
  targetPath: string;
  baseRef: string;
  setupScript: string | null;
}

export interface ResolvedWorktreeCreation {
  params: WorktreeCreationParams;
  source: Workspace;
  repoName: string;
}

export function resolveWorktreeCreationParams(input: {
  source: Workspace;
  rawInput: CreateWorktreeWorkspaceInput;
  homeDir: string;
  branchPrefixType: BranchPrefixType;
  authUser: AuthUser | null;
  repoConfig?: {
    defaultBranch?: string | null;
    setupScript?: string | null;
  } | null;
}): ResolvedWorktreeCreation {
  const { source, rawInput, homeDir, branchPrefixType, authUser, repoConfig } = input;

  const workspaceName = rawInput.workspaceName?.trim() || "workspace";
  const repoName = source.gitRepoName ?? source.path.split("/").pop() ?? "repo";
  const targetPath = rawInput.targetPath?.trim()
    || `${homeDir}/.proliferate/worktrees/${repoName}/${workspaceName}`;
  const baseRef = rawInput.baseBranch?.trim()
    || repoConfig?.defaultBranch?.trim()
    || source.currentBranch
    || source.originalBranch
    || "HEAD";

  return {
    params: {
      sourceWorkspaceId: rawInput.sourceWorkspaceId,
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
    source,
    repoName,
  };
}
