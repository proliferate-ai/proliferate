import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import {
  captureTelemetryException,
} from "@/lib/integrations/telemetry/client";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import {
  useActiveSessionLaunchState,
  useActiveSessionSurfaceSnapshot,
} from "./use-active-chat-session-selectors";
import { useChatAvailabilityState } from "./use-chat-availability-state";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import {
  EMPTY_CHAT_DRAFT,
  serializeChatDraftToPrompt,
} from "@/lib/domain/chat/file-mentions";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";
import { createPromptId } from "@/lib/domain/chat/prompt-id";
import { hasPromptContent } from "@/lib/domain/chat/prompt-input";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { completeChatPromptSubmitSideEffects } from "./chat-submit-effects";

export function useChatPromptActions() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const { cancelActiveSession, findOrCreateSession, promptActiveSession } = useSessionActions();
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const {
    activeSessionId,
    currentLaunchIdentity,
  } = useActiveSessionLaunchState();
  const { hasSlot } = useActiveSessionSurfaceSnapshot();
  const { isDisabled } = useChatAvailabilityState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);

  const handleSubmit = useCallback(async (input?: {
    text: string;
    blocks: PromptInputBlock[];
    optimisticContentParts?: ContentPart[];
  }) => {
    if (!selectedWorkspaceId) {
      return;
    }

    const draftKey = resolveWorkspaceUiKey(selectedLogicalWorkspaceId, selectedWorkspaceId);
    const currentDraft = draftKey
      ? useChatInputStore.getState().draftByWorkspaceId[draftKey] ?? EMPTY_CHAT_DRAFT
      : EMPTY_CHAT_DRAFT;
    const text = input?.text.trim() ?? serializeChatDraftToPrompt(currentDraft).trim();
    const blocks = input?.blocks ?? [{ type: "text" as const, text }];
    if (!hasPromptContent(text, blocks) || isDisabled) {
      return;
    }

    const launchSelection = currentLaunchIdentity ?? configuredLaunch.selection;
    const targetSessionId = hasSlot ? activeSessionId : null;
    const promptId = createPromptId();
    const latencyFlowId = targetSessionId
      ? startLatencyFlow({
        flowKind: "prompt_submit",
        source: "composer_submit",
        targetWorkspaceId: selectedWorkspaceId,
        targetSessionId,
        promptId,
      })
      : null;

    const clearDraftIfNeeded = () => {
      if (!draftKey) {
        return;
      }
      clearDraft(draftKey);
    };

    // Existing-session sends can still clear immediately because there is no
    // launch validation gate. New-session sends clear only after validation.
    if (targetSessionId) {
      clearDraftIfNeeded();
    }

    try {
      if (targetSessionId) {
        await promptActiveSession(text, {
          latencyFlowId: latencyFlowId ?? undefined,
          promptId,
          blocks,
          optimisticContentParts: input?.optimisticContentParts,
        });
      } else if (launchSelection) {
        await findOrCreateSession(
          launchSelection.kind,
          text,
          launchSelection.modelId,
          blocks,
          input?.optimisticContentParts,
          clearDraftIfNeeded,
        );
      } else {
        showToast("Choose a ready model before sending a message.");
        return;
      }
      completeChatPromptSubmitSideEffects({
        queryClient,
        runtimeUrl,
        workspaceId: selectedWorkspaceId,
        agentKind: launchSelection?.kind ?? "unknown",
        reuseSession: targetSessionId !== null,
        setWorkspaceArrivalEvent,
      });
    } catch (error) {
      if (isSessionModelAvailabilityInterruption(error)) {
        return;
      }

      if (latencyFlowId) {
        failLatencyFlow(latencyFlowId, "prompt_submit_failed");
      }
      captureTelemetryException(error, {
        tags: {
          action: "prompt_active_session",
          domain: "chat",
        },
      });

      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to send message: ${message}`);
    }
  }, [
    activeSessionId,
    clearDraft,
    configuredLaunch.selection,
    currentLaunchIdentity,
    findOrCreateSession,
    hasSlot,
    isDisabled,
    promptActiveSession,
    queryClient,
    runtimeUrl,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  const handleCancel = useCallback(() => {
    void cancelActiveSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to cancel message: ${message}`);
    });
  }, [cancelActiveSession, showToast]);

  return {
    handleSubmit,
    handleCancel,
  };
}
