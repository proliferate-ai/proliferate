import type { GitChangedFile, GitDiffFile } from "@anyharness/sdk";
import {
  type AnyHarnessQueryTimingOptions,
  useGitBaseWorktreeDiffFilesQuery,
  useGitBranchDiffFilesQuery,
  useGitBranchesQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { useMemo } from "react";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
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
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { collectLatestCompletedTurnTouchedFiles } from "@/lib/domain/chat/transcript/last-turn-file-changes";

const EMPTY_STATUS_FILES: GitChangedFile[] = [];
const EMPTY_BRANCH_FILES: GitDiffFile[] = [];
const DEFAULT_REVIEW_BASE_REF = "origin/main";

interface GitPanelStateOptions {
  baseRefOverride?: string | null;
  statusTimingOptions?: AnyHarnessQueryTimingOptions;
  branchDiffFilesTimingOptions?: AnyHarnessQueryTimingOptions;
}

// Owns read-only Git panel state for changed-file surfaces. Git mutations stay
// in the component/action hooks that own the user intent.
export function useGitPanelState(
  mode: GitPanelMode,
  options?: GitPanelStateOptions,
) {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const activeTranscript = useSessionTranscriptStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.transcript ?? null : null
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
    ...(options?.statusTimingOptions ?? {}),
  });

  const baseRef = resolveGitPanelBaseRef({
    repoPreferenceDefaultBranch: savedDefaultBranch,
    repoRootDefaultBranch: repoRootDefaultBranch(workspaceContext.repoRoot),
    suggestedBaseBranch: gitStatusQuery.data?.suggestedBaseBranch ?? null,
  });
  const activeBaseRef = normalizeRefOverride(options?.baseRefOverride)
    ?? baseRef
    ?? DEFAULT_REVIEW_BASE_REF;

  const branchFilesQuery = useGitBranchDiffFilesQuery({
    workspaceId: activeWorkspaceId,
    baseRef: activeBaseRef,
    enabled: isRuntimeReady && !hotPaintPending && mode === "branch",
    ...(options?.branchDiffFilesTimingOptions ?? {}),
  });
  const lastTurnTouched = useMemo(
    () => collectLatestCompletedTurnTouchedFiles(activeTranscript),
    [activeTranscript],
  );
  const baseWorktreeFilesQuery = useGitBaseWorktreeDiffFilesQuery({
    workspaceId: activeWorkspaceId,
    baseRef: activeBaseRef,
    enabled: isRuntimeReady
      && !hotPaintPending
      && mode === "last_turn"
      && lastTurnTouched.files.length > 0,
    ...(options?.branchDiffFilesTimingOptions ?? {}),
  });
  const branchesQuery = useGitBranchesQuery({
    workspaceId: activeWorkspaceId,
    enabled: isRuntimeReady && !hotPaintPending,
  });

  const statusFiles = gitStatusQuery.data?.files ?? EMPTY_STATUS_FILES;
  const branchFiles = branchFilesQuery.data?.files ?? EMPTY_BRANCH_FILES;
  const baseWorktreeFiles = baseWorktreeFilesQuery.data?.files ?? EMPTY_BRANCH_FILES;
  const files = useMemo(
    () => buildGitPanelFiles({
      mode,
      statusFiles,
      branchFiles,
      lastTurnFiles: lastTurnTouched.files,
      baseWorktreeFiles,
    }),
    [baseWorktreeFiles, branchFiles, lastTurnTouched.files, mode, statusFiles],
  );
  const sections = useMemo(
    () => buildGitPanelSections({
      mode,
      statusFiles,
      branchFiles,
      lastTurnFiles: lastTurnTouched.files,
      baseWorktreeFiles,
    }),
    [baseWorktreeFiles, branchFiles, lastTurnTouched.files, mode, statusFiles],
  );
  const branchRefs = branchesQuery.data ?? [];

  const totalChangedCount = mode === "branch" || mode === "last_turn"
    ? sections.reduce((count, section) => count + section.files.length, 0)
    : countVisibleStatusFiles(statusFiles);
  const activeFilterLabel = gitPanelModeLabel(mode);
  const loading = mode === "branch"
    ? branchFilesQuery.isLoading
    : mode === "last_turn" && lastTurnTouched.files.length > 0
      ? baseWorktreeFilesQuery.isLoading
      : gitStatusQuery.isLoading;
  const error = mode === "branch"
    ? branchFilesQuery.error ?? gitStatusQuery.error
    : mode === "last_turn"
      ? baseWorktreeFilesQuery.error ?? gitStatusQuery.error
      : gitStatusQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;

  return {
    activeWorkspaceId,
    baseRef: activeBaseRef,
    detectedBaseRef: baseRef,
    branchRefs,
    files,
    sections,
    totalChangedCount,
    visibleChangedCount: mode === "working_tree_composite" || mode === "last_turn"
      ? sections.reduce((count, section) => count + section.files.length, 0)
      : files.length,
    activeFilterLabel,
    lastTurn: lastTurnTouched.turn,
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading: loading,
    errorMessage,
    refetch: async () => {
      await gitStatusQuery.refetch();
      await branchesQuery.refetch();
      if (mode === "branch") {
        await branchFilesQuery.refetch();
      }
      if (mode === "last_turn" && lastTurnTouched.files.length > 0) {
        await baseWorktreeFilesQuery.refetch();
      }
    },
  };
}

function normalizeRefOverride(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
