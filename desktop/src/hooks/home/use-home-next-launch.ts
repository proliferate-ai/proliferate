import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useCreateCloudWorkspace } from "@/hooks/cloud/use-create-cloud-workspace";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/use-cowork-thread-workflow";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import {
  isSessionModelAvailabilityCancelled,
  isSessionModelAvailabilityRoutedToSettings,
} from "@/hooks/sessions/use-session-model-availability-workflow";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import {
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingWorkspaceId,
  type ChatLaunchRetryMode,
} from "@/lib/domain/chat/launch-intent";
import {
  buildDeferredHomeLaunchId,
  useDeferredHomeLaunchStore,
} from "@/stores/home/deferred-home-launch-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { scheduleAfterNextPaint } from "@/lib/infra/schedule-after-next-paint";

interface HomeNextLaunchInput {
  text: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  target: HomeLaunchTarget;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modeOptions(modeId: string | null): { modeId?: string } {
  return modeId ? { modeId } : {};
}

function newLaunchId(): string {
  return crypto.randomUUID();
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    scheduleAfterNextPaint(resolve);
  });
}

function markLaunchIntentMaterializedFromPendingWorkspace(intentId: string): void {
  const activeIntent = useChatLaunchIntentStore.getState().activeIntent;
  if (!activeIntent || activeIntent.id !== intentId) {
    return;
  }

  const workspaceId = resolveLaunchIntentPendingWorkspaceId(
    activeIntent,
    useSessionSelectionStore.getState().pendingWorkspaceEntry,
  );
  if (!workspaceId) {
    return;
  }

  useChatLaunchIntentStore.getState().markMaterializedIfActive(intentId, {
    workspaceId,
  });
}

function launchFailureRetryMode(intentId: string): ChatLaunchRetryMode {
  const activeIntent = useChatLaunchIntentStore.getState().activeIntent;
  if (!activeIntent || activeIntent.id !== intentId) {
    return "safe";
  }

  const retryMode = resolveChatLaunchRetryMode(activeIntent);
  if (retryMode !== "safe") {
    return retryMode;
  }

  return resolveLaunchIntentPendingWorkspaceId(
    activeIntent,
    useSessionSelectionStore.getState().pendingWorkspaceEntry,
  )
    ? "manual_after_workspace"
    : "safe";
}

export function useHomeNextLaunch() {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const inFlightRef = useRef(false);
  const showToast = useToastStore((state) => state.show);
  const enqueueDeferredLaunch = useDeferredHomeLaunchStore((state) => state.enqueue);
  const beginLaunchIntent = useChatLaunchIntentStore((state) => state.begin);
  const clearLaunchIntentIfActive = useChatLaunchIntentStore((state) => state.clearIfActive);
  const failLaunchIntentIfActive = useChatLaunchIntentStore((state) => state.failIfActive);
  const markLaunchIntentMaterialized =
    useChatLaunchIntentStore((state) => state.markMaterializedIfActive);
  const markLaunchIntentSendAttempted =
    useChatLaunchIntentStore((state) => state.markSendAttemptedIfActive);
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const { promptSession } = useSessionPromptWorkflow();
  const { createSessionWithResolvedConfig } = useSessionActions();
  const {
    createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult,
  } = useWorkspaceEntryActions();
  const { createCloudWorkspaceAndEnterWithResult } = useCreateCloudWorkspace();
  const { selectWorkspace } = useWorkspaceSelection();

  const createFreshSession = useCallback(async (input: {
    workspaceId: string;
    modelSelection: HomeNextModelSelection;
    modeId: string | null;
    text: string;
    promptId: string;
    launchIntentId: string;
  }) => {
    await createSessionWithResolvedConfig({
      workspaceId: input.workspaceId,
      agentKind: input.modelSelection.kind,
      modelId: input.modelSelection.modelId,
      text: input.text,
      promptId: input.promptId,
      launchIntentId: input.launchIntentId,
      ...modeOptions(input.modeId),
    });
  }, [createSessionWithResolvedConfig]);

  const launch = useCallback(async ({
    text,
    modelSelection,
    modeId,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt || inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    setIsLaunching(true);
    const launchIntentId = newLaunchId();
    const promptId = newLaunchId();
    flushSync(() => {
      beginLaunchIntent({
        id: launchIntentId,
        catalogSnapshotId: null,
        agentKind: modelSelection.kind,
        modelId: modelSelection.modelId,
        modeId,
        launchControlValues: modeId ? { mode: modeId } : {},
        promptId,
        queuedPromptBlocks: [{ type: "text", text: prompt }],
        optimisticContentParts: [{ type: "text", text: prompt }],
        text: prompt,
        contentParts: [{ type: "text", text: prompt }],
        targetKind: target.kind,
        retryInput: {
          text: prompt,
          modelSelection,
          modeId,
          target,
        },
        materializedWorkspaceId: null,
        materializedSessionId: null,
        createdAt: Date.now(),
        sendAttemptedAt: null,
        failure: null,
      });
      navigate("/");
    });
    await waitForNextPaint();

    try {
      if (target.kind === "cowork") {
        const result = await createThreadFromSelection({
          agentKind: modelSelection.kind,
          modelId: modelSelection.modelId,
          modeId,
          draftText: null,
          sourceWorkspaceId: null,
        });
        if (!result) {
          throw new Error("Cowork thread creation was interrupted.");
        }
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId: result.workspace.id,
          sessionId: result.session.id,
        });

        await promptSession({
          sessionId: result.session.id,
          text: prompt,
          workspaceId: result.workspace.id,
          promptId,
          onBeforeOptimisticPrompt: () => {
            markLaunchIntentSendAttempted(launchIntentId);
          },
        });
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      if (target.kind === "local") {
        const workspaceId = target.existingWorkspaceId
          ? target.existingWorkspaceId
          : (await createLocalWorkspaceAndEnterWithResult(target.sourceRoot, {
            repoGroupKeyToExpand: target.sourceRoot,
          })).workspaceId;
        if (!target.existingWorkspaceId) {
          markLaunchIntentMaterialized(launchIntentId, {
            workspaceId,
          });
        }
        if (target.existingWorkspaceId) {
          await selectWorkspace(workspaceId, { force: true });
        }
        await createFreshSession({
          workspaceId,
          modelSelection,
          modeId,
          text: prompt,
          promptId,
          launchIntentId,
        });
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      if (target.kind === "worktree") {
        const { workspaceId } = await createWorktreeAndEnterWithResult({
          repoRootId: target.repoRootId,
          sourceWorkspaceId: target.sourceWorkspaceId,
          baseBranch: target.baseBranch,
        });
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId,
        });
        await createFreshSession({
          workspaceId,
          modelSelection,
          modeId,
          text: prompt,
          promptId,
          launchIntentId,
        });
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      const latencyFlowId = startLatencyFlow({
        flowKind: "cloud_workspace_create",
        source: "home",
      });
      const result = await createCloudWorkspaceAndEnterWithResult(
        {
          gitOwner: target.gitOwner,
          gitRepoName: target.gitRepoName,
          baseBranch: target.baseBranch,
        },
        { latencyFlowId },
      );
      if (result.status === "interrupted") {
        failLatencyFlow(latencyFlowId, "cloud_workspace_create_interrupted");
        throw new Error("Cloud workspace creation was interrupted.");
      }
      if (result.status === "ready") {
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId: result.workspaceId,
        });
        await createFreshSession({
          workspaceId: result.workspaceId,
          modelSelection,
          modeId,
          text: prompt,
          promptId,
          launchIntentId,
        });
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }
      markLaunchIntentMaterialized(launchIntentId, {
        workspaceId: result.workspaceId,
      });

      enqueueDeferredLaunch({
        id: buildDeferredHomeLaunchId({
          cloudWorkspaceId: result.cloudWorkspaceId,
          attemptId: result.attemptId,
        }),
        status: "pending",
        workspaceId: result.workspaceId,
        cloudWorkspaceId: result.cloudWorkspaceId,
        cloudAttemptId: result.attemptId,
        agentKind: modelSelection.kind,
        modelId: modelSelection.modelId,
        modeId,
        promptText: prompt,
        promptId,
        launchIntentId,
        createdAt: Date.now(),
      });
      showToast("Prompt queued. It will send when the cloud workspace is ready.", "info");
      return true;
    } catch (error) {
      if (isSessionModelAvailabilityCancelled(error)) {
        clearLaunchIntentIfActive(launchIntentId);
        return false;
      }
      if (isSessionModelAvailabilityRoutedToSettings(error)) {
        markLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
        failLaunchIntentIfActive(launchIntentId, {
          message: error.message,
          retryMode: launchFailureRetryMode(launchIntentId),
        });
        return false;
      }
      markLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
      failLaunchIntentIfActive(launchIntentId, {
        message: errorMessage(error),
        retryMode: launchFailureRetryMode(launchIntentId),
      });
      showToast(`Failed to start work: ${errorMessage(error)}`);
      return false;
    } finally {
      inFlightRef.current = false;
      setIsLaunching(false);
    }
  }, [
    beginLaunchIntent,
    clearLaunchIntentIfActive,
    createCloudWorkspaceAndEnterWithResult,
    createFreshSession,
    createLocalWorkspaceAndEnterWithResult,
    createThreadFromSelection,
    createWorktreeAndEnterWithResult,
    enqueueDeferredLaunch,
    failLaunchIntentIfActive,
    markLaunchIntentMaterialized,
    markLaunchIntentSendAttempted,
    navigate,
    promptSession,
    selectWorkspace,
    showToast,
  ]);

  return {
    isLaunching,
    launch,
  };
}
