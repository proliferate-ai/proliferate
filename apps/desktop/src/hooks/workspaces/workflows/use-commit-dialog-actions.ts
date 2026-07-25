import { toast } from "@proliferate/ui/kit/Sonner";
import type {
  CommitAction,
  CommitDialogDerivedState,
} from "@/lib/domain/workspaces/creation/commit-dialog-state";
import {
  validateCommitAction,
  validatePrCreation,
} from "@/lib/domain/workspaces/creation/commit-dialog-state";
import type { PublishPullRequestDraft } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import type { CommitGenerationState } from "@/hooks/workspaces/workflows/use-commit-generation";
import { openExternal } from "@/lib/access/tauri/shell";
import { recordCreatedPr } from "@/hooks/workspaces/workflows/record-created-pr";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import type { CreatePullRequestResponse } from "@anyharness/sdk";

/**
 * Internal action executors for the commit dialog.
 * Split from use-commit-dialog.ts to keep file length under 400 lines.
 */

export interface CommitDialogActionDeps {
  workspaceId: string | null;
  commitMessage: string;
  includeUnstaged: boolean;
  prDraft: PublishPullRequestDraft;
  defaultBaseBranch: string;
  derived: CommitDialogDerivedState;
  generation: CommitGenerationState;
  logicalWorkspaces: LogicalWorkspace[];
  setCommitMessage: (value: string) => void;
  setPrDraft: (draft: PublishPullRequestDraft | ((prev: PublishPullRequestDraft) => PublishPullRequestDraft)) => void;
  setStep: (step: "actions" | "pull_request") => void;
  setError: (error: string | null) => void;
  stageMutation: { mutateAsync: (paths: string[]) => Promise<unknown> };
  commitMutation: { mutateAsync: (args: { summary: string }) => Promise<unknown> };
  pushMutation: { mutateAsync: (args: Record<string, never>) => Promise<unknown> };
  createPrMutation: {
    mutateAsync: (args: {
      title: string;
      body?: string;
      baseBranch: string;
      draft: boolean;
    }) => Promise<CreatePullRequestResponse>;
  };
  gitStatusQuery: { refetch: () => Promise<unknown> };
  currentPrQuery: { refetch: () => Promise<unknown> };
  currentPrEnabled: boolean;
  refreshPrStatuses: (repoRootId: string) => void;
}

export async function executeCommitAction(
  action: CommitAction,
  deps: CommitDialogActionDeps,
): Promise<boolean> {
  const {
    commitMessage,
    includeUnstaged,
    derived,
    generation,
    setCommitMessage,
    setError,
    stageMutation,
    commitMutation,
    pushMutation,
    gitStatusQuery,
    currentPrQuery,
    currentPrEnabled,
  } = deps;

  setError(null);

  // Handle "create_pr" — transition to PR step
  if (action === "create_pr") {
    if (derived.existingPr) {
      // This shouldn't happen (action not available when PR exists)
      return false;
    }
    deps.setStep("pull_request");
    return false; // Not done — just transitioned
  }

  // Determine if we can auto-generate a commit message for empty input
  const needsCommit = (action === "commit" || action === "commit_and_push") && derived.hasDirtyTree;
  const messageEmpty = !commitMessage.trim();
  const canAutoGenerate = messageEmpty && needsCommit && generation.available;

  // Validate commit inputs (allow empty when generation will fill it)
  const commitValidation = validateCommitAction({
    action,
    commitMessage,
    includeUnstaged,
    hasStagedChanges: derived.hasStagedChanges,
    hasUnstagedChanges: derived.hasUnstagedChanges,
    hasDirtyTree: derived.hasDirtyTree,
    allowEmptyForGeneration: canAutoGenerate,
  });
  if (commitValidation) {
    setError(commitValidation);
    return false;
  }

  try {
    // If message is empty and generation is available, generate first
    let resolvedMessage = commitMessage.trim();
    if (canAutoGenerate) {
      const generated = await generation.generateCommitMessage(derived);
      if (!generated) {
        // Generation failed — require manual input
        setError("Could not generate a commit message. Enter one manually.");
        return false;
      }
      resolvedMessage = generated;
      setCommitMessage(generated);
    }

    if (needsCommit) {
      // Stage unstaged files if needed
      if (includeUnstaged) {
        const paths = [
          ...derived.fileGroups.unstaged.map((f) => f.path),
          ...derived.fileGroups.partial.map((f) => f.path),
        ];
        if (paths.length > 0) {
          await stageMutation.mutateAsync(paths);
        }
      }
      await commitMutation.mutateAsync({ summary: resolvedMessage });
    }

    const needsPush = action === "commit_and_push" || action === "push";
    if (needsPush) {
      await pushMutation.mutateAsync({});
    }

    await Promise.all([
      gitStatusQuery.refetch(),
      currentPrEnabled ? currentPrQuery.refetch() : Promise.resolve(),
    ]);

    // Toast confirmation before resetting state
    const toastMessage = action === "commit_and_push"
      ? "Committed and pushed"
      : action === "push"
        ? "Pushed"
        : "Committed";
    toast(toastMessage, { duration: 3000 });

    // Reset state after success
    setCommitMessage("");
    setError(null);
    return true;
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
    return false;
  }
}

export async function executePrCreation(
  deps: CommitDialogActionDeps,
): Promise<boolean> {
  const {
    workspaceId,
    commitMessage,
    includeUnstaged,
    prDraft,
    defaultBaseBranch,
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
  } = deps;

  const resolvedBaseBranch = prDraft.baseBranch.trim() || defaultBaseBranch;

  // If title is empty and generation is available, auto-generate PR fields
  let resolvedTitle = prDraft.title.trim();
  let resolvedBody = prDraft.body.trim();
  if (!resolvedTitle && generation.available) {
    const generated = await generation.generatePrFields(derived);
    if (!generated) {
      setError("Could not generate PR details. Enter a title manually.");
      return false;
    }
    resolvedTitle = generated.title;
    resolvedBody = resolvedBody || generated.body;
    setPrDraft((prev) => ({ ...prev, title: resolvedTitle, body: resolvedBody }));
  }

  const validation = validatePrCreation({
    title: resolvedTitle,
    baseBranch: resolvedBaseBranch,
    branchName: derived.branchName,
  });
  if (validation) {
    setError(validation);
    return false;
  }

  setError(null);

  try {
    // If there are dirty changes or unpushed commits, commit+push first
    if (derived.hasDirtyTree) {
      const canAutoGenCommit = !commitMessage.trim() && generation.available;
      const commitValidation = validateCommitAction({
        action: "commit_and_push",
        commitMessage,
        includeUnstaged,
        hasStagedChanges: derived.hasStagedChanges,
        hasUnstagedChanges: derived.hasUnstagedChanges,
        hasDirtyTree: derived.hasDirtyTree,
        allowEmptyForGeneration: canAutoGenCommit,
      });
      if (commitValidation) {
        setError(commitValidation);
        return false;
      }

      let resolvedCommitMsg = commitMessage.trim();
      if (!resolvedCommitMsg && canAutoGenCommit) {
        const generated = await generation.generateCommitMessage(derived);
        if (!generated) {
          setError("Could not generate a commit message. Enter one manually.");
          return false;
        }
        resolvedCommitMsg = generated;
        setCommitMessage(generated);
      }

      if (includeUnstaged) {
        const paths = [
          ...derived.fileGroups.unstaged.map((f) => f.path),
          ...derived.fileGroups.partial.map((f) => f.path),
        ];
        if (paths.length > 0) {
          await stageMutation.mutateAsync(paths);
        }
      }
      await commitMutation.mutateAsync({ summary: resolvedCommitMsg });
      await pushMutation.mutateAsync({});
    } else if (derived.hasUnpushedCommits) {
      await pushMutation.mutateAsync({});
    }

    const response = await createPrMutation.mutateAsync({
      title: resolvedTitle,
      body: resolvedBody || undefined,
      baseBranch: resolvedBaseBranch,
      draft: prDraft.draft,
    });

    // Persist the created PR so the UI doesn't flap
    recordCreatedPr(workspaceId, response, logicalWorkspaces, refreshPrStatuses);

    await Promise.all([
      gitStatusQuery.refetch(),
      currentPrEnabled ? currentPrQuery.refetch() : Promise.resolve(),
    ]);

    // Toast with action to open the PR in browser
    const prNumber = response.pullRequest?.number;
    const prUrl = response.pullRequest?.url;
    toast(prNumber ? `Pull request #${prNumber} created` : "Pull request created", {
      duration: 5000,
      action: prUrl
        ? { label: "Open", onClick: () => { void openExternal(prUrl); } }
        : undefined,
    });

    setCommitMessage("");
    setPrDraft({ title: "", body: "", baseBranch: "", draft: false });
    setStep("actions");
    setError(null);
    return true;
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
    return false;
  }
}
