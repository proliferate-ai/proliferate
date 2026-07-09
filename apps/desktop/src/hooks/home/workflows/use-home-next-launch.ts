import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateCloudWorkspace } from "@/hooks/cloud/workflows/use-create-cloud-workspace";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useHomeNextLaunchPromptActions } from "@/hooks/home/workflows/use-home-next-launch-prompt-actions";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import {
  buildDeferredHomeLaunchId,
  useDeferredHomeLaunchStore,
} from "@/stores/home/deferred-home-launch-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import {
  buildHomePendingWorkspaceInitialSession,
  buildResolvedHomeLaunchControlValues,
  homeLaunchFailureRetryMode,
  homeNextLaunchErrorMessage,
  markHomeLaunchIntentMaterializedFromPendingWorkspace,
  newHomeNextLaunchId,
} from "@/hooks/home/workflows/home-next-launch-intent";

interface HomeNextLaunchInput {
  text: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues?: Record<string, string>;
  target: HomeLaunchTarget;
}

// Owns the Home Next submit action. Does not own read-only selection state or deferred launch replay.
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
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const {
    promptExistingSession,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
  } = useHomeNextLaunchPromptActions();
  const {
    createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult,
  } = useWorkspaceEntryActions();
  const { createCloudWorkspaceAndEnterWithResult } = useCreateCloudWorkspace();
  const { selectWorkspace } = useWorkspaceSelection();

  const launch = useCallback(async ({
    text,
    modelSelection,
    modeId,
    launchControlValues,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt || inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    setIsLaunching(true);
    const launchIntentId = newHomeNextLaunchId();
    const promptId = newHomeNextLaunchId();
    const resolvedLaunchControlValues = buildResolvedHomeLaunchControlValues({
      modeId,
      launchControlValues,
    });
    const initialSession = buildHomePendingWorkspaceInitialSession({
      modelSelection,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
    });
    beginLaunchIntent({
      id: launchIntentId,
      catalogSnapshotId: null,
      agentKind: modelSelection.kind,
      modelId: modelSelection.modelId,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
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
        launchControlValues: resolvedLaunchControlValues,
        target,
      },
      materializedWorkspaceId: null,
      materializedSessionId: null,
      createdAt: Date.now(),
      sendAttemptedAt: null,
      failure: null,
    });

    try {
      if (target.kind === "cowork") {
        const resultPromise = createThreadFromSelection({
          agentKind: modelSelection.kind,
          modelId: modelSelection.modelId,
          modeId,
          launchControlValues: resolvedLaunchControlValues,
          draftText: null,
          sourceWorkspaceId: null,
        });
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          promptId,
          launchIntentId,
          waitUntil: resultPromise,
        });
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const result = await resultPromise;
        if (!result) {
          throw new Error("Cowork thread creation was interrupted.");
        }
        if (!queuedProjectedSessionId) {
          navigate("/");
        }
        const projectedSessionId = queuedProjectedSessionId ?? result.projectedSessionId ?? null;
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId: result.workspace.id,
          sessionId: result.session.id,
          clientSessionId: projectedSessionId,
        });

        if (!queuedProjectedSessionId) {
          await promptExistingSession({
            sessionId: projectedSessionId ?? result.session.id,
            text: prompt,
            workspaceId: result.workspace.id,
            promptId,
            launchIntentId,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      if (target.kind === "local") {
        const createdWorkspacePromise = target.existingWorkspaceId
          ? null
          : createLocalWorkspaceAndEnterWithResult(target.sourceRoot, {
            repoGroupKeyToExpand: target.sourceRoot,
            initialSession,
          });
        const queuedProjectedSessionId = createdWorkspacePromise
          ? await promptProjectedPendingWorkspaceSession({
            text: prompt,
            promptId,
            launchIntentId,
            waitUntil: createdWorkspacePromise,
          })
          : null;
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const createdWorkspace = createdWorkspacePromise
          ? await createdWorkspacePromise
          : null;
        const workspaceId = target.existingWorkspaceId ?? createdWorkspace?.workspaceId;
        if (!workspaceId) {
          throw new Error("Workspace creation was interrupted.");
        }
        if (!queuedProjectedSessionId) {
          navigate("/");
        }
        const projectedSessionId =
          queuedProjectedSessionId ?? createdWorkspace?.projectedSessionId ?? null;
        if (!target.existingWorkspaceId) {
          markLaunchIntentMaterialized(launchIntentId, {
            workspaceId,
            clientSessionId: projectedSessionId,
          });
        }
        if (target.existingWorkspaceId) {
          await selectWorkspace(workspaceId, { force: true });
        }
        if (!queuedProjectedSessionId) {
          await promptProjectedOrCreateFreshSession({
            workspaceId,
            projectedSessionId,
            modelSelection,
            modeId,
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            promptId,
            launchIntentId,
            allowFreshFallback: target.existingWorkspaceId !== null,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      if (target.kind === "worktree") {
        const createdWorkspacePromise = createWorktreeAndEnterWithResult({
          repoRootId: target.repoRootId,
          sourceWorkspaceId: target.sourceWorkspaceId,
          baseBranch: target.baseBranch,
          defaultBranch: target.defaultBranch,
        }, {
          initialSession,
        });
        const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
          text: prompt,
          promptId,
          launchIntentId,
          waitUntil: createdWorkspacePromise,
        });
        if (queuedProjectedSessionId) {
          navigate("/");
        }
        const { workspaceId, projectedSessionId: createdProjectedSessionId } =
          await createdWorkspacePromise;
        if (!queuedProjectedSessionId) {
          navigate("/");
        }
        const projectedSessionId = queuedProjectedSessionId ?? createdProjectedSessionId;
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId,
          clientSessionId: projectedSessionId,
        });
        if (!queuedProjectedSessionId) {
          await promptProjectedOrCreateFreshSession({
            workspaceId,
            projectedSessionId,
            modelSelection,
            modeId,
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            promptId,
            launchIntentId,
            allowFreshFallback: false,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }

      const latencyFlowId = startLatencyFlow({
        flowKind: "cloud_workspace_create",
        source: "home",
      });
      const resultPromise = createCloudWorkspaceAndEnterWithResult(
        {
          gitOwner: target.gitOwner,
          gitRepoName: target.gitRepoName,
          baseBranch: target.baseBranch,
        },
          {
            latencyFlowId,
            initialSession,
          },
        );
      const queuedProjectedSessionId = await promptProjectedPendingWorkspaceSession({
        text: prompt,
        promptId,
        launchIntentId,
        waitUntil: resultPromise,
      });
      if (queuedProjectedSessionId) {
        navigate("/");
      }
      const result = await resultPromise;
      if (result.status === "interrupted") {
        failLatencyFlow(latencyFlowId, "cloud_workspace_create_interrupted");
        // Prefer the resolved server message (e.g. a billing gate 402) so the
        // toast shows why the launch failed instead of a generic string.
        throw new Error(result.failureMessage ?? "Cloud workspace creation was interrupted.");
      }
      if (!queuedProjectedSessionId) {
        navigate("/");
      }
      if (result.status === "ready") {
        const projectedSessionId = queuedProjectedSessionId ?? result.projectedSessionId;
        markLaunchIntentMaterialized(launchIntentId, {
          workspaceId: result.workspaceId,
          clientSessionId: projectedSessionId,
        });
        if (!queuedProjectedSessionId) {
          await promptProjectedOrCreateFreshSession({
            workspaceId: result.workspaceId,
            projectedSessionId,
            modelSelection,
            modeId,
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            promptId,
            launchIntentId,
            allowFreshFallback: false,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        return true;
      }
      const projectedSessionId = queuedProjectedSessionId ?? result.projectedSessionId;
      markLaunchIntentMaterialized(launchIntentId, {
        workspaceId: result.workspaceId,
        clientSessionId: projectedSessionId,
      });

      if (projectedSessionId) {
        if (!queuedProjectedSessionId) {
          await promptProjectedOrCreateFreshSession({
            workspaceId: result.workspaceId,
            projectedSessionId,
            modelSelection,
            modeId,
            launchControlValues: resolvedLaunchControlValues,
            text: prompt,
            promptId,
            launchIntentId,
            allowFreshFallback: false,
          });
        }
        clearLaunchIntentIfActive(launchIntentId);
        showToast("Prompt queued. It will send when the cloud workspace is ready.", "info");
        return true;
      }

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
        launchControlValues: resolvedLaunchControlValues,
        promptText: prompt,
        promptId,
        launchIntentId,
        createdAt: Date.now(),
      });
      showToast("Prompt queued. It will send when the cloud workspace is ready.", "info");
      return true;
    } catch (error) {
      markHomeLaunchIntentMaterializedFromPendingWorkspace(launchIntentId);
      failLaunchIntentIfActive(launchIntentId, {
        message: homeNextLaunchErrorMessage(error),
        retryMode: homeLaunchFailureRetryMode(launchIntentId),
      });
      showToast(`Failed to start work: ${homeNextLaunchErrorMessage(error)}`);
      return false;
    } finally {
      inFlightRef.current = false;
      setIsLaunching(false);
    }
  }, [
    beginLaunchIntent,
    clearLaunchIntentIfActive,
    createCloudWorkspaceAndEnterWithResult,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
    createLocalWorkspaceAndEnterWithResult,
    createThreadFromSelection,
    createWorktreeAndEnterWithResult,
    enqueueDeferredLaunch,
    failLaunchIntentIfActive,
    markLaunchIntentMaterialized,
    navigate,
    promptExistingSession,
    selectWorkspace,
    showToast,
  ]);

  return {
    isLaunching,
    launch,
  };
}
