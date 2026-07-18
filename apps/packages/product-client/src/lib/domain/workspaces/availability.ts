import type { RepoRoot, Workspace } from "@anyharness/sdk";

export function isWorkspaceDirectoryMissing(
  workspace: Pick<Workspace, "availability"> | null | undefined,
): boolean {
  return workspace?.availability === "workspace_directory_missing";
}

export function canRestoreMissingWorktree(
  workspace: Pick<
    Workspace,
    "availability" | "kind" | "currentBranch" | "repoRootId"
  > | null | undefined,
  repoRoot: Pick<RepoRoot, "id" | "path"> | null | undefined,
): boolean {
  return workspace?.availability === "workspace_directory_missing"
    && workspace.kind === "worktree"
    && Boolean(
      workspace.currentBranch?.trim()
      && workspace.currentBranch.trim() !== "HEAD",
    )
    && repoRoot?.id === workspace.repoRootId
    && Boolean(repoRoot.path.trim());
}
