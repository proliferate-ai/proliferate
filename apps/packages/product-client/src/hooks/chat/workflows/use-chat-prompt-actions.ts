import { useCallback, useMemo } from "react";
import { isWorkspaceDirectoryMissingError } from "#product/lib/domain/sessions/creation/create-session-error";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { useWorkspaceSetupStatusCache } from "#product/hooks/access/anyharness/workspaces/use-workspace-setup-status-cache";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { useSessionRuntimeActions } from "#product/hooks/sessions/workflows/use-session-runtime-actions";
import { useSessionPromptWorkflow } from "#product/hooks/sessions/workflows/use-session-prompt-workflow";
import { useSessionCancelActions } from "#product/hooks/sessions/workflows/use-session-cancel-actions";
import { useSessionFindOrCreateActions } from "#product/hooks/sessions/workflows/use-session-find-or-create-actions";
import { useSessionPromptActions } from "#product/hooks/sessions/workflows/use-session-prompt-actions";
import { useSessionSelectionActions } from "#product/hooks/sessions/facade/use-session-selection-actions";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import { useActiveSessionLaunchState } from "#product/hooks/chat/derived/use-active-session-config-state";
import { useActiveSessionSurfaceSnapshot } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import { useChatAvailabilityState } from "#product/hooks/chat/derived/use-chat-availability-state";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import { resolveAvailableLaunchSelection } from "#product/lib/domain/chat/models/launch-selection-defaults";
import { EMPTY_CHAT_DRAFT } from "#product/lib/domain/chat/composer/file-mention-draft-model";
import { serializeChatDraftToOutgoingPrompt } from "#product/lib/domain/chat/composer/outgoing-prompt";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { resolveWorkspaceUiKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { buildPendingWorkspaceUiKey } from "#product/lib/domain/workspaces/creation/pending-entry";
import { createPendingSessionId } from "#product/lib/workflows/sessions/session-runtime";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { createPromptId } from "#product/lib/domain/chat/composer/prompt-id";
import { hasPromptContent } from "#product/lib/domain/chat/composer/prompt-input";
import type { PromptAttachmentSnapshot } from "#product/domain/chats/composer/prompt-attachment-snapshot";
import { finishOrCancelMeasurementOperation } from "#product/lib/infra/measurement/measurement-port";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import {
  abandonRendererFlow,
  beginRendererFlow,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";
import { useGitPromptSnapshotEffects } from "#product/hooks/workspaces/workflows/use-git-prompt-snapshot-effects";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { completeChatPromptSubmitSideEffects } from "#product/lib/workflows/chat/complete-chat-prompt-submit-side-effects";
import { CHAT_PROMPT_FEEDBACK } from "#product/copy/chat/chat-copy";

export function useChatPromptActions(options?: { forceNewSession?: boolean }) {
  const forceNewSession = options?.forceNewSession ?? false;
  const showToast = useToastStore((store) => store.show);
  const showErrorToast = useToastStore((store) => store.showError);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) => state.selectedLogicalWorkspaceId);
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
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
  const scopedLaunchIdentity = currentLaunchIdentity;
  const configuredLaunch = useConfiguredLaunchReadiness(scopedLaunchIdentity);
  const requireCurrentLaunch = forceNewSession && scopedLaunchIdentity !== null;
  const newSessionLaunchSelection = useMemo(() => resolveAvailableLaunchSelection(
    configuredLaunch.launchCatalog.launchAgents,
    scopedLaunchIdentity,
    configuredLaunch.selection,
    { requirePreferredSelection: requireCurrentLaunch },
  ), [
    configuredLaunch.launchCatalog.launchAgents,
    configuredLaunch.selection,
    requireCurrentLaunch,
    scopedLaunchIdentity,
  ]);
  const hasLaunchReadinessError = Boolean(
    configuredLaunch.launchCatalog.error
    || configuredLaunch.launchCatalog.targetReadinessError,
  );
  const currentLaunchReadiness = requireCurrentLaunch
    ? {
      isLoading: configuredLaunch.isLoading,
      isReady: !hasLaunchReadinessError && newSessionLaunchSelection !== null,
      disabledReason: hasLaunchReadinessError
        ? configuredLaunch.disabledReason
        : newSessionLaunchSelection
          ? null
          : CHAT_PROMPT_FEEDBACK.currentModelUnavailable,
    }
    : undefined;
  const { disabledReason, isDisabled, sendBlockedReason } = useChatAvailabilityState({
    activeSessionId: forceNewSession ? null : activeSessionId,
    activeLaunchSelection: forceNewSession ? scopedLaunchIdentity : null,
    launchReadiness: currentLaunchReadiness,
  });
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
  const gitPromptEffects = useGitPromptSnapshotEffects();
  const telemetry = useProductTelemetry();

  const handleSubmit = useCallback(async function handleSubmit(input?: {
    text: string;
    blocks: PromptInputBlock[];
    attachmentSnapshots?: PromptAttachmentSnapshot[];
    optimisticContentParts?: ContentPart[];
    measurementOperationId?: MeasurementOperationId | null;
    preserveDraft?: boolean;
    onSubmitted?: () => void;
  }): Promise<boolean> {
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
    const text = input?.text.trim() ?? serializeChatDraftToOutgoingPrompt(currentDraft).trim();
    const blocks = input?.blocks ?? [{ type: "text" as const, text }];
    const attachmentSnapshots = input?.attachmentSnapshots ?? [];
    const preserveDraft = input?.preserveDraft ?? false;
    if (
      (!hasPromptContent(text, blocks) && attachmentSnapshots.length === 0)
      || isDisabled
      || sendBlockedReason
    ) {
      return false;
    }

    const launchSelection = newSessionLaunchSelection;
    const targetSessionId = !forceNewSession && hasSlot ? activeSessionId : null;
    const promptId = createPromptId();
    if (targetSessionId) {
      // UX-latency R12: composer_submit is keyed by sessionId, not promptId.
      // promptId is not threaded into the stream-apply layer where the first
      // assistant content is observed (session-stream-flush-apply.ts), and the
      // composer is blocked from a second concurrent send on the same session,
      // so sessionId is a truthful correlation key for this flow's common
      // (existing-session) path. New-session sends are out of scope for this
      // mark: no sessionId exists yet at submit time.
      beginRendererFlow({
        kind: "composer_submit",
        correlationKey: targetSessionId,
        correlation: { sessionId: targetSessionId, promptId },
      });
    }
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
      if (!draftKey || preserveDraft) {
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
      if (selectedWorkspaceId) {
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
      }
      input?.onSubmitted?.();
      return true;
    } catch (error) {
      if (targetSessionId) {
        abandonRendererFlow({
          kind: "composer_submit",
          correlationKey: targetSessionId,
          reason: "prompt_submit_failed",
        });
      }
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

      // The persistent missing-worktree composer panel owns this condition;
      // a transient toast would just restate it with internal wording. The
      // collections cache still says the workspace is available (no
      // refetch-on-focus), so refresh availability to mount the panel.
      if (isWorkspaceDirectoryMissingError(error)) {
        void invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        // The draft has already been cleared by this point, so saying where the
        // text went is the whole job of this toast: without it the user is left
        // looking at an empty composer with no message sent. Retry re-sends the
        // resolved prompt rather than calling back in with no argument, which
        // would re-read the now-empty draft and send nothing.
        showErrorToast({
          headline: "Message not sent",
          consequence: "It was not delivered. Retry to send it again.",
          cause: message,
          retry: () => void handleSubmit({
            text,
            blocks,
            attachmentSnapshots,
            ...(input?.optimisticContentParts
              ? { optimisticContentParts: input.optimisticContentParts }
              : {}),
            preserveDraft,
            onSubmitted: input?.onSubmitted,
          }),
        });
      }
      return false;
    }
  }, [
    activeSessionId,
    clearDraft,
    createSessionWithResolvedConfig,
    findOrCreateSession,
    getCachedWorkspaceSetupStatus,
    gitPromptEffects,
    hasSlot,
    forceNewSession,
    invalidateWorkspaceCollectionsForRuntime,
    isDisabled,
    newSessionLaunchSelection,
    pendingWorkspaceEntry,
    promptActiveSession,
    promptSession,
    runtimeUrl,
    selectedLogicalWorkspaceId,
    selectedWorkspaceId,
    sendBlockedReason,
    setWorkspaceArrivalEvent,
    showErrorToast,
    showToast,
    telemetry,
  ]);

  const handleCancel = useCallback(function handleCancel() {
    if (forceNewSession) {
      return;
    }
    void cancelActiveSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showErrorToast({
        headline: "Message not cancelled",
        consequence: "The session is still working on it.",
        cause: message,
        retry: handleCancel,
      });
    });
  }, [cancelActiveSession, forceNewSession, showErrorToast]);

  return {
    handleSubmit,
    handleCancel,
    submitDisabledReason: sendBlockedReason ?? (isDisabled ? disabledReason : null),
  };
}
