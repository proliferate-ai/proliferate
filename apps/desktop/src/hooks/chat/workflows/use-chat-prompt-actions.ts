import { useCallback } from "react";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { useWorkspaceSetupStatusCache } from "@/hooks/access/anyharness/workspaces/use-workspace-setup-status-cache";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionRuntimeActions } from "@/hooks/sessions/workflows/use-session-runtime-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import { useSessionCancelActions } from "@/hooks/sessions/workflows/use-session-cancel-actions";
import { useSessionFindOrCreateActions } from "@/hooks/sessions/workflows/use-session-find-or-create-actions";
import { useSessionPromptActions } from "@/hooks/sessions/workflows/use-session-prompt-actions";
import { useSessionSelectionActions } from "@/hooks/sessions/facade/use-session-selection-actions";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useActiveSessionLaunchState } from "@/hooks/chat/derived/use-active-session-config-state";
import { useActiveSessionSurfaceSnapshot } from "@/hooks/chat/derived/use-active-session-transcript-state";
import { useChatAvailabilityState } from "@/hooks/chat/derived/use-chat-availability-state";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import { resolveAvailableLaunchSelection } from "@/lib/domain/chat/models/launch-selection-defaults";
import {
  EMPTY_CHAT_DRAFT,
  serializeChatDraftToPrompt,
} from "@/lib/domain/chat/composer/file-mention-draft-model";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { buildPendingWorkspaceUiKey } from "@/lib/domain/workspaces/creation/pending-entry";
import { createPendingSessionId } from "@/lib/workflows/sessions/session-runtime";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import { hasPromptContent } from "@/lib/domain/chat/composer/prompt-input";
import type { PromptAttachmentSnapshot } from "@proliferate/product-domain/chats/composer/prompt-attachment-snapshot";
import { finishOrCancelMeasurementOperation } from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { useGitPromptSnapshotEffects } from "@/hooks/workspaces/workflows/use-git-prompt-snapshot-effects";
import { completeChatPromptSubmitSideEffects } from "@/lib/workflows/chat/complete-chat-prompt-submit-side-effects";

export function useChatPromptActions(options?: { forceNewSession?: boolean }) {
  const forceNewSession = options?.forceNewSession ?? false;
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const { getCachedWorkspaceSetupStatus } = useWorkspaceSetupStatusCache();
  const { cancelActiveSession } = useSessionCancelActions();
  const { createSessionWithResolvedConfig } = useSessionCreationActions();
  const { activateSession } = useSessionRuntimeActions();
  const { ensureWorkspaceSessions, selectSession } = useSessionSelectionActions();
  const { findOrCreateSession } = useSessionFindOrCreateActions({
    activateSession,
    createSessionWithResolvedConfig,
    ensureWorkspaceSessions,
    selectSession,
  });
  const { promptActiveSession } = useSessionPromptActions();
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
  const gitPromptEffects = useGitPromptSnapshotEffects();
  const telemetry = useProductTelemetry();

  const handleSubmit = useCallback(async (input?: {
    text: string;
    blocks: PromptInputBlock[];
    attachmentSnapshots?: PromptAttachmentSnapshot[];
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
    const attachmentSnapshots = input?.attachmentSnapshots ?? [];
    if ((!hasPromptContent(text, blocks) && attachmentSnapshots.length === 0) || isDisabled) {
      return false;
    }

    const launchSelection = resolveAvailableLaunchSelection(
      configuredLaunch.launchCatalog.launchAgents,
      scopedLaunchIdentity,
      configuredLaunch.selection,
    );
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
          attachmentSnapshots,
          optimisticContentParts: input?.optimisticContentParts,
        });
      } else if (!selectedWorkspaceId && pendingWorkspaceEntry && pendingWorkspaceUiKey && launchSelection) {
        const clientSessionId = createPendingSessionId(launchSelection.kind);
        logLatency("chat.prompt.projected_session.create", {
          clientSessionId,
          pendingWorkspaceUiKey,
          attemptId: pendingWorkspaceEntry.attemptId,
          source: pendingWorkspaceEntry.source,
          stage: pendingWorkspaceEntry.stage,
          requestKind: pendingWorkspaceEntry.request.kind,
          agentKind: launchSelection.kind,
          modelId: launchSelection.modelId,
          promptId,
        });
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
          attachmentSnapshots,
          optimisticContentParts: input?.optimisticContentParts,
          workspaceId: pendingWorkspaceUiKey,
          measurementOperationId: input?.measurementOperationId,
          promptId,
        });
        logLatency("chat.prompt.projected_session.enqueued", {
          clientSessionId,
          pendingWorkspaceUiKey,
          attemptId: pendingWorkspaceEntry.attemptId,
          promptId,
        });
      } else if (launchSelection) {
        if (forceNewSession) {
          await createSessionWithResolvedConfig({
            text,
            blocks,
            attachmentSnapshots,
            optimisticContentParts: input?.optimisticContentParts,
            agentKind: launchSelection.kind,
            modelId: launchSelection.modelId,
            measurementOperationId: input?.measurementOperationId,
            promptId,
            onBeforeOptimisticPrompt: clearDraftIfNeeded,
          });
        } else {
          await findOrCreateSession(
            launchSelection.kind,
            text,
            launchSelection.modelId,
            blocks,
            attachmentSnapshots,
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
        workspaceId: selectedWorkspaceId,
        logicalWorkspaceId: selectedLogicalWorkspaceId,
        repoRootId: gitPromptEffects.repoRootIdForLogicalWorkspace(selectedLogicalWorkspaceId),
        getWorkspaceArrivalEvent: () => useSessionSelectionStore.getState().workspaceArrivalEvent,
        getCachedWorkspaceSetupStatus,
        agentKind: launchSelection?.kind ?? "unknown",
        reuseSession: targetSessionId !== null,
        setWorkspaceArrivalEvent,
      }, { trackProductEvent: telemetry.track, ...gitPromptEffects.promptSubmitDeps });
      return true;
    } catch (error) {
      if (latencyFlowId) {
        failLatencyFlow(latencyFlowId, "prompt_submit_failed");
      }
      finishOrCancelMeasurementOperation(input?.measurementOperationId, "error_sanitized");
      telemetry.captureException(error, {
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
    configuredLaunch.launchCatalog.launchAgents,
    configuredLaunch.selection,
    createSessionWithResolvedConfig,
    findOrCreateSession,
    getCachedWorkspaceSetupStatus,
    gitPromptEffects,
    hasSlot,
    forceNewSession,
    isDisabled,
    pendingWorkspaceEntry,
    promptActiveSession,
    promptSession,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    setWorkspaceArrivalEvent,
    showToast,
    scopedLaunchIdentity,
    telemetry,
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
