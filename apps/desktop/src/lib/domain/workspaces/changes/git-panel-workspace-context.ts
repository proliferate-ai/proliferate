import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import {
  buildLogicalWorkspaces,
} from "@/lib/domain/workspaces/cloud/logical-workspaces";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { sourceRootForGitPanel } from "@/lib/domain/workspaces/changes/git-panel-diff";

export interface GitPanelWorkspaceContext {
  activeWorkspaceId: string | null;
  sourceRepoRootPath: string | null;
  repoRoot: RepoRoot | null;
}

export function resolveGitPanelWorkspaceContext(
  workspaceCollections: WorkspaceCollections | undefined,
  selectedWorkspaceId: string | null,
  selectedLogicalWorkspaceId: string | null,
): GitPanelWorkspaceContext {
  const activeWorkspaceId = selectedLogicalWorkspaceId ?? selectedWorkspaceId;
  if (!workspaceCollections || !activeWorkspaceId) {
    return {
      activeWorkspaceId,
      sourceRepoRootPath: null,
      repoRoot: null,
    };
  }

  if (selectedLogicalWorkspaceId) {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: workspaceCollections.localWorkspaces,
      repoRoots: workspaceCollections.repoRoots,
      cloudWorkspaces: workspaceCollections.cloudWorkspaces,
      currentSelectionId: selectedWorkspaceId,
    });
    const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, selectedLogicalWorkspaceId);
    if (logicalWorkspace) {
      return {
        activeWorkspaceId,
        sourceRepoRootPath: sourceRootForGitPanel(
          logicalWorkspace.sourceRoot,
          logicalWorkspace.localWorkspace?.path ?? null,
        ),
        repoRoot: logicalWorkspace.repoRoot,
      };
    }
  }

  const selectedWorkspace = findWorkspace(workspaceCollections.workspaces, selectedWorkspaceId);
  const repoRoot = findRepoRoot(workspaceCollections.repoRoots, selectedWorkspace);

  return {
    activeWorkspaceId,
    sourceRepoRootPath: sourceRootForGitPanel(
      repoRoot?.path ?? null,
      selectedWorkspace?.path ?? null,
    ),
    repoRoot,
  };
}

function findWorkspace(
  workspaces: readonly Workspace[],
  workspaceId: string | null,
): Workspace | null {
  if (!workspaceId) {
    return null;
  }
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

function findRepoRoot(
  repoRoots: readonly RepoRoot[],
  workspace: Workspace | null,
): RepoRoot | null {
  if (!workspace?.repoRootId) {
    return null;
  }
  return repoRoots.find((repoRoot) => repoRoot.id === workspace.repoRootId) ?? null;
}
