import type {
  ArchiveWorkspaceRequest,
  RepoRoot,
  UnarchiveWorkspaceRequest,
  Workspace,
  WorkspaceUnarchiveBranchStrategy,
} from "@anyharness/sdk";
import type { RepoConfig } from "#product/lib/domain/preferences/repo-preferences";

/**
 * The click-time knob resolution the ADR requires: never captured at mount,
 * re-resolved on every archive/unarchive so a re-POST that converges an
 * interrupted attempt carries the current values, not stale ones.
 *
 * `sourceRoot` is resolved from the workspace's `repoRootId` through the
 * collections' `repoRoots` to `repoRoot.path`, falling back to
 * `workspace.path` — the same resolution
 * `use-workspace-creation-receipt.ts` performs for `setupScript`.
 */
export function resolveArchiveKnobSourceRoot(
  workspace: Pick<Workspace, "repoRootId" | "path"> | null,
  repoRoots: readonly RepoRoot[],
): string | null {
  if (!workspace) {
    return null;
  }
  const repoRoot = repoRoots.find((candidate) => candidate.id === workspace.repoRootId);
  const repoRootPath = repoRoot?.path?.trim();
  if (repoRootPath) {
    return repoRootPath;
  }
  return workspace.path?.trim() || null;
}

export function resolveArchiveWorkspaceRequest(inputs: {
  workspace: Pick<Workspace, "repoRootId" | "path"> | null;
  repoRoots: readonly RepoRoot[];
  repoConfigs: Record<string, RepoConfig>;
  deleteBranchOnArchive: boolean;
}): ArchiveWorkspaceRequest {
  const sourceRoot = resolveArchiveKnobSourceRoot(inputs.workspace, inputs.repoRoots);
  const repoConfig = sourceRoot ? inputs.repoConfigs[sourceRoot] : undefined;
  return {
    deleteBranch: inputs.deleteBranchOnArchive,
    archiveScript: repoConfig?.archiveScript ?? "",
  };
}

export interface UnarchiveScenarioAnswer {
  branchStrategy?: WorkspaceUnarchiveBranchStrategy;
  overwrite?: boolean;
}

export function resolveUnarchiveWorkspaceRequest(inputs: {
  workspace: Pick<Workspace, "repoRootId" | "path"> | null;
  repoRoots: readonly RepoRoot[];
  repoConfigs: Record<string, RepoConfig>;
  answer?: UnarchiveScenarioAnswer;
}): UnarchiveWorkspaceRequest {
  const sourceRoot = resolveArchiveKnobSourceRoot(inputs.workspace, inputs.repoRoots);
  const repoConfig = sourceRoot ? inputs.repoConfigs[sourceRoot] : undefined;
  return {
    rerunSetup: repoConfig?.rerunSetupOnUnarchive ?? true,
    setupScript: repoConfig?.setupScript ?? "",
    ...(inputs.answer?.branchStrategy ? { branchStrategy: inputs.answer.branchStrategy } : {}),
    ...(inputs.answer?.overwrite ? { overwrite: true } : {}),
  };
}
