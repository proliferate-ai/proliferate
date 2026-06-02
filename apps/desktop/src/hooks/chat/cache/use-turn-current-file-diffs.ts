import type {
  GitChangedFile,
  GitDiffFile,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import {
  useGitBaseWorktreeDiffFilesQuery,
  useGitDiffQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { useMemo } from "react";
import { useIsHotPaintGatePendingForWorkspace } from "@/hooks/workspaces/derived/use-hot-paint-gate";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import {
  buildGitPanelSections,
  type GitPanelReviewFile,
  gitPanelRuntimeBlockWorkspaceId,
  repoRootDefaultBranch,
  resolveGitPanelBaseRef,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import { resolveDiffDisplayPolicy } from "@/lib/domain/workspaces/changes/diff-display-policy";
import { resolveGitPanelWorkspaceContext } from "@/lib/domain/workspaces/changes/git-panel-workspace-context";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { collectTurnTouchedFiles } from "@proliferate/product-domain/chats/transcript/last-turn-file-changes";

const EMPTY_STATUS_FILES: GitChangedFile[] = [];
const EMPTY_BRANCH_FILES: GitDiffFile[] = [];
const EMPTY_BASE_WORKTREE_FILES: GitDiffFile[] = [];
const DEFAULT_REVIEW_BASE_REF = "origin/main";

// Owns the current-git projection for the transcript turn diff card. The
// transcript supplies the touched-file filter; git supplies the rendered patch.
export function useTurnCurrentFileDiffs({
  turn,
  transcript,
  workspaceId,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  workspaceId: string | null;
}) {
  const selectedLogicalWorkspaceId = useSessionSelectionStore(
    (state) => state.selectedLogicalWorkspaceId,
  );
  const runtimeBlockWorkspaceId = gitPanelRuntimeBlockWorkspaceId(
    workspaceId,
    selectedLogicalWorkspaceId,
  );
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = workspaceId
    ? getWorkspaceRuntimeBlockReason(runtimeBlockWorkspaceId)
    : "Diffs are unavailable until a workspace is selected.";
  const isRuntimeReady = runtimeBlockedReason === null;
  const hotPaintPending = useIsHotPaintGatePendingForWorkspace(workspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaceContext = useMemo(
    () => resolveGitPanelWorkspaceContext(
      workspaceCollections,
      workspaceId,
      selectedLogicalWorkspaceId,
    ),
    [selectedLogicalWorkspaceId, workspaceCollections, workspaceId],
  );
  const savedDefaultBranch = useRepoPreferencesStore((state) => (
    workspaceContext.sourceRepoRootPath
      ? state.repoConfigs[workspaceContext.sourceRepoRootPath]?.defaultBranch ?? null
      : null
  ));
  const touchedFiles = useMemo(
    () => collectTurnTouchedFiles(turn, transcript),
    [transcript, turn],
  );
  const gitStatusQuery = useGitStatusQuery({
    workspaceId,
    enabled: isRuntimeReady && !hotPaintPending && touchedFiles.length > 0,
  });
  const baseRef = resolveGitPanelBaseRef({
    repoPreferenceDefaultBranch: savedDefaultBranch,
    repoRootDefaultBranch: repoRootDefaultBranch(workspaceContext.repoRoot),
    suggestedBaseBranch: gitStatusQuery.data?.suggestedBaseBranch ?? null,
  });
  const activeBaseRef = baseRef ?? DEFAULT_REVIEW_BASE_REF;
  const baseWorktreeFilesQuery = useGitBaseWorktreeDiffFilesQuery({
    workspaceId,
    baseRef: activeBaseRef,
    enabled:
      isRuntimeReady
      && !hotPaintPending
      && touchedFiles.length > 0,
  });
  const baseWorktreeFiles =
    baseWorktreeFilesQuery.data?.files ?? EMPTY_BASE_WORKTREE_FILES;
  const sections = useMemo(
    () => buildGitPanelSections({
      mode: "last_turn",
      statusFiles: EMPTY_STATUS_FILES,
      branchFiles: EMPTY_BRANCH_FILES,
      lastTurnFiles: touchedFiles,
      baseWorktreeFiles,
    }),
    [baseWorktreeFiles, touchedFiles],
  );
  const error = baseWorktreeFilesQuery.error ?? gitStatusQuery.error;

  return {
    activeWorkspaceId: workspaceId,
    baseRef: activeBaseRef,
    files: sections[0]?.files ?? [],
    isRuntimeReady,
    runtimeBlockedReason,
    isLoading: baseWorktreeFilesQuery.isLoading || gitStatusQuery.isLoading,
    errorMessage: error instanceof Error ? error.message : null,
  };
}

export function useTurnCurrentFilePatch({
  file,
  workspaceId,
  baseRef,
  enabled,
}: {
  file: GitPanelReviewFile;
  workspaceId: string | null;
  baseRef: string | null;
  enabled: boolean;
}) {
  const currentDiff = file.currentDiff;
  const metadataPolicy = useMemo(
    () => currentDiff
      ? resolveDiffDisplayPolicy({
          path: currentDiff.path,
          additions: currentDiff.additions,
          deletions: currentDiff.deletions,
        })
      : null,
    [currentDiff],
  );
  const diffQuery = useGitDiffQuery({
    workspaceId,
    path: file.path,
    scope: "base_worktree",
    baseRef,
    oldPath: file.oldPath,
    enabled:
      enabled
      && Boolean(currentDiff)
      && Boolean(metadataPolicy?.canFetchInline),
  });
  const additions = diffQuery.data?.additions ?? currentDiff?.additions ?? 0;
  const deletions = diffQuery.data?.deletions ?? currentDiff?.deletions ?? 0;
  const patch = diffQuery.data?.patch ?? null;
  const patchPolicy = useMemo(
    () => patch
      ? resolveDiffDisplayPolicy({
          path: file.path,
          additions,
          deletions,
          patch,
        })
      : metadataPolicy,
    [additions, deletions, file.path, metadataPolicy, patch],
  );

  return {
    currentDiff,
    metadataPolicy,
    diffQuery,
    diffErrorMessage: diffQuery.isError ? formatDiffErrorMessage(diffQuery.error) : null,
    additions,
    deletions,
    patch,
    patchPolicy,
  };
}

function formatDiffErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Failed to load diff";
}
