import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import type { PromptInputBlock } from "@anyharness/sdk";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  useActiveSessionId,
  useActiveSessionCanCancelState,
  useActiveSessionRunningState,
} from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { useChatAvailabilityState } from "@/hooks/chat/derived/use-chat-availability-state";
import { useChatComposerKeyboard } from "@/hooks/chat/ui/use-chat-composer-keyboard";
import { useChatDraftState } from "@/hooks/chat/use-chat-draft-state";
import { useChatModelSelectorState } from "@/hooks/chat/facade/use-chat-model-selector-state";
import { useChatPromptActions } from "@/hooks/chat/workflows/use-chat-prompt-actions";
import type { PromptAttachmentController } from "@/hooks/chat/ui/use-chat-prompt-attachments";
import { useComposerSubmitGate } from "@/hooks/chat/ui/use-composer-submit-gate";
import { usePlanDraftAttachments } from "@/hooks/plans/facade/use-plan-draft-attachments";
import { useChatSessionControls } from "@/hooks/chat/use-chat-session-controls";
import { useQueuedPromptEdit } from "@/hooks/chat/use-queued-prompt-edit";
import { useActiveReviewRun } from "@/hooks/reviews/facade/use-active-review-run";
import { useReviewActions } from "@/hooks/reviews/workflows/use-review-actions";
import { useComposerTextareaAutosize } from "@/hooks/chat/ui/use-composer-textarea-autosize";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { serializeChatDraftToPrompt } from "@/lib/domain/chat/composer/file-mention-draft-model";
import { promptAttachmentSnapshotsToContentParts } from "@/lib/domain/chat/composer/prompt-attachment-snapshot";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { mergeSessionConfigControlDescriptors } from "@/lib/domain/chat/session-controls/session-controls";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import {
  PROMPT_SUBMIT_MEASUREMENT_MAX_DURATION_MS,
  PROMPT_SUBMIT_MEASUREMENT_SURFACES,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { ChatInputControlRow } from "./ChatInputControlRow";
import { ChatInputDraftArea } from "./ChatInputDraftArea";
import { ChatInputHiddenFileInput } from "./ChatInputHiddenFileInput";
import { ChatComposerSurface } from "./ChatComposerSurface";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";

/**
 * The composer surface: mention-aware editor + model / session controls +
 * send button. The outer dock shell (backdrop, padding, max-width, dock-slot
 * area) is owned by ChatComposerDock so it can be shared with the dev
 * playground.
 */
export function ChatInput({
  attachments,
  suppressActiveSessionState = false,
}: {
  attachments: PromptAttachmentController;
  suppressActiveSessionState?: boolean;
}) {
  useDebugRenderCount("chat-composer");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mentionSearchHost, setMentionSearchHost] = useState<HTMLDivElement | null>(null);
  const workspaceSelectionNonce = useSessionSelectionStore((state) => state.workspaceSelectionNonce);
  const focusRequestNonce = useChatInputStore((state) => state.focusRequestNonce);
  const activeSessionId = useActiveSessionId();
  const isRunning = useActiveSessionRunningState();
  const canCancelActiveSession = useActiveSessionCanCancelState();
  const activeSessionIdForUi = suppressActiveSessionState ? null : activeSessionId;
  const isRunningForUi = suppressActiveSessionState ? false : isRunning && canCancelActiveSession;
  const { workspaceUiKey, materializedWorkspaceId, draft, setDraft, isEmpty } =
    useChatDraftState();
  const { isDisabled, areRuntimeControlsDisabled } = useChatAvailabilityState({
    activeSessionId: activeSessionIdForUi,
  });
  const modelSelectorProps = useChatModelSelectorState({
    suppressActiveSessionState,
  });
  const { agentKind, controls: sessionConfigControls, modeControl } = useChatSessionControls();
  const launchConfigControls = suppressActiveSessionState ? [] : modelSelectorProps.launchControls;
  const effectiveSessionConfigControls = useMemo(() => (
    suppressActiveSessionState
      ? []
      : mergeSessionConfigControlDescriptors(launchConfigControls, sessionConfigControls)
  ), [launchConfigControls, sessionConfigControls, suppressActiveSessionState]);
  const effectiveAgentKind = suppressActiveSessionState
    ? null
    : agentKind ?? modelSelectorProps.launchAgentKind;
  const effectiveModeControl = suppressActiveSessionState
    ? null
    : effectiveSessionConfigControls.find((control) => control.key === "collaboration_mode")
      ?? effectiveSessionConfigControls.find((control) => control.key === "mode")
      ?? modeControl
      ?? null;
  const { handleSubmit, handleCancel } = useChatPromptActions({
    forceNewSession: suppressActiveSessionState,
  });
  const { isSubmitting, run: runSubmit } = useComposerSubmitGate();
  const reviewActions = useReviewActions();
  const activeReview = useActiveReviewRun();
  const {
    isEditing: isEditingQueuedPrompt,
    editDraft,
    setEditDraftText,
    cancelEdit,
    commitEdit,
  } = useQueuedPromptEdit();
  const effectiveIsEditingQueuedPrompt = suppressActiveSessionState ? false : isEditingQueuedPrompt;
  const planAttachments = usePlanDraftAttachments({
    workspaceUiKey,
    sdkWorkspaceId: materializedWorkspaceId,
  });
  const promptText = serializeChatDraftToPrompt(draft);
  const hasDraftAttachments = attachments.hasAttachments || planAttachments.hasPlans;
  const effectiveIsEmpty = effectiveIsEditingQueuedPrompt
    ? editDraft.trim().length === 0
    : isEmpty && !hasDraftAttachments;
  const canSubmit =
    !effectiveIsEmpty && !isDisabled && !planAttachments.hasUnresolvedPlans && !isSubmitting;
  const canAcceptPastedAttachments =
    !effectiveIsEditingQueuedPrompt
    && !isDisabled
    && !areRuntimeControlsDisabled
    && !isSubmitting
    && attachments.canAttachFiles;
  useComposerTextareaAutosize({
    textareaRef,
    value: editDraft,
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  const onSubmit = useCallback(async () => {
    await runSubmit(async () => {
      if (effectiveIsEditingQueuedPrompt) {
        await commitEdit();
        return;
      }
      if (planAttachments.hasUnresolvedPlans) {
        return;
      }
      const measurementOperationId = startMeasurementOperation({
        kind: "prompt_submit",
        surfaces: PROMPT_SUBMIT_MEASUREMENT_SURFACES,
        maxDurationMs: PROMPT_SUBMIT_MEASUREMENT_MAX_DURATION_MS,
      });
      const trimmedPromptText = promptText.trim();
      const blockPrepareStartedAt = performance.now();
      const attachmentSnapshots = attachments.snapshotForSubmit();
      const blocks = [
        ...buildTextPromptBlocks(trimmedPromptText),
        ...planAttachments.blocks,
      ];
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "prompt.submit.blocks_prepare",
        startedAt: blockPrepareStartedAt,
        outcome: "completed",
        count: blocks.length + attachmentSnapshots.length,
      });
      const optimisticContentParts = [
        ...(trimmedPromptText ? [{ type: "text" as const, text: trimmedPromptText }] : []),
        ...promptAttachmentSnapshotsToContentParts(attachmentSnapshots),
        ...planAttachments.contentParts,
      ];
      const submitted = await handleSubmit({
        text: promptText,
        blocks,
        attachmentSnapshots,
        optimisticContentParts,
        measurementOperationId,
      });
      if (!submitted) {
        finishOrCancelMeasurementOperation(measurementOperationId, "aborted");
        return;
      }
      attachments.clearAttachments();
      planAttachments.clearPlans();
    });
  }, [
    attachments,
    commitEdit,
    effectiveIsEditingQueuedPrompt,
    handleSubmit,
    planAttachments,
    promptText,
    runSubmit,
  ]);

  const onCancel = useCallback(() => {
    if (effectiveIsEditingQueuedPrompt) {
      cancelEdit();
      return;
    }
    handleCancel();
  }, [cancelEdit, effectiveIsEditingQueuedPrompt, handleCancel]);

  const { handleKeyDown } = useChatComposerKeyboard({
    handleSubmit: onSubmit,
    handleCancel: onCancel,
    isRunning: isRunningForUi,
    canSubmit,
    modeControl: effectiveModeControl,
    isEditingQueuedPrompt: effectiveIsEditingQueuedPrompt,
    onCancelEdit: cancelEdit,
  });

  const focusComposer = useCallback((): boolean => {
    if (effectiveIsEditingQueuedPrompt) {
      if (!textareaRef.current) {
        return false;
      }
      textareaRef.current.focus({ preventScroll: true });
      return true;
    }
    return focusChatInput();
  }, [effectiveIsEditingQueuedPrompt]);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      attachments.addFiles(event.target.files);
    }
    event.target.value = "";
  }, [attachments]);

  const handleRemoveDraftAttachment = useCallback((id: string) => {
    attachments.removeAttachment(id);
    planAttachments.removePlan(id);
  }, [attachments, planAttachments]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (!canAcceptPastedAttachments) {
      return;
    }
    if (event.clipboardData.files.length > 0) {
      attachments.addFiles(event.clipboardData.files);
      event.preventDefault();
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text && attachments.addTextPaste(text)) {
      event.preventDefault();
    }
  }, [attachments, canAcceptPastedAttachments]);

  const handleComposerSurfaceClick = useCallback(() => {
    if (effectiveIsEditingQueuedPrompt) {
      textareaRef.current?.focus();
      return;
    }
    focusChatInput();
  }, [effectiveIsEditingQueuedPrompt]);

  useEffect(() => {
    if (!workspaceUiKey && !activeSessionIdForUi) {
      return;
    }

    const timer = window.setTimeout(() => {
      focusComposer();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [
    activeSessionIdForUi,
    focusComposer,
    workspaceUiKey,
    workspaceSelectionNonce,
  ]);

  useEffect(() => {
    if (focusRequestNonce === 0) {
      return;
    }

    let timer: number | null = null;
    let attempts = 0;
    let cancelled = false;
    const attemptFocus = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      if (focusComposer() || attempts >= 8) {
        return;
      }
      timer = window.setTimeout(attemptFocus, 25);
    };

    timer = window.setTimeout(attemptFocus, 0);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [focusComposer, focusRequestNonce]);

  return (
    <DebugProfiler id="chat-composer">
      <div className="relative">
        <div ref={setMentionSearchHost} className="relative z-20 flex flex-col px-5" />
        <ChatComposerSurface
          overflowMode="clip"
          onClick={handleComposerSurfaceClick}
          onPaste={handlePaste}
        >
          <form className="relative flex flex-col">
            <ChatInputHiddenFileInput
              ref={fileInputRef}
              onChange={handleFileInputChange}
            />
            <ChatInputDraftArea
              isEditingQueuedPrompt={effectiveIsEditingQueuedPrompt}
              editDraft={editDraft}
              onEditDraftChange={setEditDraftText}
              textareaRef={textareaRef}
              draft={draft}
              onDraftChange={setDraft}
              canSubmit={canSubmit}
              isDisabled={isDisabled}
              onSubmit={onSubmit}
              onKeyDown={handleKeyDown}
              hasDraftAttachments={hasDraftAttachments}
              draftAttachments={[...attachments.attachments, ...planAttachments.attachments]}
              onRemoveDraftAttachment={handleRemoveDraftAttachment}
              searchHostElement={mentionSearchHost}
              onCancelEdit={cancelEdit}
            />
            <ChatInputControlRow
              runtimeControlsDisabled={areRuntimeControlsDisabled}
              modelSelectorProps={modelSelectorProps}
              agentKind={effectiveAgentKind}
              sessionConfigControls={effectiveSessionConfigControls}
              isEditingQueuedPrompt={effectiveIsEditingQueuedPrompt}
              chatDisabled={isDisabled}
              isSubmitting={isSubmitting}
              supportsAttachments={attachments.supportsAttachments}
              canAttachFiles={attachments.canAttachFiles}
              activeSessionId={activeSessionIdForUi}
              workspaceUiKey={workspaceUiKey}
              sdkWorkspaceId={materializedWorkspaceId}
              suppressActiveSessionState={suppressActiveSessionState}
              canStartCodeReview={reviewActions.canStartCodeReview}
              hasBlockingReview={activeReview.hasBlockingReview}
              startingReview={!!activeReview.startingReview}
              hasUnresolvedPlans={planAttachments.hasUnresolvedPlans}
              onAttachFile={() => fileInputRef.current?.click()}
              onStartReview={reviewActions.startCodeReview}
              onConfigureReview={reviewActions.configureCodeReview}
              isRunning={isRunningForUi}
              isEmpty={effectiveIsEmpty}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          </form>
        </ChatComposerSurface>
      </div>
    </DebugProfiler>
  );
}

function buildTextPromptBlocks(text: string): PromptInputBlock[] {
  return text ? [{ type: "text", text }] : [];
}
