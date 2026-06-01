import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateCloudWorkspace } from "@/hooks/cloud/workflows/use-create-cloud-workspace";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/workflows/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/workflows/selection/use-workspace-selection";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import {
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingWorkspaceId,
  type ChatLaunchRetryMode,
} from "@/lib/domain/chat/launch/launch-intent";
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
} from "@/lib/infra/measurement/latency-flow";
import type { PendingWorkspaceInitialSession } from "@/lib/domain/workspaces/creation/pending-entry";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import { getSessionRecord } from "@/stores/sessions/session-records";

interface HomeNextLaunchInput {
  text: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues?: Record<string, string>;
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

function resolveProjectedPendingWorkspaceSession(): {
  sessionId: string;
  workspaceId: string;
} | null {
  const selection = useSessionSelectionStore.getState();
  const entry = selection.pendingWorkspaceEntry;
  const activeSessionId = selection.activeSessionId;
  if (!entry || !activeSessionId) {
    return null;
  }

  const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
  const record = getSessionRecord(activeSessionId);
  if (record?.workspaceId !== pendingWorkspaceUiKey) {
    return null;
  }

  return {
    sessionId: activeSessionId,
    workspaceId: pendingWorkspaceUiKey,
  };
}

function waitForProjectedPendingWorkspaceSession(
  stopWhen: Promise<unknown>,
): Promise<{
  sessionId: string;
  workspaceId: string;
} | null> {
  const existing = resolveProjectedPendingWorkspaceSession();
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let resolved = false;
    let unsubscribe: () => void = () => {};
    const finish = (projected: ReturnType<typeof resolveProjectedPendingWorkspaceSession>) => {
      if (resolved) {
        return;
      }
      resolved = true;
      unsubscribe();
      resolve(projected);
    };
    unsubscribe = useSessionSelectionStore.subscribe(() => {
      const projected = resolveProjectedPendingWorkspaceSession();
      if (projected) {
        finish(projected);
      }
    });
    void stopWhen.then(
      () => finish(resolveProjectedPendingWorkspaceSession()),
      () => finish(resolveProjectedPendingWorkspaceSession()),
    );
  });
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
  const markLaunchIntentSendAttempted =
    useChatLaunchIntentStore((state) => state.markSendAttemptedIfActive);
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const { promptSession } = useSessionPromptWorkflow();
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
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
    launchControlValues?: Record<string, string>;
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
      launchControlValues: input.launchControlValues,
      ...modeOptions(input.modeId),
    });
  }, [createSessionWithResolvedConfig]);

  const promptProjectedOrCreateFreshSession = useCallback(async (input: {
    workspaceId: string;
    projectedSessionId: string | null | undefined;
    modelSelection: HomeNextModelSelection;
    modeId: string | null;
    launchControlValues?: Record<string, string>;
    text: string;
    promptId: string;
    launchIntentId: string;
    allowFreshFallback?: boolean;
  }) => {
    if (input.projectedSessionId) {
      markLaunchIntentMaterialized(input.launchIntentId, {
        clientSessionId: input.projectedSessionId,
        workspaceId: input.workspaceId,
      });
      await promptSession({
        sessionId: input.projectedSessionId,
        text: input.text,
        workspaceId: input.workspaceId,
        promptId: input.promptId,
        onBeforeOptimisticPrompt: () => {
          markLaunchIntentSendAttempted(input.launchIntentId);
        },
      });
      return;
    }

    if (input.allowFreshFallback === false) {
      throw new Error("Projected session shell was not created.");
    }

    await createFreshSession({
      workspaceId: input.workspaceId,
      modelSelection: input.modelSelection,
      modeId: input.modeId,
      launchControlValues: input.launchControlValues,
      text: input.text,
      promptId: input.promptId,
      launchIntentId: input.launchIntentId,
    });
  }, [
    createFreshSession,
    markLaunchIntentMaterialized,
    markLaunchIntentSendAttempted,
    promptSession,
  ]);

  const promptProjectedPendingWorkspaceSession = useCallback(async (input: {
    text: string;
    promptId: string;
    launchIntentId: string;
    waitUntil?: Promise<unknown>;
  }): Promise<string | null> => {
    const projected = input.waitUntil
      ? await waitForProjectedPendingWorkspaceSession(input.waitUntil)
      : resolveProjectedPendingWorkspaceSession();
    if (!projected) {
      return null;
    }

    markLaunchIntentMaterialized(input.launchIntentId, {
      clientSessionId: projected.sessionId,
    });
    await promptSession({
      sessionId: projected.sessionId,
      text: input.text,
      workspaceId: projected.workspaceId,
      promptId: input.promptId,
      onBeforeOptimisticPrompt: () => {
        markLaunchIntentSendAttempted(input.launchIntentId);
      },
    });
    return projected.sessionId;
  }, [
    markLaunchIntentMaterialized,
    markLaunchIntentSendAttempted,
    promptSession,
  ]);

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
    const launchIntentId = newLaunchId();
    const promptId = newLaunchId();
    const resolvedLaunchControlValues = {
      ...launchControlValues,
      ...(modeId ? { mode: modeId } : {}),
    };
    const initialSession: PendingWorkspaceInitialSession = {
      kind: "session",
      agentKind: modelSelection.kind,
      modelId: modelSelection.modelId,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
      displayTitle: modelSelection.modelId,
    };
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
          await promptSession({
            sessionId: projectedSessionId ?? result.session.id,
            text: prompt,
            workspaceId: result.workspace.id,
            promptId,
            onBeforeOptimisticPrompt: () => {
              markLaunchIntentSendAttempted(launchIntentId);
            },
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
        throw new Error("Cloud workspace creation was interrupted.");
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
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
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
