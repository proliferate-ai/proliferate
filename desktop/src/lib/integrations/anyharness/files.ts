import { getAnyHarnessClient } from "@anyharness/sdk-react";

export async function readWorkspaceTextFile(
  runtimeUrl: string,
  workspaceId: string,
  relativePath: string,
): Promise<string> {
  const response = await getAnyHarnessClient({ runtimeUrl }).files.read(
    workspaceId,
    relativePath,
  );
  if (!response.isText || response.tooLarge || response.content === null) {
    throw new Error(`Only text files up to 1 MiB can be synced: ${relativePath}`);
  }
  return response.content;
}
