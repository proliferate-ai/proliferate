import type { GitChangedFile, GitDiffFile, RepoRoot, Workspace } from "@anyharness/sdk";
import {
  useGitBranchDiffFilesQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { useMemo } from "react";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  buildLogicalWorkspaces,
  findLogicalWorkspace,
} from "@/lib/domain/workspaces/logical-workspaces";
import {
  buildGitPanelFiles,
  countVisibleStatusFiles,
  gitPanelModeLabel,
  gitPanelRuntimeBlockWorkspaceId,
  repoRootDefaultBranch,
  resolveGitPanelBaseRef,
  sourceRootForGitPanel,
  type GitPanelMode,
} from "@/lib/domain/workspaces/git-panel-diff";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

const EMPTY_STATUS_FILES: GitChangedFile[] = [];
const EMPTY_BRANCH_FILES: GitDiffFile[] = [];

interface GitPanelWorkspaceContext {
  activeWorkspaceId: string | null;
  sourceRepoRootPath: string | null;
  repoRoot: RepoRoot | null;
}

export function useGitPanelState(mode: GitPanelMode) {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const activeWorkspaceId = selectedWorkspaceId;
  const runtimeBlockWorkspaceId = gitPanelRuntimeBlockWorkspaceId(
    selectedWorkspaceId,
    selectedLogicalWorkspaceId,
  );
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(runtimeBlockWorkspaceId);
  const isRuntimeReady = runtimeBlockedReason === null;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();

  const workspaceContext = useMemo(
    () => resolveGitPanelWorkspaceContext(
      workspaceCollections,
      selectedWorkspaceId,
      selectedLogicalWorkspaceId,
    ),
    [selectedLogicalWorkspaceId, selectedWorkspaceId, workspaceCollections],
  );

  const savedDefaultBranch = useRepoPreferencesStore((state) => (
    workspaceContext.sourceRepoRootPath
      ? state.repoConfigs[workspaceContext.sourceRepoRootPath]?.defaultBranch ?? null
      : null
  ));

  const gitStatusQuery = useGitStatusQuery({
    workspaceId: activeWorkspaceId,
    enabled: isRuntimeReady && !hotPaintPending,
  });

  const baseRef = resolveGitPanelBaseRef({
    repoPreferenceDefaultBranch: savedDefaultBranch,
    repoRootDefaultBranch: repoRootDefaultBranch(workspaceContext.repoRoot),
    suggestedBaseBranch: gitStatusQuery.data?.suggestedBaseBranch ?? null,
  });

  const branchFilesQuery = useGitBranchDiffFilesQuery({
    workspaceId: activeWorkspaceId,
    baseRef,
    enabled: isRuntimeReady && !hotPaintPending && mode === "branch",
  });

  const statusFiles = gitStatusQuery.data?.files ?? EMPTY_STATUS_FILES;
  const branchFiles = branchFilesQuery.data?.files ?? EMPTY_BRANCH_FILES;
  const files = useMemo(
    () => buildGitPanelFiles({ mode, statusFiles, branchFiles }),
    [branchFiles, mode, statusFiles],
  );

  const totalChangedCount = mode === "branch"
    ? files.length
    : countVisibleStatusFiles(statusFiles);
  const activeFilterLabel = gitPanelModeLabel(mode);
  const loading = mode === "branch"
    ? branchFilesQuery.isLoading
    : gitStatusQuery.isLoading;
  const error = mode === "branch"
    ? branchFilesQuery.error ?? gitStatusQuery.error
    : gitStatusQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;

  return {
    activeWorkspaceId,
    baseRef,
    files,
    totalChangedCount,
    visibleChangedCount: files.length,
    activeFilterLabel,
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading: loading,
    errorMessage,
    refetch: async () => {
      await gitStatusQuery.refetch();
      if (mode === "branch") {
        await branchFilesQuery.refetch();
      }
    },
  };
}

function resolveGitPanelWorkspaceContext(
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
      selectedWorkspace?.sourceRepoRootPath ?? repoRoot?.path ?? null,
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
