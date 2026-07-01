import {
  listCloudWorkspaces,
  type CloudWorkspaceDetail,
  type CreateCloudWorkspaceRequest,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

export async function createCloudWorkspaceWithTransientRecovery(args: {
  client: ProliferateCloudClient;
  request: CreateCloudWorkspaceRequest;
  createWorkspace: (request: CreateCloudWorkspaceRequest) => Promise<CloudWorkspaceDetail>;
}): Promise<Pick<CloudWorkspaceDetail, "id">> {
  let lastError: unknown = null;
  for (const delayMs of [0, 750, 1500]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      return await args.createWorkspace(args.request);
    } catch (error) {
      lastError = error;
      const recovered = await recoverCreatedWorkspaceByBranch(args).catch(() => null);
      if (recovered) {
        return recovered;
      }
      if (!isRecoverableNetworkError(error) && !isDuplicateBranchError(error)) {
        throw error;
      }
    }
  }
  const recovered = await recoverCreatedWorkspaceByBranch(args).catch(() => null);
  if (recovered) {
    return recovered;
  }
  throw lastError instanceof Error ? lastError : new Error("Could not create workspace.");
}

async function recoverCreatedWorkspaceByBranch(args: {
  client: ProliferateCloudClient;
  request: CreateCloudWorkspaceRequest;
}): Promise<Pick<CloudWorkspaceDetail, "id"> | null> {
  const workspaces = await listCloudWorkspaces(
    undefined,
    { ownerScope: args.request.ownerScope ?? "personal", scope: "my" },
    args.client,
  );
  return workspaces.find((workspace) => cloudWorkspaceMatchesCreatedBranch(
    workspace,
    args.request,
  )) ?? null;
}

export function cloudWorkspaceMatchesCreatedBranch(
  workspace: Pick<CloudWorkspaceDetail, "repo">,
  request: CreateCloudWorkspaceRequest,
): boolean {
  if (
    workspace.repo.owner !== request.gitOwner
    || workspace.repo.name !== request.gitRepoName
  ) {
    return false;
  }
  if (workspace.repo.branch === request.branchName) {
    return true;
  }
  if (!request.generatedName) {
    return false;
  }
  return generatedBranchSuffixPattern(request.branchName).test(workspace.repo.branch);
}

function generatedBranchSuffixPattern(branchName: string): RegExp {
  return new RegExp(`^${escapeRegExp(branchName)}-[1-9]\\d*$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDuplicateBranchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bcloud_branch_already_exists\b|\bbranch\b.*\balready exists\b/i.test(message);
}

function isRecoverableNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(failed to fetch|network|load failed|connection|aborted|timeout|timed out)\b/i
    .test(message);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
