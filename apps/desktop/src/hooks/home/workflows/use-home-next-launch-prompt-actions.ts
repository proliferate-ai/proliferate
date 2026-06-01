import { useCallback } from "react";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import type { HomeNextModelSelection } from "@/lib/domain/home/home-next-launch";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { modeOptions } from "@/hooks/home/workflows/home-next-launch-intent";
import {
  resolveProjectedPendingWorkspaceSession,
  waitForProjectedPendingWorkspaceSession,
} from "@/hooks/home/workflows/home-next-projected-session";

export function useHomeNextLaunchPromptActions() {
  const { promptSession } = useSessionPromptWorkflow();
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const markLaunchIntentMaterialized =
    useChatLaunchIntentStore((state) => state.markMaterializedIfActive);
  const markLaunchIntentSendAttempted =
    useChatLaunchIntentStore((state) => state.markSendAttemptedIfActive);

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

  const promptExistingSession = useCallback(async (input: {
    sessionId: string;
    text: string;
    workspaceId: string;
    promptId: string;
    launchIntentId: string;
  }) => {
    await promptSession({
      sessionId: input.sessionId,
      text: input.text,
      workspaceId: input.workspaceId,
      promptId: input.promptId,
      onBeforeOptimisticPrompt: () => {
        markLaunchIntentSendAttempted(input.launchIntentId);
      },
    });
  }, [
    markLaunchIntentSendAttempted,
    promptSession,
  ]);

  return {
    promptExistingSession,
    promptProjectedOrCreateFreshSession,
    promptProjectedPendingWorkspaceSession,
  };
}
