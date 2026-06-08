import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { buildBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { BranchPrefixType } from "@/lib/domain/preferences/user/model";

export type WorktreeNameConflictPolicy = "fail" | "suffix_path" | "suffix_path_and_branch";
export type WorktreeCheckoutMode = "new_branch" | "detached_ref";

export interface CreateWorktreeWorkspaceInput {
  repoRootId: string;
  sourceWorkspaceId?: string | null;
  branchName?: string;
  baseBranch?: string;
  targetPath?: string;
  workspaceName?: string;
  generatedName?: boolean;
  defaultBranch?: string | null;
}

export interface WorktreeCreationParams {
  repoRootId: string;
  workspaceName: string;
  branchName: string;
  targetPath: string;
  baseRef: string;
  checkoutMode: WorktreeCheckoutMode;
  setupScript: string | null;
  nameConflictPolicy: WorktreeNameConflictPolicy;
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
    || repoRoot.path.split("/").pop()
    || "repo";
  const targetPath = rawInput.targetPath?.trim()
    || `${homeDir}/.proliferate/worktrees/${repoName}/${workspaceName}`;
  const hasExplicitBranch = Boolean(rawInput.branchName?.trim());
  const hasExplicitTargetPath = Boolean(rawInput.targetPath?.trim());
  const explicitBaseRef = rawInput.baseBranch?.trim();
  const repoDefaultRef = rawInput.defaultBranch?.trim()
    || repoConfig?.defaultBranch?.trim()
    || repoRoot.defaultBranch?.trim()
    || null;
  const baseRef = rawInput.baseBranch?.trim()
    || rawInput.defaultBranch?.trim()
    || repoConfig?.defaultBranch?.trim()
    || repoRoot.defaultBranch?.trim()
    || sourceWorkspace?.currentBranch
    || sourceWorkspace?.originalBranch
    || "HEAD";
  const repoRootId = rawInput.repoRootId.trim();
  const checkoutMode = resolveCheckoutMode({
    explicitBaseRef,
    repoDefaultRef,
    hasExplicitBranch,
  });
  const nameConflictPolicy = resolveNameConflictPolicy({
    generatedName: Boolean(rawInput.generatedName),
    hasExplicitBranch,
    hasExplicitTargetPath,
    checkoutMode,
  });

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
      checkoutMode,
      setupScript: repoConfig?.setupScript?.trim() || null,
      nameConflictPolicy,
    },
    source: sourceWorkspace,
    repoName,
  };
}

function resolveNameConflictPolicy(input: {
  generatedName: boolean;
  hasExplicitBranch: boolean;
  hasExplicitTargetPath: boolean;
  checkoutMode: WorktreeCheckoutMode;
}): WorktreeNameConflictPolicy {
  if (!input.generatedName || input.hasExplicitBranch || input.hasExplicitTargetPath) {
    return "fail";
  }

  return input.checkoutMode === "detached_ref" ? "suffix_path" : "suffix_path_and_branch";
}

function resolveCheckoutMode(input: {
  explicitBaseRef: string | undefined;
  repoDefaultRef: string | null;
  hasExplicitBranch: boolean;
}): WorktreeCheckoutMode {
  if (input.hasExplicitBranch || !input.explicitBaseRef || !input.repoDefaultRef) {
    return "new_branch";
  }

  const selectedRef = normalizeBranchRef(input.explicitBaseRef);
  const defaultRef = normalizeBranchRef(input.repoDefaultRef);
  return selectedRef && defaultRef && selectedRef !== defaultRef ? "detached_ref" : "new_branch";
}

function normalizeBranchRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/origin\//, "")
    .replace(/^origin\//, "");
}
