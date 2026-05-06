import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import {
  captureTelemetryException,
} from "@/lib/integrations/telemetry/client";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
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
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/pending-entry";
import { createPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { createPromptId } from "@/lib/domain/chat/prompt-id";
import { hasPromptContent } from "@/lib/domain/chat/prompt-input";
import {
  finishOrCancelMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { completeChatPromptSubmitSideEffects } from "./chat-submit-effects";

export function useChatPromptActions(options?: { forceNewSession?: boolean }) {
  const forceNewSession = options?.forceNewSession ?? false;
  const queryClient = useQueryClient();
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const {
    cancelActiveSession,
    createSessionWithResolvedConfig,
    findOrCreateSession,
    promptActiveSession,
  } = useSessionActions();
  const { promptSession } = useSessionPromptWorkflow();
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const {
    activeSessionId,
    currentLaunchIdentity,
  } = useActiveSessionLaunchState();
  const { hasSlot } = useActiveSessionSurfaceSnapshot();
  const { isDisabled } = useChatAvailabilityState({
    activeSessionId: forceNewSession ? null : activeSessionId,
  });
  const scopedLaunchIdentity = forceNewSession ? null : currentLaunchIdentity;
  const configuredLaunch = useConfiguredLaunchReadiness(scopedLaunchIdentity);

  const handleSubmit = useCallback(async (input?: {
    text: string;
    blocks: PromptInputBlock[];
    optimisticContentParts?: ContentPart[];
    measurementOperationId?: MeasurementOperationId | null;
  }): Promise<boolean> => {
    const pendingWorkspaceUiKey = pendingWorkspaceEntry
      ? buildPendingWorkspaceUiKey(pendingWorkspaceEntry)
      : null;
    const effectiveWorkspaceId = selectedWorkspaceId ?? pendingWorkspaceUiKey;
    if (!effectiveWorkspaceId) {
      return false;
    }

    const draftKey =
      resolveWorkspaceUiKey(selectedLogicalWorkspaceId, selectedWorkspaceId)
      ?? pendingWorkspaceUiKey;
    const currentDraft = draftKey
      ? useChatInputStore.getState().draftByWorkspaceId[draftKey] ?? EMPTY_CHAT_DRAFT
      : EMPTY_CHAT_DRAFT;
    const text = input?.text.trim() ?? serializeChatDraftToPrompt(currentDraft).trim();
    const blocks = input?.blocks ?? [{ type: "text" as const, text }];
    if (!hasPromptContent(text, blocks) || isDisabled) {
      return false;
    }

    const launchSelection = scopedLaunchIdentity ?? configuredLaunch.selection;
    const targetSessionId = !forceNewSession && hasSlot ? activeSessionId : null;
    const promptId = createPromptId();
    const latencyFlowId = targetSessionId
      ? startLatencyFlow({
        flowKind: "prompt_submit",
        source: "composer_submit",
        targetWorkspaceId: effectiveWorkspaceId,
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
          measurementOperationId: input?.measurementOperationId,
          promptId,
          blocks,
          optimisticContentParts: input?.optimisticContentParts,
        });
      } else if (!selectedWorkspaceId && pendingWorkspaceEntry && pendingWorkspaceUiKey && launchSelection) {
        const clientSessionId = createPendingSessionId(launchSelection.kind);
        putSessionRecord({
          ...createEmptySessionRecord(clientSessionId, launchSelection.kind, {
            workspaceId: pendingWorkspaceUiKey,
            materializedSessionId: null,
            modelId: launchSelection.modelId,
            optimisticPrompt: null,
            sessionRelationship: { kind: "root" },
          }),
          status: "starting",
          transcriptHydrated: true,
        });
        useSessionSelectionStore.getState().setActiveSessionId(clientSessionId);
        writeChatShellIntentForSession({
          workspaceId: pendingWorkspaceUiKey,
          sessionId: clientSessionId,
        });
        clearDraftIfNeeded();
        await promptSession({
          sessionId: clientSessionId,
          text,
          blocks,
          optimisticContentParts: input?.optimisticContentParts,
          workspaceId: pendingWorkspaceUiKey,
          measurementOperationId: input?.measurementOperationId,
          promptId,
        });
      } else if (launchSelection) {
        if (forceNewSession) {
          await createSessionWithResolvedConfig({
            text,
            blocks,
            optimisticContentParts: input?.optimisticContentParts,
            agentKind: launchSelection.kind,
            modelId: launchSelection.modelId,
            measurementOperationId: input?.measurementOperationId,
            onBeforeOptimisticPrompt: clearDraftIfNeeded,
          });
        } else {
          await findOrCreateSession(
            launchSelection.kind,
            text,
            launchSelection.modelId,
            blocks,
            input?.optimisticContentParts,
            clearDraftIfNeeded,
            input?.measurementOperationId,
            promptId,
          );
        }
      } else {
        showToast("Choose a ready model before sending a message.");
        return false;
      }
      if (!selectedWorkspaceId) {
        return true;
      }
      completeChatPromptSubmitSideEffects({
        queryClient,
        runtimeUrl,
        workspaceId: selectedWorkspaceId,
        agentKind: launchSelection?.kind ?? "unknown",
        reuseSession: targetSessionId !== null,
        setWorkspaceArrivalEvent,
      });
      return true;
    } catch (error) {
      if (isSessionModelAvailabilityInterruption(error)) {
        finishOrCancelMeasurementOperation(input?.measurementOperationId, "aborted");
        return false;
      }

      if (latencyFlowId) {
        failLatencyFlow(latencyFlowId, "prompt_submit_failed");
      }
      finishOrCancelMeasurementOperation(input?.measurementOperationId, "error_sanitized");
      captureTelemetryException(error, {
        tags: {
          action: "prompt_active_session",
          domain: "chat",
        },
      });

      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to send message: ${message}`);
      return false;
    }
  }, [
    activeSessionId,
    clearDraft,
    configuredLaunch.selection,
    createSessionWithResolvedConfig,
    findOrCreateSession,
    hasSlot,
    forceNewSession,
    isDisabled,
    pendingWorkspaceEntry,
    promptActiveSession,
    promptSession,
    queryClient,
    runtimeUrl,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    setWorkspaceArrivalEvent,
    showToast,
    scopedLaunchIdentity,
  ]);

  const handleCancel = useCallback(() => {
    if (forceNewSession) {
      return;
    }
    void cancelActiveSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to cancel message: ${message}`);
    });
  }, [cancelActiveSession, forceNewSession, showToast]);

  return {
    handleSubmit,
    handleCancel,
  };
}
