import { useCallback } from "react";
import { promptAttachmentSendFields } from "#product/domain/chats/composer/prompt-attachment-content-parts";
import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionPromptWorkflow } from "#product/hooks/sessions/workflows/use-session-prompt-workflow";
import type { HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import {
  resolveProjectedPendingWorkspaceSession,
  waitForProjectedPendingWorkspaceSession,
} from "#product/hooks/home/workflows/home-next-projected-session";

export function useHomeNextLaunchPromptActions() {
  const { promptSession } = useSessionPromptWorkflow();
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const markLaunchIntentMaterialized =
    useChatLaunchIntentStore((state) => state.markMaterialized);
  const markLaunchIntentSendAttempted =
    useChatLaunchIntentStore((state) => state.markSendAttempted);

  const createFreshSession = useCallback(async (input: {
    workspaceId: string;
    modelSelection: HomeNextModelSelection;
    launchControlValues?: Record<string, string>;
    text: string;
    attachmentSnapshots?: PromptAttachmentSnapshot[];
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
      ...promptAttachmentSendFields(input.text, input.attachmentSnapshots),
    });
  }, [createSessionWithResolvedConfig]);

  const promptProjectedOrCreateFreshSession = useCallback(async (input: {
    workspaceId: string;
    projectedSessionId: string | null | undefined;
    modelSelection: HomeNextModelSelection;
    launchControlValues?: Record<string, string>;
    text: string;
    attachmentSnapshots?: PromptAttachmentSnapshot[];
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
        ...promptAttachmentSendFields(input.text, input.attachmentSnapshots),
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
      launchControlValues: input.launchControlValues,
      text: input.text,
      attachmentSnapshots: input.attachmentSnapshots,
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
    attachmentSnapshots?: PromptAttachmentSnapshot[];
    promptId: string;
    launchIntentId: string;
    waitUntil?: Promise<unknown>;
    /** Routes the prompt to this attempt's projected session, attended or not. */
    attemptId?: string | null;
  }): Promise<string | null> => {
    const projected = input.waitUntil
      ? await waitForProjectedPendingWorkspaceSession(input.waitUntil, input.attemptId)
      : resolveProjectedPendingWorkspaceSession(input.attemptId);
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
      ...promptAttachmentSendFields(input.text, input.attachmentSnapshots),
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
    attachmentSnapshots?: PromptAttachmentSnapshot[];
    workspaceId: string;
    promptId: string;
    launchIntentId: string;
  }) => {
    await promptSession({
      sessionId: input.sessionId,
      text: input.text,
      workspaceId: input.workspaceId,
      promptId: input.promptId,
      ...promptAttachmentSendFields(input.text, input.attachmentSnapshots),
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
