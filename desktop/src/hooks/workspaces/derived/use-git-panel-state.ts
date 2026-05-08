import type { GitChangedFile, GitDiffFile } from "@anyharness/sdk";
import {
  useGitBranchDiffFilesQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { useMemo } from "react";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/use-hot-paint-gate";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import {
  buildGitPanelFiles,
  buildGitPanelSections,
  countVisibleStatusFiles,
  gitPanelModeLabel,
  gitPanelRuntimeBlockWorkspaceId,
  repoRootDefaultBranch,
  resolveGitPanelBaseRef,
  type GitPanelMode,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import { resolveGitPanelWorkspaceContext } from "@/lib/domain/workspaces/changes/git-panel-workspace-context";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const EMPTY_STATUS_FILES: GitChangedFile[] = [];
const EMPTY_BRANCH_FILES: GitDiffFile[] = [];

// Owns read-only Git panel state for changed-file surfaces. Git mutations stay
// in the component/action hooks that own the user intent.
export function useGitPanelState(mode: GitPanelMode) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
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
  const sections = useMemo(
    () => buildGitPanelSections({ mode, statusFiles, branchFiles }),
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
    sections,
    totalChangedCount,
    visibleChangedCount: mode === "working_tree_composite"
      ? sections.reduce((count, section) => count + section.files.length, 0)
      : files.length,
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
