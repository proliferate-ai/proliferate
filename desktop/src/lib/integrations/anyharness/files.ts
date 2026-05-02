import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import { getAnyHarnessClient } from "@anyharness/sdk-react";

export type RepoTrackedFileSourceKind = "workspace" | "repo_root";

export interface RepoTrackedFileSource {
  localWorkspaceId?: string | null;
  repoRootId?: string | null;
}

export interface RepoTrackedTextFileRead {
  content: string;
  sourceKind: RepoTrackedFileSourceKind;
}

function readTextFileContent(
  response: ReadWorkspaceFileResponse,
  relativePath: string,
): string {
  if (!response.isText || response.tooLarge || typeof response.content !== "string") {
    throw new Error(`Only text files up to 1 MiB can be synced: ${relativePath}`);
  }
  return response.content;
}

export async function readWorkspaceTextFile(
  runtimeUrl: string,
  workspaceId: string,
  relativePath: string,
): Promise<string> {
  const response = await getAnyHarnessClient({ runtimeUrl }).files.read(
    workspaceId,
    relativePath,
  );
  return readTextFileContent(response, relativePath);
}

export async function readRepoRootTextFile(
  runtimeUrl: string,
  repoRootId: string,
  relativePath: string,
): Promise<string> {
  const response = await getAnyHarnessClient({ runtimeUrl }).repoRoots.readFile(
    repoRootId,
    relativePath,
  );
  return readTextFileContent(response, relativePath);
}

export async function readRepoTrackedTextFile(
  runtimeUrl: string,
  source: RepoTrackedFileSource,
  relativePath: string,
): Promise<RepoTrackedTextFileRead> {
  const localWorkspaceId = source.localWorkspaceId?.trim();
  if (localWorkspaceId) {
    return {
      content: await readWorkspaceTextFile(runtimeUrl, localWorkspaceId, relativePath),
      sourceKind: "workspace",
    };
  }

  const repoRootId = source.repoRootId?.trim();
  if (repoRootId) {
    return {
      content: await readRepoRootTextFile(runtimeUrl, repoRootId, relativePath),
      sourceKind: "repo_root",
    };
  }

  throw new Error("A local workspace or repo root is required to read tracked files.");
}
