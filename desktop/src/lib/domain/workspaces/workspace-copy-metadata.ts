import { workspaceCurrentBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";

export interface WorkspaceCopyMetadata {
  workspaceLocation: WorkspaceCopyLocationTarget | null;
  branchName: string | null;
}

export interface WorkspaceCopyLocationTarget {
  value: string;
  menuLabel: string;
  toastLabel: string;
  missingLabel: string;
}

export function workspaceCopyMetadataForLogicalWorkspace(
  workspace: LogicalWorkspace | null | undefined,
): WorkspaceCopyMetadata {
  const localWorkspace = workspace?.localWorkspace ?? null;
  const workspacePath = firstTrimmed(localWorkspace
    ? [
      localWorkspace.path,
      localWorkspace.sourceRepoRootPath,
      workspace?.repoRoot?.path,
      workspace?.sourceRoot,
    ]
    : []);
  const repositoryIdentity = workspace
    ? resolveRepositoryIdentity(workspace)
    : null;
  const workspaceLocation = workspacePath
    ? {
      value: workspacePath,
      menuLabel: "Copy workspace path",
      toastLabel: "Workspace path",
      missingLabel: "No workspace path to copy.",
    }
    : repositoryIdentity
      ? {
        value: repositoryIdentity,
        menuLabel: "Copy repository",
        toastLabel: "Repository",
        missingLabel: "No repository to copy.",
      }
      : null;
  const branchName = firstTrimmed([
    localWorkspace ? workspaceCurrentBranchName(localWorkspace) : null,
    workspace?.cloudWorkspace?.repo.branch,
    workspace?.mobilityWorkspace?.repo.branch,
    workspace?.branchKey,
  ]);

  return {
    workspaceLocation,
    branchName,
  };
}

function resolveRepositoryIdentity(workspace: LogicalWorkspace): string | null {
  const cloudRepo = formatRepoIdentity(workspace.cloudWorkspace?.repo);
  if (cloudRepo) {
    return cloudRepo;
  }

  const mobilityRepo = formatRepoIdentity(workspace.mobilityWorkspace?.repo);
  if (mobilityRepo) {
    return mobilityRepo;
  }

  const owner = workspace.owner?.trim();
  const repoName = workspace.repoName?.trim();
  return owner && repoName ? `${owner}/${repoName}` : null;
}

function formatRepoIdentity(
  repo: { owner?: string | null; name?: string | null } | null | undefined,
): string | null {
  const owner = repo?.owner?.trim();
  const name = repo?.name?.trim();
  return owner && name ? `${owner}/${name}` : null;
}

function firstTrimmed(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}
