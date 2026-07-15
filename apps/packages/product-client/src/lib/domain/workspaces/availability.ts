import type { Workspace } from "@anyharness/sdk";

export function isWorkspaceDirectoryMissing(
  workspace: Pick<Workspace, "availability"> | null | undefined,
): boolean {
  return workspace?.availability === "workspace_directory_missing";
}
