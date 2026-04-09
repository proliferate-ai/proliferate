import type { CreateCloudWorkspaceRequest } from "@/lib/integrations/cloud/client";

export interface NewCloudWorkspaceSeed {
  gitOwner: string;
  gitRepoName: string;
  displayName?: string;
  prefillBranchName?: string;
}

/**
 * Returns an explicit display name override if the user supplied one in the
 * create dialog, otherwise `null`. `null` lets the sidebar fall back to the
 * default branch- or repo-derived label, matching local AnyHarness workspaces.
 */
export function buildNewCloudWorkspaceDisplayName(
  seed: NewCloudWorkspaceSeed,
): string | null {
  return seed.displayName?.trim() || null;
}

export function resolveNewCloudWorkspaceBaseBranch(
  baseBranchOverride: string,
  defaultBranch: string | null | undefined,
): string {
  return baseBranchOverride.trim() || defaultBranch?.trim() || "";
}

export function normalizeCloudWorkspaceBranchName(value: string): string {
  return value.trim();
}

export function buildCreateCloudWorkspaceRequest(
  seed: NewCloudWorkspaceSeed,
  input: {
    baseBranch: string;
    branchName: string;
  },
): CreateCloudWorkspaceRequest {
  return {
    gitProvider: "github",
    gitOwner: seed.gitOwner,
    gitRepoName: seed.gitRepoName,
    baseBranch: input.baseBranch.trim(),
    branchName: normalizeCloudWorkspaceBranchName(input.branchName),
    displayName: buildNewCloudWorkspaceDisplayName(seed),
  };
}
