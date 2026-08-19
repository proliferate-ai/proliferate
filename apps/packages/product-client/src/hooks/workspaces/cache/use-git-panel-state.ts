import type { GitChangedFile, GitDiffFile } from "@anyharness/sdk";
import {
  type AnyHarnessQueryTimingOptions,
  useAdvanceGitCacheForceEpoch,
  useGitBaseWorktreeDiffFilesQuery,
  useGitBranchDiffFilesQuery,
  useGitBranchesQuery,
  useGitCacheForceEpoch,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIsHotPaintGatePendingForWorkspace } from "#product/hooks/workspaces/derived/use-hot-paint-gate";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import {
  buildGitPanelFiles,
  buildGitPanelSections,
  countVisibleStatusFiles,
  gitPanelModeLabel,
  gitPanelRuntimeBlockWorkspaceId,
  repoRootDefaultBranch,
  resolveGitPanelBaseRef,
  type GitPanelMode,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { resolveGitPanelWorkspaceContext } from "#product/lib/domain/workspaces/changes/git-panel-workspace-context";
import { useRepoPreferencesStore } from "#product/stores/preferences/repo-preferences-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { collectLatestCompletedTurnTouchedFiles } from "#product/domain/chats/transcript/last-turn-file-changes";
import { collectTurnFileRevertPatchEntries } from "#product/domain/chats/transcript/turn-file-patches";
import {
  buildChangesCacheGeneration,
  buildChangesMetadataFingerprint,
  buildChangesMetadataListCacheGeneration,
} from "#product/lib/domain/workspaces/changes/changes-cache-generation";
import { refreshGitPanelMetadata } from "#product/lib/workflows/workspaces/changes/refresh-git-panel-metadata";
import { observeChangesMetadata } from "#product/hooks/workspaces/cache/changes-cache-observation";

const EMPTY_STATUS_FILES: GitChangedFile[] = [];
const EMPTY_BRANCH_FILES: GitDiffFile[] = [];
const DEFAULT_REVIEW_BASE_REF = "origin/main";

interface GitPanelStateOptions {
  baseRefOverride?: string | null;
  statusTimingOptions?: AnyHarnessQueryTimingOptions;
  branchDiffFilesTimingOptions?: AnyHarnessQueryTimingOptions;
}

// Owns the composed Git panel cache, including its explicit refresh boundary.
// Git mutations stay in the access hooks that own the user intent.
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
  const queryClient = useQueryClient();
  const forceEpoch = useGitCacheForceEpoch({ workspaceId: activeWorkspaceId });
  const advanceForceEpoch = useAdvanceGitCacheForceEpoch({ workspaceId: activeWorkspaceId });
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
    staleTime: Infinity,
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

  const lastTurnTouched = useMemo(
    () => collectLatestCompletedTurnTouchedFiles(activeTranscript),
    [activeTranscript],
  );
  const lastTurnRevertPatches = useMemo(
    () => lastTurnTouched.turn && activeTranscript
      ? collectTurnFileRevertPatchEntries(lastTurnTouched.turn, activeTranscript)
      : { entries: [], blockedReason: null },
    [activeTranscript, lastTurnTouched.turn],
  );
  const branchFilesQuery = useGitBranchDiffFilesQuery({
    workspaceId: activeWorkspaceId,
    baseRef: activeBaseRef,
    cacheGeneration: buildChangesMetadataListCacheGeneration({ forceEpoch }),
    staleTime: Infinity,
    enabled: isRuntimeReady && !hotPaintPending && mode === "branch",
    ...(options?.branchDiffFilesTimingOptions ?? {}),
  });
  const baseWorktreeFilesQuery = useGitBaseWorktreeDiffFilesQuery({
    workspaceId: activeWorkspaceId,
    baseRef: activeBaseRef,
    cacheGeneration: buildChangesMetadataListCacheGeneration({
      forceEpoch,
      completedTurnId: lastTurnTouched.turn?.turnId ?? null,
    }),
    staleTime: Infinity,
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
  const evidenceKind = mode === "branch"
    ? "branch"
    : mode === "last_turn"
      ? "last_turn"
      : "working_tree";
  const generationMetadata = mode === "branch"
    ? branchFilesQuery.data
    : mode === "last_turn"
      ? baseWorktreeFilesQuery.data
      : gitStatusQuery.data;
  const semanticFingerprint = useMemo(
    () => buildChangesMetadataFingerprint(generationMetadata),
    [generationMetadata],
  );
  const observationToken = observeChangesMetadata({
    queryClient,
    scopeKey: `git-panel:${activeWorkspaceId ?? ""}:${evidenceKind}`,
    forceEpoch,
    semanticFingerprint,
  });
  const cacheGeneration = useMemo(() => {
    return buildChangesCacheGeneration({
      kind: evidenceKind,
      semanticFingerprint,
      observationToken,
      forceEpoch,
      completedTurnId: evidenceKind === "last_turn"
        ? lastTurnTouched.turn?.turnId ?? null
        : null,
    });
  }, [
    evidenceKind,
    forceEpoch,
    lastTurnTouched.turn?.turnId,
    observationToken,
    semanticFingerprint,
  ]);
  const metadataPending = mode === "branch"
    ? branchFilesQuery.isFetching || branchFilesQuery.isStale || branchFilesQuery.isError
    : mode === "last_turn"
      ? baseWorktreeFilesQuery.isFetching
        || baseWorktreeFilesQuery.isStale
        || baseWorktreeFilesQuery.isError
      : gitStatusQuery.isFetching || gitStatusQuery.isStale || gitStatusQuery.isError;

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
    ? branchFilesQuery.error ?? gitStatusQuery.error ?? branchesQuery.error
    : mode === "last_turn"
      ? baseWorktreeFilesQuery.error ?? gitStatusQuery.error ?? branchesQuery.error
      : gitStatusQuery.error ?? branchesQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;
  const refetch = useCallback(async () => {
    const refreshes: Array<() => Promise<{ isError: boolean }>> = [
      () => gitStatusQuery.refetch(),
      () => branchesQuery.refetch(),
    ];
    if (mode === "branch") {
      refreshes.push(() => branchFilesQuery.refetch());
    }
    if (mode === "last_turn" && lastTurnTouched.files.length > 0) {
      refreshes.push(() => baseWorktreeFilesQuery.refetch());
    }
    return refreshGitPanelMetadata({ refreshes, advanceForceEpoch });
  }, [
    advanceForceEpoch,
    baseWorktreeFilesQuery.refetch,
    branchFilesQuery.refetch,
    branchesQuery.refetch,
    gitStatusQuery.refetch,
    lastTurnTouched.files.length,
    mode,
  ]);

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
    cacheGeneration,
    metadataPending,
    lastTurn: lastTurnTouched.turn,
    lastTurnRevertPatches,
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading: loading,
    errorMessage,
    refetch,
  };
}

function normalizeRefOverride(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
