import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useCommitGitMutation,
  useCreatePullRequestMutation,
  useCurrentPullRequestQuery,
  useGitStatusQuery,
  usePushGitMutation,
  useStageGitPathsMutation,
} from "@anyharness/sdk-react";
import type {
  CommitAction,
  CommitDialogDerivedState,
  CommitDialogStep,
  CommitGenerationConfig,
} from "@/lib/domain/workspaces/creation/commit-dialog-state";
import {
  deriveCommitDialogState,
} from "@/lib/domain/workspaces/creation/commit-dialog-state";
import type { PublishPullRequestDraft } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import { defaultPublishPullRequestDraft } from "@/lib/domain/workspaces/creation/publish-draft";
import { useRefreshPrStatuses } from "@/hooks/workspaces/cache/use-pr-status-refresh";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useCommitGeneration } from "@/hooks/workspaces/workflows/use-commit-generation";
import {
  executeCommitAction,
  executePrCreation,
  type CommitDialogActionDeps,
} from "@/hooks/workspaces/workflows/use-commit-dialog-actions";

export interface UseCommitDialogOptions {
  workspaceId: string | null;
  runtimeBlockedReason: string | null;
  repoDefaultBranch: string | null;
  /** Which step to start on (defaults to "actions"). */
  initialStep?: CommitDialogStep;
  enabled: boolean;
}

export interface CommitDialogState {
  /** Pure derived git state for rendering. */
  derived: CommitDialogDerivedState;
  /** Current dialog step. */
  step: CommitDialogStep;
  /** Currently focused action index. */
  focusedActionIndex: number;
  /** Commit message draft. */
  commitMessage: string;
  /** Include unstaged changes checkbox. */
  includeUnstaged: boolean;
  /** PR draft fields. */
  prDraft: PublishPullRequestDraft;
  /** Inline error (git failure, validation). */
  error: string | null;
  /** Data still loading. */
  isLoading: boolean;
  /** Mutation in progress. */
  isSubmitting: boolean;
  /** AI generation config (placeholder for follow-up wiring). */
  generation: CommitGenerationConfig;

  // Actions
  setCommitMessage: (value: string) => void;
  setIncludeUnstaged: (value: boolean) => void;
  setPrDraft: (draft: PublishPullRequestDraft) => void;
  setStep: (step: CommitDialogStep) => void;
  setFocusedActionIndex: (index: number) => void;
  moveFocus: (direction: "up" | "down") => void;
  executeAction: (action: CommitAction) => Promise<boolean>;
  executeFocusedAction: () => Promise<boolean>;
  goBackFromPr: () => void;
}

export function useCommitDialog({
  workspaceId,
  runtimeBlockedReason,
  repoDefaultBranch,
  initialStep = "actions",
  enabled,
}: UseCommitDialogOptions): CommitDialogState {
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [prDraft, setPrDraft] = useState<PublishPullRequestDraft>({
    title: "",
    body: "",
    baseBranch: "",
    draft: false,
  });
  const [step, setStep] = useState<CommitDialogStep>(initialStep);
  const [focusedActionIndex, setFocusedActionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const draftWorkspaceIdRef = useRef<string | null>(workspaceId);

  const { logicalWorkspaces } = useLogicalWorkspaces();
  const refreshPrStatuses = useRefreshPrStatuses();
  const sourceRoot = useMemo(() => {
    if (!workspaceId) return null;
    return logicalWorkspaces.find((w) => w.id === workspaceId)?.sourceRoot ?? null;
  }, [logicalWorkspaces, workspaceId]);
  const generation = useCommitGeneration(sourceRoot);

  const gitStatusQuery = useGitStatusQuery({ workspaceId, enabled });
  const currentPrEnabled = enabled && Boolean(gitStatusQuery.data?.currentBranch?.trim());
  const currentPrQuery = useCurrentPullRequestQuery({
    workspaceId,
    enabled: currentPrEnabled,
  });
  const stageMutation = useStageGitPathsMutation({ workspaceId });
  const commitMutation = useCommitGitMutation({ workspaceId });
  const pushMutation = usePushGitMutation({ workspaceId });
  const createPrMutation = useCreatePullRequestMutation({ workspaceId });

  const derived = useMemo(() => deriveCommitDialogState(
    { gitStatus: gitStatusQuery.data, existingPr: currentPrQuery.data?.pullRequest ?? null, runtimeBlockedReason },
    repoDefaultBranch,
  ), [gitStatusQuery.data, currentPrQuery.data?.pullRequest, runtimeBlockedReason, repoDefaultBranch]);

  const defaultPrDraft = useMemo(() => defaultPublishPullRequestDraft({
    gitStatus: gitStatusQuery.data, repoDefaultBranch,
  }), [gitStatusQuery.data, repoDefaultBranch]);

  useEffect(() => { // Reset drafts when workspace changes
    if (workspaceId && draftWorkspaceIdRef.current !== workspaceId) {
      draftWorkspaceIdRef.current = workspaceId;
      setCommitMessage("");
      setIncludeUnstaged(true);
      setPrDraft({ title: "", body: "", baseBranch: "", draft: false });
      setStep(initialStep);
      setFocusedActionIndex(0);
      setError(null);
    }
  }, [initialStep, workspaceId]);

  useEffect(() => { // Clamp focus index when available actions change
    if (focusedActionIndex >= derived.availableActions.length) {
      setFocusedActionIndex(Math.max(0, derived.availableActions.length - 1));
    }
  }, [derived.availableActions.length, focusedActionIndex]);

  const moveFocus = useCallback((direction: "up" | "down") => {
    setFocusedActionIndex((current) => {
      const max = derived.availableActions.length - 1;
      if (max < 0) return 0;
      if (direction === "up") return current <= 0 ? max : current - 1;
      return current >= max ? 0 : current + 1;
    });
  }, [derived.availableActions.length]);

  const actionDeps: CommitDialogActionDeps = useMemo(() => ({
    workspaceId,
    commitMessage,
    includeUnstaged,
    prDraft,
    defaultBaseBranch: defaultPrDraft.baseBranch,
    derived,
    generation,
    logicalWorkspaces,
    setCommitMessage,
    setPrDraft,
    setStep,
    setError,
    stageMutation,
    commitMutation,
    pushMutation,
    createPrMutation,
    gitStatusQuery,
    currentPrQuery,
    currentPrEnabled,
    refreshPrStatuses,
  }), [
    workspaceId,
    commitMessage,
    includeUnstaged,
    prDraft,
    defaultPrDraft.baseBranch,
    derived,
    generation,
    logicalWorkspaces,
    stageMutation,
    commitMutation,
    pushMutation,
    createPrMutation,
    gitStatusQuery,
    currentPrQuery,
    currentPrEnabled,
    refreshPrStatuses,
  ]);

  const executeAction = useCallback(
    (action: CommitAction) => executeCommitAction(action, actionDeps),
    [actionDeps],
  );

  const executePrCreationImpl = useCallback(
    () => executePrCreation(actionDeps),
    [actionDeps],
  );

  const executeFocusedAction = useCallback(async (): Promise<boolean> => {
    if (step === "pull_request") {
      return executePrCreationImpl();
    }
    const action = derived.availableActions[focusedActionIndex];
    if (!action) return false;
    return executeAction(action);
  }, [derived.availableActions, executeAction, executePrCreationImpl, focusedActionIndex, step]);

  const goBackFromPr = useCallback(() => {
    setStep("actions");
    setError(null);
  }, []);

  return {
    derived,
    step,
    focusedActionIndex,
    commitMessage,
    includeUnstaged,
    prDraft: {
      ...prDraft,
      baseBranch: prDraft.baseBranch.trim() || defaultPrDraft.baseBranch,
    },
    error,
    isLoading: gitStatusQuery.isLoading,
    isSubmitting: stageMutation.isPending || commitMutation.isPending
      || pushMutation.isPending || createPrMutation.isPending
      || generation.commitStatus === "generating" || generation.prStatus === "generating",
    generation: {
      generationAvailable: generation.available,
      commitStatus: generation.commitStatus,
      prStatus: generation.prStatus,
      generateCommitMessage: generation.available
        ? () => generation.generateCommitMessage(derived)
        : undefined,
      generatePrFields: generation.available
        ? () => generation.generatePrFields(derived)
        : undefined,
    },
    setCommitMessage,
    setIncludeUnstaged,
    setPrDraft,
    setStep,
    setFocusedActionIndex,
    moveFocus,
    executeAction,
    executeFocusedAction,
    goBackFromPr,
  };
}
